/**
 * PATCH /api/booking/appointments/[id]/reschedule
 *
 * Move an appointment to a new date + time. Re-runs availability inside the
 * same transaction so two concurrent reschedules can't double-book.
 *
 * Body:
 *   { "date": "YYYY-MM-DD", "time": "HH:MM" }
 */
import { applyRateLimit, fail, forbidden, internal, ok, parseJson, requireUser } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { AppointmentError, rescheduleAppointment } from "@/lib/booking/appointments";
import { cancelAppointmentReminders, enqueueAppointmentReminders } from "@/lib/booking/reminders";
import { rescheduleAppointmentSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "booking");
    if (limited) return limited;

    const { id } = await ctx.params;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;
    if (!sess.customerId) return forbidden("Сессия не привязана к покупателю");

    const parsed = await parseJson(req, rescheduleAppointmentSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const updated = await rescheduleAppointment(id, input, {
            customerId: sess.customerId,
        });

        capture({
            event: "appointment_rescheduled",
            distinctId: sess.customerId,
            properties: {
                appointment_id: updated.id,
                reference_number: updated.referenceNumber,
                new_date: updated.date,
                new_time: updated.timeStart,
            },
        });

        // Tear down stale BullMQ jobs and re-enqueue against the new
        // start time. The cron sweeper will not re-fire reminders that
        // were already sent for the old slot — `notification_log` keeps
        // them indexed by `appointmentId`, so a back-to-back reschedule
        // cannot produce duplicate emails.
        void (async () => {
            try {
                await cancelAppointmentReminders(updated.id);
                await enqueueAppointmentReminders(updated);
            } catch (err) {
                console.error("[appointment.reschedule] reminders sync failed", err);
            }
        })();

        return ok({
            appointment: {
                id: updated.id,
                referenceNumber: updated.referenceNumber,
                status: updated.status,
                date: updated.date,
                timeStart: updated.timeStart,
                timeEnd: updated.timeEnd,
                updatedAt: updated.updatedAt,
            },
        });
    } catch (error) {
        if (error instanceof AppointmentError) {
            const status =
                error.code === "not_found"
                    ? 404
                    : error.code === "forbidden"
                      ? 403
                      : error.code === "slot_unavailable"
                        ? 409
                        : error.code === "invalid_state"
                          ? 409
                          : 400;
            return fail(error.code, error.message, { status });
        }
        console.error("[/api/booking/appointments/:id/reschedule] failed", error);
        return internal();
    }
}
