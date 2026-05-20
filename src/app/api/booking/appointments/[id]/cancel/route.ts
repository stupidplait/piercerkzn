/**
 * POST /api/booking/appointments/[id]/cancel
 *
 * Soft-cancels an appointment. Customer-initiated cancellations require the
 * caller to own the appointment. Admin-initiated cancellations are accepted
 * from any admin/staff session.
 *
 * Body (optional):
 *   { "reason": "string up to 500 chars" }
 */
import { applyRateLimit, fail, internal, ok, parseJson, requireUser } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { AppointmentError, cancelAppointment } from "@/lib/booking/appointments";
import { cancelAppointmentReminders } from "@/lib/booking/reminders";
import { cancelAppointmentSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "booking");
    if (limited) return limited;

    const { id } = await ctx.params;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    let reason: string | undefined;
    if (req.headers.get("content-length") && req.headers.get("content-type")?.includes("json")) {
        const parsed = await parseJson(req, cancelAppointmentSchema);
        if (!parsed.ok) return parsed.response!;
        reason = parsed.data!.reason;
    }

    const isAdmin = sess.role === "admin" || sess.role === "staff";

    try {
        const updated = await cancelAppointment(id, {
            actor: isAdmin ? "studio" : "customer",
            customerId: sess.customerId,
            reason,
        });

        capture({
            event: "appointment_cancelled",
            distinctId: updated.customerId ?? `appt:${updated.id}`,
            properties: {
                appointment_id: updated.id,
                reference_number: updated.referenceNumber,
                actor: isAdmin ? "studio" : "customer",
            },
        });

        // Best-effort BullMQ cleanup. Cron sweeper additionally guards
        // against post-cancellation reminders via the `pending|confirmed`
        // status filter, so an unreachable Redis is safe here.
        void cancelAppointmentReminders(updated.id).catch((err) => {
            console.error("[appointment.cancel] reminders cleanup failed", err);
        });

        return ok({
            appointment: {
                id: updated.id,
                referenceNumber: updated.referenceNumber,
                status: updated.status,
                cancelledAt: updated.cancelledAt,
            },
        });
    } catch (error) {
        if (error instanceof AppointmentError) {
            const status =
                error.code === "not_found"
                    ? 404
                    : error.code === "forbidden"
                      ? 403
                      : error.code === "invalid_state"
                        ? 409
                        : 400;
            return fail(error.code, error.message, { status });
        }
        console.error("[/api/booking/appointments/:id/cancel] failed", error);
        return internal();
    }
}
