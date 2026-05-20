/**
 * POST /api/admin/reservations/[id]/confirm — flip status to `confirmed`.
 *
 * Idempotent: re-confirming an already-confirmed reservation returns the same
 * row without writing. Rejected for terminal states (cancelled / expired /
 * picked_up).
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

const TERMINAL = new Set(["cancelled", "expired", "picked_up"]);

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

            if (row.status === "confirmed") {
                return ok({ reservation: row });
            }
            if (TERMINAL.has(row.status ?? "")) {
                return fail("invalid_state", "Эту бронь уже нельзя подтвердить", { status: 409 });
            }

            const [updated] = await tx
                .update(reservations)
                .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
                .where(eq(reservations.id, id))
                .returning();

            capture({
                event: "reservation_confirmed",
                distinctId: updated.customerId ?? `res:${updated.id}`,
                properties: {
                    reservation_id: updated.id,
                    reference_number: updated.referenceNumber,
                },
            });

            return ok({ reservation: updated });
        });
    } catch (error) {
        console.error("[/api/admin/reservations/:id/confirm] failed", error);
        return internal();
    }
}
