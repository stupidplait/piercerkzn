/**
 * POST /api/reservations/[id]/cancel — customer-initiated cancellation.
 *
 * Authorization: owning customer or admin. Restoring inventory happens
 * inside `cancelReservation()`.
 */
import { eq } from "drizzle-orm";

import { fail, forbidden, getOptionalUser, internal, notFound, ok, parseJson } from "@/lib/api";
import { db, reservations } from "@/db";
import { capture } from "@/lib/posthog";
import { cancelReservation } from "@/lib/reservations";
import { cancelReservationSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;

    const parsed = await parseJson(req, cancelReservationSchema);
    if (!parsed.ok) return parsed.response!;
    const { reason } = parsed.data!;

    const sessionUser = await getOptionalUser();
    if (!sessionUser) return forbidden();

    const [existing] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!existing) return notFound("Бронь не найдена");

    const isOwner = sessionUser.customerId && existing.customerId === sessionUser.customerId;
    const isAdmin = sessionUser.role === "admin" || sessionUser.role === "staff";
    if (!isOwner && !isAdmin) return forbidden();

    if (existing.status !== "pending" && existing.status !== "confirmed") {
        return fail("invalid_status", "Эту бронь нельзя отменить", {
            status: 409,
            details: { currentStatus: existing.status },
        });
    }

    try {
        const updated = await cancelReservation(id, {
            actor: isAdmin ? "studio" : "customer",
            reason,
        });
        if (!updated) return notFound();

        capture({
            event: "reservation_cancelled",
            distinctId: existing.customerId ?? `email:${existing.customerEmail}`,
            properties: {
                reservation_id: existing.id,
                reference_number: existing.referenceNumber,
                actor: isAdmin ? "studio" : "customer",
            },
        });

        return ok({
            reservation: {
                id: updated.id,
                referenceNumber: updated.referenceNumber,
                status: updated.status,
                cancelledAt: updated.cancelledAt,
            },
        });
    } catch (error) {
        console.error("[/api/reservations/[id]/cancel] failed", error);
        return internal();
    }
}
