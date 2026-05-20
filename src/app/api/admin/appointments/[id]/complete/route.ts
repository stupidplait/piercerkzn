/**
 * POST /api/admin/appointments/[id]/complete
 *
 * Admin/staff transitions an appointment to `completed`, creates an
 * `aftercare_tracking` row, and kicks off the aftercare drip sequence
 * (Day 1 / Week 1 / Week 2 / Month 1). Idempotent — re-posting on an
 * already-completed appointment returns 200 with `trackingCreated: false`
 * and does not enqueue duplicates.
 *
 * Body (optional):
 *   {
 *     "completionNotes": "Прокол прошёл хорошо, корочки нормальные",
 *     "piercingType": "helix"  // override service-derived value
 *   }
 */
import { applyRateLimit, fail, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { AppointmentError, completeAppointment } from "@/lib/booking/appointments";
import { enqueueAftercareDrip } from "@/lib/aftercare/reminders";
import { cancelAppointmentReminders } from "@/lib/booking/reminders";
import { enqueueDownsizeReminder } from "@/lib/downsize/reminders";
import { enqueueSatisfactionSurvey } from "@/lib/satisfaction/reminders";
import { getAftercareSettings } from "@/lib/settings";
import { completeAppointmentSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "booking");
    if (limited) return limited;

    const { id } = await ctx.params;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    let input: { completionNotes?: string; piercingType?: string } = {};
    if (req.headers.get("content-length") && req.headers.get("content-type")?.includes("json")) {
        const parsed = await parseJson(req, completeAppointmentSchema);
        if (!parsed.ok) return parsed.response!;
        input = parsed.data!;
    }

    try {
        const result = await completeAppointment(id, input);

        capture({
            event: "appointment_completed",
            distinctId: result.appointment.customerId ?? `appt:${result.appointment.id}`,
            properties: {
                appointment_id: result.appointment.id,
                reference_number: result.appointment.referenceNumber,
                tracking_created: result.trackingCreated,
                piercing_type: result.tracking.piercingType,
            },
        });

        // Post-tx side effects — never gate the response on these.
        // Booking reminders are obsolete once the appointment has happened.
        void cancelAppointmentReminders(result.appointment.id).catch((err) => {
            console.error("[appointment.complete] cancel reminders failed", err);
        });
        // Only schedule a fresh drip if we just created the tracking row;
        // a re-post that found an existing row must not re-enqueue.
        if (result.trackingCreated) {
            void enqueueAftercareDrip(result.tracking).catch((err) => {
                console.error("[appointment.complete] enqueue aftercare failed", err);
            });
            void (async () => {
                try {
                    const settings = await getAftercareSettings();
                    if (settings.downsizePiercingTypes.includes(result.tracking.piercingType)) {
                        await enqueueDownsizeReminder(result.tracking, settings);
                    }
                } catch (err) {
                    console.error("[appointment.complete] enqueue downsize failed", err);
                }
            })();
        }
        // Satisfaction survey fires for every successful completion regardless
        // of whether tracking was just created — re-completing an already-
        // completed appointment is idempotent at the send layer.
        if (result.appointment.completedAt) {
            void enqueueSatisfactionSurvey(
                result.appointment,
                result.appointment.completedAt
            ).catch((err) => {
                console.error("[appointment.complete] enqueue satisfaction failed", err);
            });
        }

        return ok({
            appointment: {
                id: result.appointment.id,
                referenceNumber: result.appointment.referenceNumber,
                status: result.appointment.status,
                completedAt: result.appointment.completedAt,
                completionNotes: result.appointment.completionNotes,
            },
            tracking: {
                id: result.tracking.id,
                piercingType: result.tracking.piercingType,
                piercingDate: result.tracking.piercingDate,
                guideId: result.tracking.guideId,
                isActive: result.tracking.isActive,
                created: result.trackingCreated,
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
        console.error("[/api/admin/appointments/:id/complete] failed", error);
        return internal();
    }
}
