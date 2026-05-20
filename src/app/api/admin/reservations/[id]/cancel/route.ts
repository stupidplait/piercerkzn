/**
 * POST /api/admin/reservations/[id]/cancel — admin-initiated cancel.
 *
 * Reuses the existing `cancelReservation('studio', reason)` helper, which
 * restores inventory atomically. Idempotent.
 */
import { fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { cancelReservation } from "@/lib/reservations";
import { cancelReservationSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    let reason: string | undefined;
    if (req.headers.get("content-length") && req.headers.get("content-type")?.includes("json")) {
        const parsed = await parseJson(req, cancelReservationSchema);
        if (!parsed.ok) return parsed.response!;
        reason = parsed.data!.reason;
    }

    try {
        const updated = await cancelReservation(id, { actor: "studio", reason });
        if (!updated) return notFound("Бронь не найдена");

        if (updated.status !== "cancelled") {
            // helper returned the row unchanged because it was already in a
            // non-pending / non-confirmed state.
            return fail("invalid_state", "Эту бронь уже нельзя отменить", { status: 409 });
        }

        capture({
            event: "reservation_cancelled_admin",
            distinctId: updated.customerId ?? `res:${updated.id}`,
            properties: {
                reservation_id: updated.id,
                reference_number: updated.referenceNumber,
                actor: "studio",
            },
        });

        return ok({ reservation: updated });
    } catch (error) {
        console.error("[/api/admin/reservations/:id/cancel] failed", error);
        return internal();
    }
}
