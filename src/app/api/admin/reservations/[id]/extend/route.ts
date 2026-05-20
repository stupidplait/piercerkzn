/**
 * POST /api/admin/reservations/[id]/extend — push `expires_at` further out.
 *
 * Body: { additionalHours: number } (1..168).
 * Allowed only for `pending` and `confirmed` reservations.
 */
import { eq } from "drizzle-orm";

import { fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, reservations } from "@/db";
import { extendReservationSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    const parsed = await parseJson(req, extendReservationSchema);
    if (!parsed.ok) return parsed.response!;
    const { additionalHours } = parsed.data!;

    try {
        return await db.transaction(async (tx) => {
            const [row] = await tx
                .select()
                .from(reservations)
                .where(eq(reservations.id, id))
                .limit(1)
                .for("update");
            if (!row) return notFound("Бронь не найдена");
            if (row.status !== "pending" && row.status !== "confirmed") {
                return fail("invalid_state", "Эту бронь нельзя продлить", { status: 409 });
            }

            const base = row.expiresAt > new Date() ? row.expiresAt : new Date();
            const newExpiresAt = new Date(base.getTime() + additionalHours * 3600 * 1000);

            const [updated] = await tx
                .update(reservations)
                .set({ expiresAt: newExpiresAt, updatedAt: new Date() })
                .where(eq(reservations.id, id))
                .returning();

            capture({
                event: "reservation_extended",
                distinctId: updated.customerId ?? `res:${updated.id}`,
                properties: {
                    reservation_id: updated.id,
                    reference_number: updated.referenceNumber,
                    additional_hours: additionalHours,
                },
            });

            return ok({ reservation: updated });
        });
    } catch (error) {
        console.error("[/api/admin/reservations/:id/extend] failed", error);
        return internal();
    }
}
