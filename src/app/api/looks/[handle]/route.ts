/**
 * GET /api/looks/[handle] — single curated look with hydrated pieces.
 *
 * Each piece resolves to:
 *   { piercingPoint, variant: { id, title, sku, price, productHandle, productTitle } }
 */
import { and, asc, eq } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { curatedLooks, db, lookPieces, piercingPoints, productVariants, products } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ handle: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { handle } = await ctx.params;
    if (!handle || handle.length > 100) return notFound("Сет не найден");

    try {
        const [look] = await db
            .select()
            .from(curatedLooks)
            .where(and(eq(curatedLooks.handle, handle), eq(curatedLooks.isPublished, true)))
            .limit(1);
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
                id: look.id,
                handle: look.handle,
                title: look.title,
                description: look.description,
                bodyArea: look.bodyArea,
                bodyModelId: look.bodyModelId,
                thumbnailUrl: look.thumbnailUrl,
                cameraState: look.cameraState,
                totalIndividualPrice: look.totalIndividualPrice,
                bundlePrice: look.bundlePrice,
                discountPercent: look.discountPercent,
                currencyCode: look.currencyCode,
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
                createdAt: look.createdAt,
                updatedAt: look.updatedAt,
            },
        });
    } catch (error) {
        console.error("[/api/looks/:handle] failed", error);
        return internal();
    }
}
