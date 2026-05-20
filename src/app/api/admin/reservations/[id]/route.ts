/**
 * GET /api/admin/reservations/[id] — full reservation detail with items.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { db, reservationItems, reservations } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    try {
        const [row] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
        if (!row) return notFound("Бронь не найдена");

        const items = await db
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, row.id));

        return ok({ reservation: { ...row, items } });
    } catch (error) {
        console.error("[/api/admin/reservations/:id] failed", error);
        return internal();
    }
}
