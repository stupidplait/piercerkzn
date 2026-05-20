/**
 * /api/admin/looks/[id]
 *
 *   GET    — full detail with hydrated pieces (mirrors the public response
 *            shape but works for unpublished looks).
 *   PATCH  — partial update. When `bundlePrice` changes, the cached
 *            `discountPercent` is recomputed inside a transaction so it
 *            stays in sync with `totalIndividualPrice`.
 *   DELETE — hard delete (cascades to `look_piece` via FK).
 */
import { asc, eq } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    notFound,
    ok,
    parseJson,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import {
    bodyModels,
    curatedLooks,
    db,
    lookPieces,
    piercingPoints,
    productVariants,
    products,
} from "@/db";
import { recalcLookTotals } from "@/lib/looks/recalc";
import { updateCuratedLookSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [look] = await db.select().from(curatedLooks).where(eq(curatedLooks.id, id)).limit(1);
        if (!look) return notFound("Сет не найден");

        const pieceRows = await db
            .select({
                id: lookPieces.id,
                sortOrder: lookPieces.sortOrder,
                piercingPointId: piercingPoints.id,
                piercingPointName: piercingPoints.name,
                piercingPointDisplayName: piercingPoints.displayName,
                variantId: productVariants.id,
                variantTitle: productVariants.title,
                variantSku: productVariants.sku,
                variantPriceRub: productVariants.priceRub,
                productId: products.id,
                productHandle: products.handle,
                productTitle: products.title,
                productThumbnailUrl: products.thumbnailUrl,
            })
            .from(lookPieces)
            .innerJoin(piercingPoints, eq(piercingPoints.id, lookPieces.piercingPointId))
            .innerJoin(productVariants, eq(productVariants.id, lookPieces.variantId))
            .innerJoin(products, eq(products.id, productVariants.productId))
            .where(eq(lookPieces.lookId, look.id))
            .orderBy(asc(lookPieces.sortOrder));

        return ok({
            look: {
                ...look,
                pieces: pieceRows.map((p) => ({
                    id: p.id,
                    sortOrder: p.sortOrder,
                    piercingPoint: {
                        id: p.piercingPointId,
                        name: p.piercingPointName,
                        displayName: p.piercingPointDisplayName,
                    },
                    variant: {
                        id: p.variantId,
                        title: p.variantTitle,
                        sku: p.variantSku,
                        priceRub: p.variantPriceRub,
                    },
                    product: {
                        id: p.productId,
                        handle: p.productHandle,
                        title: p.productTitle,
                        thumbnailUrl: p.productThumbnailUrl,
                    },
                })),
            },
        });
    } catch (error) {
        console.error("[/api/admin/looks/:id GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateCuratedLookSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select()
            .from(curatedLooks)
            .where(eq(curatedLooks.id, id))
            .limit(1);
        if (!existing) return notFound("Сет не найден");

        // Auto-fill body_area when the body model changes and the caller
        // didn't explicitly override.
        let bodyArea = input.bodyArea;
        if (
            input.bodyModelId !== undefined &&
            input.bodyModelId !== existing.bodyModelId &&
            bodyArea === undefined
        ) {
            const [model] = await db
                .select({ area: bodyModels.area })
                .from(bodyModels)
                .where(eq(bodyModels.id, input.bodyModelId))
                .limit(1);
            if (!model) {
                return fail("body_model_not_found", "3D модель не найдена", { status: 400 });
            }
            bodyArea = model.area;
        }

        const patch: Partial<typeof curatedLooks.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (input.handle !== undefined) patch.handle = input.handle;
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.bodyModelId !== undefined) patch.bodyModelId = input.bodyModelId;
        if (bodyArea !== undefined) patch.bodyArea = bodyArea;
        if (input.thumbnailUrl !== undefined) patch.thumbnailUrl = input.thumbnailUrl;
        if (input.bundlePrice !== undefined) patch.bundlePrice = input.bundlePrice;
        if (input.totalIndividualPrice !== undefined)
            patch.totalIndividualPrice = input.totalIndividualPrice;
        if (input.currencyCode !== undefined) patch.currencyCode = input.currencyCode;
        if (input.cameraState !== undefined) patch.cameraState = input.cameraState;
        if (input.isPublished !== undefined) patch.isPublished = input.isPublished;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

        const updated = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(curatedLooks)
                .set(patch)
                .where(eq(curatedLooks.id, id))
                .returning();

            // Whenever bundlePrice changes, recompute discountPercent so the
            // cached value stays consistent with totalIndividualPrice.
            if (input.bundlePrice !== undefined) {
                const totals = await recalcLookTotals(tx, id);
                return { ...row, ...totals };
            }
            return row;
        });

        return ok({ look: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг сета уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая 3D модель", { status: 400 });
        }
        console.error("[/api/admin/looks/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — hard (FK cascades to look_piece)
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [existing] = await db
            .select({ id: curatedLooks.id })
            .from(curatedLooks)
            .where(eq(curatedLooks.id, id))
            .limit(1);
        if (!existing) return notFound("Сет не найден");

        await db.delete(curatedLooks).where(eq(curatedLooks.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/looks/:id DELETE] failed", error);
        return internal();
    }
}
