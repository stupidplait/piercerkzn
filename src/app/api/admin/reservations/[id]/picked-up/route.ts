/**
 * POST /api/admin/reservations/[id]/picked-up — finalize the hold.
 *
 * Acceptable transitions: pending | confirmed → picked_up.
 * Already-`picked_up` returns the same row (idempotent).
 */
import { eq } from "drizzle-orm";

import { fail, internal, notFound, ok, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, reservations } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    try {
        return await db.transaction(async (tx) => {
            const [row] = await tx
                .select()
                .from(reservations)
                .where(eq(reservations.id, id))
                .limit(1)
                .for("update");
            if (!row) return notFound("Бронь не найдена");

            if (row.status === "picked_up") {
                return ok({ reservation: row });
            }
            if (row.status !== "pending" && row.status !== "confirmed") {
                return fail("invalid_state", "Эту бронь нельзя отметить как выданную", {
                    status: 409,
                });
            }

            const now = new Date();
            const [updated] = await tx
                .update(reservations)
                .set({
                    status: "picked_up",
                    pickedUpAt: now,
                    confirmedAt: row.confirmedAt ?? now,
                    updatedAt: now,
                })
                .where(eq(reservations.id, id))
                .returning();

            capture({
                event: "reservation_picked_up",
                distinctId: updated.customerId ?? `res:${updated.id}`,
                properties: {
                    reservation_id: updated.id,
                    reference_number: updated.referenceNumber,
                },
            });

            return ok({ reservation: updated });
        });
    } catch (error) {
        console.error("[/api/admin/reservations/:id/picked-up] failed", error);
        return internal();
    }
}
