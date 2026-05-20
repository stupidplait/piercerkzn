"use server";

/**
 * Server-action wrappers around the appointment domain logic.
 *
 * Forms (the public `/booking` flow, the customer's `/account` page) can
 * call these directly instead of going through `/api/booking/appointments`.
 * The authoritative business logic lives in `@/lib/booking/appointments`;
 * both surfaces share it.
 *
 * Mirrors the shape of `@/src/actions/reservation.ts`:
 *
 *   1. Validate with the shared zod schema.
 *   2. Call the domain helper, mapping `AppointmentError` to a typed
 *      `ActionResult` failure.
 *   3. Fire the Phase C side-effect cascade (BullMQ reminders, email,
 *      PostHog) **outside** the DB transaction. Failures here are logged
 *      but never roll the action back — the cron sweeper / next sync is
 *      the production source of truth.
 */
import { headers } from "next/headers";

import { sendAppointmentConfirmationEmail } from "@/emails/dispatch";
import { auth } from "@/lib/auth";
import {
    AppointmentError,
    cancelAppointment as cancelAppointmentDomain,
    createAppointment,
    rescheduleAppointment as rescheduleAppointmentDomain,
} from "@/lib/booking/appointments";
import { cancelAppointmentReminders, enqueueAppointmentReminders } from "@/lib/booking/reminders";
import { capture, getPostHogSessionId } from "@/lib/posthog";
import { ipFromHeaders } from "@/lib/rate-limit";
import {
    bookAppointmentSchema,
    cancelAppointmentSchema,
    rescheduleAppointmentSchema,
} from "@/lib/validations";

import type { ActionResult } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map an `AppointmentError` into a stable `ActionResult` failure code so
 * UIs can pattern-match without coupling to the route handler.
 */
function failureFromAppointmentError(error: AppointmentError): ActionResult<never> {
    return { ok: false, error: { code: error.code, message: error.message } };
}

/**
 * Read IP + user-agent off the current request without requiring a
 * `Request` argument. Server actions don't expose `req`, but `headers()`
 * gives us the same data.
 */
async function readRequestSignals(): Promise<{
    ipAddress: string | null;
    userAgent: string | null;
    sessionId: string | null;
}> {
    try {
        const h = await headers();
        // `ipFromHeaders` returns "unknown" rather than null when nothing
        // matches; normalise to `null` for the DB column shape.
        const ip = ipFromHeaders(h);
        return {
            ipAddress: ip && ip !== "unknown" ? ip : null,
            userAgent: h.get("user-agent"),
            sessionId: getPostHogSessionId(h),
        };
    } catch {
        return { ipAddress: null, userAgent: null, sessionId: null };
    }
}

// ---------------------------------------------------------------------------
// createAppointmentAction
// ---------------------------------------------------------------------------
export async function createAppointmentAction(raw: unknown): Promise<
    ActionResult<{
        appointmentId: string;
        referenceNumber: string;
        date: string;
        timeStart: string;
        timeEnd: string;
        services: string[];
        customerId: string | null;
        customerCreated: boolean;
        /** Only set when the action created a brand-new customer account. */
        temporaryPassword: string | null;
    }>
> {
    const parsed = bookAppointmentSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: {
                code: "validation_error",
                message: "Проверьте корректность введённых данных",
                details: parsed.error.issues.map((i) => ({
                    path: i.path.join("."),
                    message: i.message,
                })),
            },
        };
    }

    const session = await auth();
    const signals = await readRequestSignals();

    try {
        const result = await createAppointment(parsed.data, {
            sessionCustomerId: session?.user?.customerId,
            ipAddress: signals.ipAddress,
            userAgent: signals.userAgent,
        });

        // -------------------------------------------------------------------
        // Side effects (best-effort). Anything that throws here is logged
        // but never rolls back the appointment — `notification_log` +
        // the cron sweepers guarantee eventual consistency.
        // -------------------------------------------------------------------
        capture({
            event: "appointment_booked",
            distinctId: result.customer?.id ?? `email:${result.appointment.customerEmail}`,
            sessionId: signals.sessionId ?? undefined,
            properties: {
                appointment_id: result.appointment.id,
                reference_number: result.appointment.referenceNumber,
                service_count: parsed.data.serviceIds.length,
                total_duration_min: result.appointment.totalDurationMin,
                estimated_total: result.appointment.estimatedTotal,
                from_visualizer: Boolean(
                    parsed.data.selectedJewelry?.some((j) => j.fromVisualizerLook)
                ),
                customer_created: result.customerCreated,
                via: "server_action",
            },
        });

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
            console.error("[appointment.action] email send failed", err);
        });

        void enqueueAppointmentReminders(result.appointment).catch((err) => {
            console.error("[appointment.action] enqueue reminders failed", err);
        });

        return {
            ok: true,
            data: {
                appointmentId: result.appointment.id,
                referenceNumber: result.appointment.referenceNumber,
                date: result.appointment.date,
                timeStart: result.appointment.timeStart,
                timeEnd: result.appointment.timeEnd,
                services: result.serviceTitles,
                customerId: result.customer?.id ?? null,
                customerCreated: result.customerCreated,
                temporaryPassword: result.temporaryPassword,
            },
        };
    } catch (error) {
        if (error instanceof AppointmentError) {
            return failureFromAppointmentError(error);
        }
        console.error("[createAppointmentAction] failed", error);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}

// ---------------------------------------------------------------------------
// cancelAppointmentAction
// ---------------------------------------------------------------------------
export async function cancelAppointmentAction(
    appointmentId: string,
    raw: unknown
): Promise<
    ActionResult<{
        appointmentId: string;
        status: string | null;
        cancelledAt: Date | null;
    }>
> {
    const parsed = cancelAppointmentSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: {
                code: "validation_error",
                message: "Некорректные данные",
                details: parsed.error.issues.map((i) => ({
                    path: i.path.join("."),
                    message: i.message,
                })),
            },
        };
    }

    const session = await auth();
    if (!session?.user?.id) {
        return { ok: false, error: { code: "unauthorized", message: "Требуется авторизация" } };
    }

    const role = session.user.role;
    const isStudio = role === "admin" || role === "staff";

    try {
        const updated = await cancelAppointmentDomain(appointmentId, {
            actor: isStudio ? "studio" : "customer",
            customerId: session.user.customerId,
            reason: parsed.data.reason,
        });

        const cancelSignals = await readRequestSignals();
        capture({
            event: "appointment_cancelled",
            distinctId: updated.customerId ?? `appt:${updated.id}`,
            sessionId: cancelSignals.sessionId ?? undefined,
            properties: {
                appointment_id: updated.id,
                reference_number: updated.referenceNumber,
                actor: isStudio ? "studio" : "customer",
                via: "server_action",
            },
        });

        // BullMQ delayed-job cleanup. The cron sweeper's status filter
        // also guards against post-cancel sends, so an unreachable
        // Redis is non-fatal.
        void cancelAppointmentReminders(updated.id).catch((err) => {
            console.error("[appointment.action.cancel] reminders cleanup failed", err);
        });

        return {
            ok: true,
            data: {
                appointmentId: updated.id,
                status: updated.status,
                cancelledAt: updated.cancelledAt,
            },
        };
    } catch (error) {
        if (error instanceof AppointmentError) {
            return failureFromAppointmentError(error);
        }
        console.error("[cancelAppointmentAction] failed", error);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}

// ---------------------------------------------------------------------------
// rescheduleAppointmentAction
// ---------------------------------------------------------------------------
export async function rescheduleAppointmentAction(
    appointmentId: string,
    raw: unknown
): Promise<
    ActionResult<{
        appointmentId: string;
        status: string | null;
        date: string;
        timeStart: string;
        timeEnd: string;
        updatedAt: Date | null;
    }>
> {
    const parsed = rescheduleAppointmentSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: {
                code: "validation_error",
                message: "Проверьте дату и время",
                details: parsed.error.issues.map((i) => ({
                    path: i.path.join("."),
                    message: i.message,
                })),
            },
        };
    }

    const session = await auth();
    if (!session?.user?.customerId) {
        return {
            ok: false,
            error: { code: "unauthorized", message: "Сессия не привязана к покупателю" },
        };
    }

    try {
        const updated = await rescheduleAppointmentDomain(appointmentId, parsed.data, {
            customerId: session.user.customerId,
        });

        const rescheduleSignals = await readRequestSignals();
        capture({
            event: "appointment_rescheduled",
            distinctId: session.user.customerId,
            sessionId: rescheduleSignals.sessionId ?? undefined,
            properties: {
                appointment_id: updated.id,
                reference_number: updated.referenceNumber,
                new_date: updated.date,
                new_time: updated.timeStart,
                via: "server_action",
            },
        });

        // Tear down the stale BullMQ reminder jobs and re-enqueue against
        // the new start time. The cron sweeper + `notification_log`
        // idempotency prevents duplicate sends for a back-to-back move.
        void (async () => {
            try {
                await cancelAppointmentReminders(updated.id);
                await enqueueAppointmentReminders(updated);
            } catch (err) {
                console.error("[appointment.action.reschedule] reminders sync failed", err);
            }
        })();

        return {
            ok: true,
            data: {
                appointmentId: updated.id,
                status: updated.status,
                date: updated.date,
                timeStart: updated.timeStart,
                timeEnd: updated.timeEnd,
                updatedAt: updated.updatedAt,
            },
        };
    } catch (error) {
        if (error instanceof AppointmentError) {
            return failureFromAppointmentError(error);
        }
        console.error("[rescheduleAppointmentAction] failed", error);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}
