/**
 * /api/admin/looks/[id]/pieces/[pieceId]
 *
 *   PATCH  — partial update of a single piece. Recomputes look totals
 *            when `variantId` changes (since that affects the price sum).
 *   DELETE — remove one piece. Recomputes totals.
 *
 * Cross-look access (piece exists but belongs to a different look) returns
 * 404 to avoid leaking existence.
 */
import { and, eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, lookPieces, piercingPoints, productVariants } from "@/db";
import { recalcLookTotals } from "@/lib/looks/recalc";
import { updateLookPieceSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string; pieceId: string }>;
}

async function loadPieceOwned(lookId: string, pieceId: string) {
    const [row] = await db
        .select()
        .from(lookPieces)
        .where(and(eq(lookPieces.lookId, lookId), eq(lookPieces.id, pieceId)))
        .limit(1);
    return row ?? null;
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id, pieceId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateLookPieceSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const existing = await loadPieceOwned(id, pieceId);
        if (!existing) return notFound("Элемент сета не найден");

        if (input.piercingPointId !== undefined) {
            const [pp] = await db
                .select({ id: piercingPoints.id })
                .from(piercingPoints)
                .where(eq(piercingPoints.id, input.piercingPointId))
                .limit(1);
            if (!pp)
                return fail("piercing_point_not_found", "Точка пирсинга не найдена", {
                    status: 400,
                });
        }
        if (input.variantId !== undefined) {
            const [v] = await db
                .select({ id: productVariants.id })
                .from(productVariants)
                .where(eq(productVariants.id, input.variantId))
                .limit(1);
            if (!v) return fail("variant_not_found", "Вариант не найден", { status: 400 });
        }

        const patch: Partial<typeof lookPieces.$inferInsert> = {};
        if (input.piercingPointId !== undefined) patch.piercingPointId = input.piercingPointId;
        if (input.variantId !== undefined) patch.variantId = input.variantId;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

        const result = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(lookPieces)
                .set(patch)
                .where(eq(lookPieces.id, pieceId))
                .returning();

            // Only recompute totals when the variant changed; sortOrder /
            // piercing-point swaps don't affect the price sum.
            const totals = input.variantId !== undefined ? await recalcLookTotals(tx, id) : null;

            return { piece: updated, totals };
        });

        return ok(result);
    } catch (error) {
        console.error("[/api/admin/looks/:id/pieces/:pieceId PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id, pieceId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const existing = await loadPieceOwned(id, pieceId);
        if (!existing) return notFound("Элемент сета не найден");

        const totals = await db.transaction(async (tx) => {
            await tx.delete(lookPieces).where(eq(lookPieces.id, pieceId));
            return recalcLookTotals(tx, id);
        });

        return ok({ deleted: true, totals });
    } catch (error) {
        console.error("[/api/admin/looks/:id/pieces/:pieceId DELETE] failed", error);
        return internal();
    }
}
