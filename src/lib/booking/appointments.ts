/**
 * Appointment domain logic. Mirrors the structure of `@/lib/reservations`:
 * route handlers and Server Actions both call these functions; the module
 * itself is responsible for transactional consistency.
 *
 * Operations:
 *   - `createAppointment(input, ctx)`  — books a new slot atomically and
 *                                         signs a waiver in the same tx
 *   - `cancelAppointment(id, opts)`    — soft-cancel
 *   - `rescheduleAppointment(id, opts)`— move date/time
 *
 * The waiver is required by the schema (`appointment.waiver_id` references
 * `waiver.id`, and `bookAppointmentSchema` requires `waiverSigned: true` +
 * `waiverSignatureData`). Both rows are inserted in the same transaction
 * with a follow-up UPDATE on the appointment to set `waiverId`.
 */
import "server-only";

import { and, eq, gte, lte, ne, notInArray } from "drizzle-orm";

import {
    aftercareGuides,
    aftercareTracking,
    appointments,
    appointmentJewelry,
    appointmentServices,
    customers,
    db,
    piercerSchedule,
    scheduleExceptions,
    services as servicesTable,
    timeBlocks,
    waiverTemplates,
    waivers,
    type AftercareTracking,
    type Appointment,
    type Customer,
} from "@/db";
import { hashPassword } from "@/lib/auth-utils";
import {
    computeSlotsForDay,
    dayOfWeekForDate,
    parseHmsToMinutes,
    type TimeRange,
} from "@/lib/booking/availability";
import { allocateAndInsert } from "@/lib/reference-numbers";
import { getBookingSettings } from "@/lib/settings";
import type { BookAppointmentInput, RescheduleAppointmentInput } from "@/lib/validations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export class AppointmentError extends Error {
    constructor(
        message: string,
        readonly code:
            | "service_not_found"
            | "slot_unavailable"
            | "waiver_template_missing"
            | "not_found"
            | "forbidden"
            | "invalid_state"
    ) {
        super(message);
        this.name = "AppointmentError";
    }
}

export interface CreateAppointmentResult {
    appointment: Appointment;
    customer: Pick<Customer, "id" | "email" | "firstName" | "lastName" | "phone"> | null;
    customerCreated: boolean;
    temporaryPassword: string | null;
    serviceTitles: string[];
}

interface CreateAppointmentContext {
    sessionCustomerId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------
function fullName(first: string, last?: string | null): string {
    return [first, last]
        .filter((s): s is string => !!s && s.length > 0)
        .join(" ")
        .trim();
}

// ---------------------------------------------------------------------------
// createAppointment
// ---------------------------------------------------------------------------
export async function createAppointment(
    input: BookAppointmentInput,
    ctx: CreateAppointmentContext = {}
): Promise<CreateAppointmentResult> {
    const settings = await getBookingSettings();

    return db.transaction(async (tx) => {
        // -----------------------------------------------------------------
        // 1. Resolve services + compute total duration / estimated total
        // -----------------------------------------------------------------
        const serviceRows = await tx
            .select({
                id: servicesTable.id,
                name: servicesTable.name,
                durationMinutes: servicesTable.durationMinutes,
                priceFrom: servicesTable.priceFrom,
                isActive: servicesTable.isActive,
            })
            .from(servicesTable)
            .where(
                and(
                    eq(servicesTable.isActive, true)
                    // serviceIds filtered with inArray below
                )
            );

        const byId = new Map(serviceRows.map((r) => [r.id, r]));
        const requested = input.serviceIds.map((id) => byId.get(id));
        if (requested.some((s) => !s)) {
            throw new AppointmentError(
                "Одна или несколько выбранных услуг недоступны",
                "service_not_found"
            );
        }

        const totalDurationMin = requested.reduce((acc, s) => acc + (s?.durationMinutes ?? 0), 0);
        const estimatedTotal = requested.reduce((acc, s) => acc + (s?.priceFrom ?? 0), 0);
        const requiredDurationMin = totalDurationMin + settings.bufferMinutes;

        // -----------------------------------------------------------------
        // 2. Verify the requested slot is still free.
        //    (Race window between availability GET and POST is closed here.)
        // -----------------------------------------------------------------
        const slotStartMin = parseHmsToMinutes(input.time);
        if (slotStartMin === null) {
            throw new AppointmentError("Некорректное время", "slot_unavailable");
        }

        const dow = dayOfWeekForDate(input.date);
        let workingWindow: TimeRange | null = null;
        const breaks: TimeRange[] = [];

        const [exception] = await tx
            .select()
            .from(scheduleExceptions)
            .where(eq(scheduleExceptions.date, input.date))
            .limit(1);

        if (exception) {
            if (exception.isWorking) {
                const s = parseHmsToMinutes(exception.startTime);
                const e = parseHmsToMinutes(exception.endTime);
                if (s !== null && e !== null && e > s) workingWindow = { start: s, end: e };
            }
        } else if (dow !== null) {
            const [weekly] = await tx
                .select()
                .from(piercerSchedule)
                .where(eq(piercerSchedule.dayOfWeek, dow))
                .limit(1);
            if (weekly?.isWorking) {
                const s = parseHmsToMinutes(weekly.startTime);
                const e = parseHmsToMinutes(weekly.endTime);
                if (s !== null && e !== null && e > s) {
                    workingWindow = { start: s, end: e };
                    if (Array.isArray(weekly.breaks)) {
                        for (const b of weekly.breaks as Array<{ start?: string; end?: string }>) {
                            const bs = parseHmsToMinutes(b.start ?? null);
                            const be = parseHmsToMinutes(b.end ?? null);
                            if (bs !== null && be !== null && be > bs) {
                                breaks.push({ start: bs, end: be });
                            }
                        }
                    }
                }
            }
        }

        const blockRows = await tx
            .select({ startTime: timeBlocks.startTime, endTime: timeBlocks.endTime })
            .from(timeBlocks)
            .where(eq(timeBlocks.date, input.date));
        const blocks: TimeRange[] = [];
        for (const b of blockRows) {
            const s = parseHmsToMinutes(b.startTime);
            const e = parseHmsToMinutes(b.endTime);
            if (s !== null && e !== null && e > s) blocks.push({ start: s, end: e });
        }

        // Lock all relevant appointment rows on this date — `for("update")`
        // serialises concurrent booking attempts on the same day.
        const apptRows = await tx
            .select({
                timeStart: appointments.timeStart,
                timeEnd: appointments.timeEnd,
                status: appointments.status,
            })
            .from(appointments)
            .where(
                and(
                    eq(appointments.date, input.date),
                    notInArray(appointments.status, ["cancelled", "no_show"]),
                    ne(appointments.status, "rescheduled")
                )
            )
            .for("update");

        const busyAppointments: TimeRange[] = [];
        for (const a of apptRows) {
            const s = parseHmsToMinutes(a.timeStart);
            const e = parseHmsToMinutes(a.timeEnd);
            if (s !== null && e !== null && e > s) busyAppointments.push({ start: s, end: e });
        }

        const day = computeSlotsForDay({
            date: input.date,
            workingWindow,
            breaks,
            blocks,
            appointments: busyAppointments,
            earliestStartMin: 0, // route handler enforces min-notice; `tx` is post-validation
            requiredDurationMin,
            slotStepMin: settings.slotDurationMinutes,
        });

        if (!day.slots.includes(input.time)) {
            throw new AppointmentError("Этот слот недоступен", "slot_unavailable");
        }

        // -----------------------------------------------------------------
        // 3. Resolve / create customer
        // -----------------------------------------------------------------
        let customerRow: Customer | null = null;
        let customerCreated = false;
        let temporaryPassword: string | null = null;

        if (ctx.sessionCustomerId) {
            const [c] = await tx
                .select()
                .from(customers)
                .where(eq(customers.id, ctx.sessionCustomerId))
                .limit(1);
            if (c && !c.deletedAt) customerRow = c;
        }
        if (!customerRow) {
            const [byEmail] = await tx
                .select()
                .from(customers)
                .where(eq(customers.email, input.customer.email))
                .limit(1);
            if (byEmail && !byEmail.deletedAt) customerRow = byEmail;
        }
        if (!customerRow && input.createAccount) {
            temporaryPassword =
                Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
            const passwordHash = await hashPassword(temporaryPassword);
            const [created] = await tx
                .insert(customers)
                .values({
                    email: input.customer.email,
                    firstName: input.customer.firstName,
                    lastName: input.customer.lastName ?? null,
                    phone: input.customer.phone,
                    dateOfBirth: input.customer.dateOfBirth ?? null,
                    passwordHash,
                })
                .returning();
            customerRow = created;
            customerCreated = true;
        }

        // -----------------------------------------------------------------
        // 4. Active waiver template
        // -----------------------------------------------------------------
        const [activeTemplate] = await tx
            .select({ version: waiverTemplates.version })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.isActive, true))
            .orderBy(waiverTemplates.version)
            .limit(1);
        if (!activeTemplate) {
            throw new AppointmentError(
                "Шаблон соглашения отсутствует — обратитесь в студию",
                "waiver_template_missing"
            );
        }

        // -----------------------------------------------------------------
        // 5. Insert appointment header (waiverId set after waiver insert)
        // -----------------------------------------------------------------
        const slotEndMin = slotStartMin + totalDurationMin;
        const timeEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(
            slotEndMin % 60
        ).padStart(2, "0")}`;

        const { row: appointment } = await allocateAndInsert<Appointment>(
            "APT",
            {
                table: appointments,
                referenceColumn: appointments.referenceNumber,
                createdAtColumn: appointments.createdAt,
                uniqueConstraintName: "appointment_reference_number_unique",
            },
            tx as unknown as typeof db,
            (referenceNumber) => ({
                referenceNumber,
                customerId: customerRow?.id ?? null,
                customerFirstName: input.customer.firstName,
                customerLastName: input.customer.lastName ?? null,
                customerEmail: input.customer.email,
                customerPhone: input.customer.phone,
                customerDob: input.customer.dateOfBirth ?? null,
                date: input.date,
                timeStart: input.time,
                timeEnd,
                totalDurationMin,
                status: "pending",
                estimatedTotal,
                customerNotes: input.notes ?? null,
                metadata: input.selectedJewelry
                    ? {
                          fromVisualizerLook:
                              input.selectedJewelry.find((j) => j.fromVisualizerLook)
                                  ?.fromVisualizerLook ?? null,
                      }
                    : {},
            })
        );

        // -----------------------------------------------------------------
        // 6. Insert per-service / per-jewelry rows
        // -----------------------------------------------------------------
        await tx.insert(appointmentServices).values(
            requested.map((s) => ({
                appointmentId: appointment.id,
                serviceId: s!.id,
                price: s!.priceFrom,
                durationMinutes: s!.durationMinutes,
            }))
        );

        if (input.selectedJewelry && input.selectedJewelry.length > 0) {
            await tx.insert(appointmentJewelry).values(
                input.selectedJewelry.map((j) => ({
                    appointmentId: appointment.id,
                    variantId: j.variantId ?? null,
                    source: j.fromVisualizerLook ? "visualizer" : "catalog",
                }))
            );
        }

        // -----------------------------------------------------------------
        // 7. Sign waiver, then link it back onto the appointment
        // -----------------------------------------------------------------
        const [waiver] = await tx
            .insert(waivers)
            .values({
                appointmentId: appointment.id,
                customerId: customerRow?.id ?? null,
                templateVersion: activeTemplate.version,
                fullName:
                    fullName(input.customer.firstName, input.customer.lastName) ||
                    input.customer.firstName,
                signatureData: input.waiverSignatureData,
                ipAddress: ctx.ipAddress ?? null,
                userAgent: ctx.userAgent ?? null,
            })
            .returning();

        const [linked] = await tx
            .update(appointments)
            .set({ waiverId: waiver.id, updatedAt: new Date() })
            .where(eq(appointments.id, appointment.id))
            .returning();

        return {
            appointment: linked,
            customer: customerRow
                ? {
                      id: customerRow.id,
                      email: customerRow.email,
                      firstName: customerRow.firstName,
                      lastName: customerRow.lastName,
                      phone: customerRow.phone,
                  }
                : null,
            customerCreated,
            temporaryPassword,
            serviceTitles: requested.map((s) => s!.name),
        };
    });
}

// ---------------------------------------------------------------------------
// cancelAppointment
// ---------------------------------------------------------------------------
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

export async function cancelAppointment(
    appointmentId: string,
    opts: { actor: "customer" | "studio" | "system"; reason?: string; customerId?: string }
): Promise<Appointment> {
    return db.transaction(async (tx) => {
        const [row] = await tx
            .select()
            .from(appointments)
            .where(eq(appointments.id, appointmentId))
            .limit(1)
            .for("update");

        if (!row) throw new AppointmentError("Запись не найдена", "not_found");

        if (opts.actor === "customer") {
            if (!opts.customerId || row.customerId !== opts.customerId) {
                throw new AppointmentError("Это не ваша запись", "forbidden");
            }
        }

        if (TERMINAL_STATUSES.has(row.status ?? "")) {
            throw new AppointmentError("Эту запись уже нельзя отменить", "invalid_state");
        }

        const reasonNote = opts.reason
            ? `Отмена (${opts.actor}): ${opts.reason}`
            : `Отмена (${opts.actor})`;

        const [updated] = await tx
            .update(appointments)
            .set({
                status: "cancelled",
                cancelledAt: new Date(),
                updatedAt: new Date(),
                internalNotes: row.internalNotes
                    ? `${row.internalNotes}\n${reasonNote}`
                    : reasonNote,
            })
            .where(eq(appointments.id, appointmentId))
            .returning();
        return updated;
    });
}

// ---------------------------------------------------------------------------
// rescheduleAppointment
// ---------------------------------------------------------------------------
export async function rescheduleAppointment(
    appointmentId: string,
    input: RescheduleAppointmentInput,
    opts: { customerId: string }
): Promise<Appointment> {
    const settings = await getBookingSettings();

    return db.transaction(async (tx) => {
        const [row] = await tx
            .select()
            .from(appointments)
            .where(eq(appointments.id, appointmentId))
            .limit(1)
            .for("update");

        if (!row) throw new AppointmentError("Запись не найдена", "not_found");
        if (row.customerId !== opts.customerId) {
            throw new AppointmentError("Это не ваша запись", "forbidden");
        }
        if (TERMINAL_STATUSES.has(row.status ?? "")) {
            throw new AppointmentError("Эту запись уже нельзя перенести", "invalid_state");
        }

        const slotStartMin = parseHmsToMinutes(input.time);
        if (slotStartMin === null) {
            throw new AppointmentError("Некорректное время", "slot_unavailable");
        }
        const totalDurationMin = row.totalDurationMin;
        const requiredDurationMin = totalDurationMin + settings.bufferMinutes;

        // Re-resolve working window for the target date, excluding THIS
        // appointment from the busy list (otherwise rescheduling within the
        // same slot would always conflict with itself).
        const dow = dayOfWeekForDate(input.date);
        let workingWindow: TimeRange | null = null;
        const breaks: TimeRange[] = [];

        const [exception] = await tx
            .select()
            .from(scheduleExceptions)
            .where(eq(scheduleExceptions.date, input.date))
            .limit(1);

        if (exception) {
            if (exception.isWorking) {
                const s = parseHmsToMinutes(exception.startTime);
                const e = parseHmsToMinutes(exception.endTime);
                if (s !== null && e !== null && e > s) workingWindow = { start: s, end: e };
            }
        } else if (dow !== null) {
            const [weekly] = await tx
                .select()
                .from(piercerSchedule)
                .where(eq(piercerSchedule.dayOfWeek, dow))
                .limit(1);
            if (weekly?.isWorking) {
                const s = parseHmsToMinutes(weekly.startTime);
                const e = parseHmsToMinutes(weekly.endTime);
                if (s !== null && e !== null && e > s) {
                    workingWindow = { start: s, end: e };
                    if (Array.isArray(weekly.breaks)) {
                        for (const b of weekly.breaks as Array<{ start?: string; end?: string }>) {
                            const bs = parseHmsToMinutes(b.start ?? null);
                            const be = parseHmsToMinutes(b.end ?? null);
                            if (bs !== null && be !== null && be > bs) {
                                breaks.push({ start: bs, end: be });
                            }
                        }
                    }
                }
            }
        }

        const blockRows = await tx
            .select({ startTime: timeBlocks.startTime, endTime: timeBlocks.endTime })
            .from(timeBlocks)
            .where(eq(timeBlocks.date, input.date));
        const blocks: TimeRange[] = [];
        for (const b of blockRows) {
            const s = parseHmsToMinutes(b.startTime);
            const e = parseHmsToMinutes(b.endTime);
            if (s !== null && e !== null && e > s) blocks.push({ start: s, end: e });
        }

        const apptRows = await tx
            .select({
                id: appointments.id,
                timeStart: appointments.timeStart,
                timeEnd: appointments.timeEnd,
            })
            .from(appointments)
            .where(
                and(
                    eq(appointments.date, input.date),
                    notInArray(appointments.status, ["cancelled", "no_show"]),
                    ne(appointments.status, "rescheduled")
                )
            )
            .for("update");

        const busyAppointments: TimeRange[] = [];
        for (const a of apptRows) {
            if (a.id === appointmentId) continue; // exclude self
            const s = parseHmsToMinutes(a.timeStart);
            const e = parseHmsToMinutes(a.timeEnd);
            if (s !== null && e !== null && e > s) busyAppointments.push({ start: s, end: e });
        }

        const day = computeSlotsForDay({
            date: input.date,
            workingWindow,
            breaks,
            blocks,
            appointments: busyAppointments,
            earliestStartMin: 0,
            requiredDurationMin,
            slotStepMin: settings.slotDurationMinutes,
        });

        if (!day.slots.includes(input.time)) {
            throw new AppointmentError("Этот слот недоступен", "slot_unavailable");
        }

        const slotEndMin = slotStartMin + totalDurationMin;
        const timeEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(
            slotEndMin % 60
        ).padStart(2, "0")}`;

        const [updated] = await tx
            .update(appointments)
            .set({
                date: input.date,
                timeStart: input.time,
                timeEnd,
                status: "pending",
                updatedAt: new Date(),
            })
            .where(eq(appointments.id, appointmentId))
            .returning();
        return updated;
    });
}

// ---------------------------------------------------------------------------
// completeAppointment
// ---------------------------------------------------------------------------
export interface CompleteAppointmentResult {
    appointment: Appointment;
    tracking: AftercareTracking;
    /** True when we created a fresh tracking row; false when one already existed. */
    trackingCreated: boolean;
}

export interface CompleteAppointmentOptions {
    completionNotes?: string;
    /** Override the derived piercing type (else: first service.subcategory). */
    piercingType?: string;
}

/**
 * Admin-only state transition: mark an appointment `completed` and create the
 * `aftercare_tracking` row that anchors the drip sequence. Idempotent —
 * calling twice returns the existing tracking row without re-inserting.
 *
 * Side effects (enqueue, telegram) are NOT performed inside the transaction;
 * the caller (route handler) wires those up after we return.
 */
export async function completeAppointment(
    appointmentId: string,
    options: CompleteAppointmentOptions = {}
): Promise<CompleteAppointmentResult> {
    return db.transaction(async (tx) => {
        const [row] = await tx
            .select()
            .from(appointments)
            .where(eq(appointments.id, appointmentId))
            .limit(1)
            .for("update");
        if (!row) throw new AppointmentError("Запись не найдена", "not_found");

        const status = row.status ?? "pending";
        if (status === "cancelled" || status === "no_show") {
            throw new AppointmentError("Эта запись уже завершилась без посещения", "invalid_state");
        }

        // Idempotent: when already completed, just look up the existing
        // tracking row and return.
        let appointmentRow: Appointment;
        if (status === "completed") {
            appointmentRow = row;
        } else {
            const [updated] = await tx
                .update(appointments)
                .set({
                    status: "completed",
                    completedAt: new Date(),
                    completionNotes: options.completionNotes ?? row.completionNotes ?? null,
                    updatedAt: new Date(),
                })
                .where(eq(appointments.id, appointmentId))
                .returning();
            appointmentRow = updated;
        }

        // Derive piercing type from the first service's subcategory.
        let piercingType = options.piercingType?.trim() ?? null;
        if (!piercingType) {
            const [svc] = await tx
                .select({ subcategory: servicesTable.subcategory })
                .from(appointmentServices)
                .innerJoin(servicesTable, eq(servicesTable.id, appointmentServices.serviceId))
                .where(eq(appointmentServices.appointmentId, appointmentId))
                .limit(1);
            piercingType = svc?.subcategory ?? "general";
        }

        // Match an active aftercare guide for that piercing type (optional).
        const [guide] = await tx
            .select({ id: aftercareGuides.id })
            .from(aftercareGuides)
            .where(
                and(
                    eq(aftercareGuides.piercingType, piercingType),
                    eq(aftercareGuides.isPublished, true)
                )
            )
            .limit(1);

        // Idempotent insert: tracking row keyed by `appointmentId`.
        const [existing] = await tx
            .select()
            .from(aftercareTracking)
            .where(eq(aftercareTracking.appointmentId, appointmentId))
            .limit(1);
        if (existing) {
            return { appointment: appointmentRow, tracking: existing, trackingCreated: false };
        }

        if (!appointmentRow.customerId) {
            throw new AppointmentError(
                "Не получится завершить запись без аккаунта клиента — привяжите customer_id",
                "invalid_state"
            );
        }

        const [tracking] = await tx
            .insert(aftercareTracking)
            .values({
                customerId: appointmentRow.customerId,
                appointmentId,
                piercingType,
                piercingDate: appointmentRow.date,
                guideId: guide?.id ?? null,
                isActive: true,
            })
            .returning();

        return { appointment: appointmentRow, tracking, trackingCreated: true };
    });
}

// ---------------------------------------------------------------------------
// Date filter for the list endpoint — exported so the route handler can use
// the same boundary helpers without duplicating logic.
// ---------------------------------------------------------------------------
export function appointmentDateFilter(
    field: typeof appointments.date,
    today: string,
    filter: "upcoming" | "past" | "all"
) {
    if (filter === "upcoming") return gte(field, today);
    if (filter === "past") return lte(field, today);
    return undefined;
}
