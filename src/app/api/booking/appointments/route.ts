/**
 * /api/booking/appointments
 *
 *   POST — create a new appointment (public; rate-limited).
 *   GET  — list the authenticated customer's appointments.
 *
 * Side-effects on POST (best-effort, after the DB transaction commits):
 *   - Telegram notification for the customer (if linked)
 *   - PostHog `appointment_booked` event
 *
 * Email confirmation is intentionally TODO — a React Email template for
 * appointments will land in a follow-up.
 */
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";

import {
    applyRateLimit,
    created,
    fail,
    getOptionalUser,
    internal,
    ok,
    parseJson,
    parseQuery,
    requireUser,
} from "@/lib/api";
import { appointments, appointmentServices, db, services as servicesTable } from "@/db";
import { sendAppointmentConfirmationEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";
import { ipFromHeaders } from "@/lib/rate-limit";
import { AppointmentError, createAppointment } from "@/lib/booking/appointments";
import { enqueueAppointmentReminders } from "@/lib/booking/reminders";
import { bookAppointmentSchema, listAppointmentsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "booking");
    if (limited) return limited;

    const parsed = await parseJson(req, bookAppointmentSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    const sessionUser = await getOptionalUser();

    let result;
    try {
        result = await createAppointment(input, {
            sessionCustomerId: sessionUser?.customerId,
            ipAddress: ipFromHeaders(req.headers),
            userAgent: req.headers.get("user-agent"),
        });
    } catch (error) {
        if (error instanceof AppointmentError) {
            const status =
                error.code === "slot_unavailable" || error.code === "service_not_found"
                    ? 409
                    : error.code === "waiver_template_missing"
                      ? 503
                      : error.code === "forbidden"
                        ? 403
                        : 400;
            return fail(error.code, error.message, { status });
        }
        console.error("[/api/booking/appointments POST] failed", error);
        return internal();
    }

    capture({
        event: "appointment_booked",
        distinctId: result.customer?.id ?? `email:${result.appointment.customerEmail}`,
        properties: {
            appointment_id: result.appointment.id,
            reference_number: result.appointment.referenceNumber,
            service_count: input.serviceIds.length,
            total_duration_min: result.appointment.totalDurationMin,
            estimated_total: result.appointment.estimatedTotal,
            from_visualizer: Boolean(input.selectedJewelry?.some((j) => j.fromVisualizerLook)),
            customer_created: result.customerCreated,
        },
    });

    // Best-effort email confirmation — never blocks the API response.
    void sendAppointmentConfirmationEmail({
        to: result.appointment.customerEmail,
        customerId: result.customer?.id ?? null,
        referenceNumber: result.appointment.referenceNumber,
        customerFirstName: result.appointment.customerFirstName,
        date: result.appointment.date,
        timeStart: result.appointment.timeStart,
        timeEnd: result.appointment.timeEnd,
        services: result.serviceTitles,
        estimatedTotal: result.appointment.estimatedTotal,
    }).catch((err) => {
        console.error("[appointment] email send failed", err);
    });

    // Schedule the 24h + 2h reminders. The cron sweeper at
    // `/api/cron/booking-reminders` is the production source of truth, so
    // a BullMQ enqueue failure is not fatal — log and continue.
    void enqueueAppointmentReminders(result.appointment).catch((err) => {
        console.error("[appointment] enqueue reminders failed", err);
    });

    return created({
        appointment: {
            id: result.appointment.id,
            referenceNumber: result.appointment.referenceNumber,
            status: result.appointment.status,
            date: result.appointment.date,
            timeStart: result.appointment.timeStart,
            timeEnd: result.appointment.timeEnd,
            totalDurationMin: result.appointment.totalDurationMin,
            estimatedTotal: result.appointment.estimatedTotal,
            services: result.serviceTitles,
            customer: result.customer
                ? {
                      id: result.customer.id,
                      email: result.customer.email,
                      firstName: result.customer.firstName,
                      lastName: result.customer.lastName,
                  }
                : null,
            customerCreated: result.customerCreated,
            createdAt: result.appointment.createdAt,
        },
    });
}

// ---------------------------------------------------------------------------
// GET — list current customer's appointments (with service titles bundled)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAppointmentsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    if (!ctx.customerId) {
        return ok({ appointments: [], count: 0, total: 0, limit: q.limit, offset: q.offset });
    }

    try {
        const today = new Date().toISOString().slice(0, 10);

        const filters = [eq(appointments.customerId, ctx.customerId)];
        if (q.filter === "upcoming") {
            filters.push(gte(appointments.date, today));
            filters.push(notInArray(appointments.status, ["cancelled", "completed", "no_show"]));
        } else if (q.filter === "past") {
            filters.push(lte(appointments.date, today));
        }
        const where = and(...filters);

        const [{ total }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(appointments)
            .where(where);

        const order =
            q.filter === "past"
                ? [desc(appointments.date), desc(appointments.timeStart)]
                : [asc(appointments.date), asc(appointments.timeStart)];

        const rows = await db
            .select({
                id: appointments.id,
                referenceNumber: appointments.referenceNumber,
                status: appointments.status,
                date: appointments.date,
                timeStart: appointments.timeStart,
                timeEnd: appointments.timeEnd,
                totalDurationMin: appointments.totalDurationMin,
                estimatedTotal: appointments.estimatedTotal,
                createdAt: appointments.createdAt,
            })
            .from(appointments)
            .where(where)
            .orderBy(...order)
            .limit(q.limit)
            .offset(q.offset);

        // Hydrate service names in a single follow-up query to avoid n+1.
        const ids = rows.map((r) => r.id);
        const titlesByAppt = new Map<string, string[]>();
        if (ids.length > 0) {
            const titleRows = await db
                .select({
                    appointmentId: appointmentServices.appointmentId,
                    name: servicesTable.name,
                })
                .from(appointmentServices)
                .innerJoin(servicesTable, eq(servicesTable.id, appointmentServices.serviceId))
                .where(inArray(appointmentServices.appointmentId, ids));
            for (const r of titleRows) {
                const list = titlesByAppt.get(r.appointmentId) ?? [];
                list.push(r.name);
                titlesByAppt.set(r.appointmentId, list);
            }
        }

        return ok({
            appointments: rows.map((r) => ({
                ...r,
                services: titlesByAppt.get(r.id) ?? [],
            })),
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/booking/appointments GET] failed", error);
        return internal();
    }
}
