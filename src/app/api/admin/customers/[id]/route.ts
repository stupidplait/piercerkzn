/**
 * GET /api/admin/customers/[id] — customer detail with activity counters.
 *
 * Counters are lightweight aggregates (no row payloads) — enough to render a
 * customer-detail screen without dragging full history into the response.
 */
import { eq, sql } from "drizzle-orm";

import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { appointments, customers, db, reservations, reviews } from "@/db";

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
        const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
        if (!row) return notFound("Профиль не найден");

        const [resCount, apptCount, reviewCount] = await Promise.all([
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(reservations)
                .where(eq(reservations.customerId, id))
                .then((r) => r[0].total),
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(appointments)
                .where(eq(appointments.customerId, id))
                .then((r) => r[0].total),
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(reviews)
                .where(eq(reviews.customerId, id))
                .then((r) => r[0].total),
        ]);

        const adminNotes =
            row.metadata && typeof row.metadata === "object" && "adminNotes" in row.metadata
                ? String((row.metadata as { adminNotes?: unknown }).adminNotes ?? "")
                : "";

        return ok({
            customer: {
                ...row,
                adminNotes,
                stats: {
                    reservations: resCount,
                    appointments: apptCount,
                    reviews: reviewCount,
                },
            },
        });
    } catch (error) {
        console.error("[/api/admin/customers/:id] failed", error);
        return internal();
    }
}
