/**
 * POST /api/admin/looks/[id]/pieces/reorder
 *
 * Atomic reorder of an entire piece set. The body is `{ order: [{id, sortOrder}] }`
 * and must be a permutation of the look's pieces (every existing piece id
 * present, no foreign ids). Inside one transaction we update each row's
 * `sort_order` to match.
 *
 * Reordering doesn't change the variant set, so totals don't need recalc.
 */
import { and, eq, inArray } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { curatedLooks, db, lookPieces } from "@/db";
import { reorderLookPiecesSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, reorderLookPiecesSchema);
    if (!parsed.ok) return parsed.response!;
    const { order } = parsed.data!;

    try {
        const [look] = await db
            .select({ id: curatedLooks.id })
            .from(curatedLooks)
            .where(eq(curatedLooks.id, id))
            .limit(1);
        if (!look) return notFound("Сет не найден");

        const requestedIds = order.map((o) => o.id);
        if (new Set(requestedIds).size !== requestedIds.length) {
            return fail("duplicate_piece_id", "Повторяющийся id в order", { status: 400 });
        }

        // The order array must be a permutation of the look's actual pieces.
        // Reject if any id is foreign or any actual id is missing.
        const ownedRows = await db
            .select({ id: lookPieces.id })
            .from(lookPieces)
            .where(eq(lookPieces.lookId, id));
        const ownedIds = new Set(ownedRows.map((r) => r.id));
        if (ownedIds.size !== requestedIds.length) {
            return fail(
                "incomplete_order",
                "order должен содержать все элементы сета (и только их)",
                { status: 400 }
            );
        }
        for (const rid of requestedIds) {
            if (!ownedIds.has(rid)) {
                return fail("foreign_piece_id", `Элемент ${rid} не принадлежит сету`, {
                    status: 400,
                });
            }
        }

        const updated = await db.transaction(async (tx) => {
            const rows: (typeof lookPieces.$inferSelect)[] = [];
            for (const o of order) {
                const [row] = await tx
                    .update(lookPieces)
                    .set({ sortOrder: o.sortOrder })
                    .where(and(eq(lookPieces.id, o.id), eq(lookPieces.lookId, id)))
                    .returning();
                if (row) rows.push(row);
            }
            // Touch parent updatedAt so caches invalidate.
            await tx
                .update(curatedLooks)
                .set({ updatedAt: new Date() })
                .where(eq(curatedLooks.id, id));
            return rows;
        });

        return ok({ pieces: updated, count: updated.length, mode: "reorder" });
    } catch (error) {
        console.error("[/api/admin/looks/:id/pieces/reorder POST] failed", error);
        return internal();
    }
}
