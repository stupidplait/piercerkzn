/**
 * GET /api/products/[handle] — full product detail with variants and
 * piercing areas.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import {
    db,
    productCategories,
    productMedia,
    productPiercingAreas,
    products,
    productVariants,
} from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
    const { handle } = await ctx.params;

    try {
        const [product] = await db
            .select({
                id: products.id,
                handle: products.handle,
                title: products.title,
                description: products.description,
                thumbnailUrl: products.thumbnailUrl,
                material: products.material,
                jewelryType: products.jewelryType,
                threading: products.threading,
                has3dModel: products.has3dModel,
                metadata: products.metadata,
                metaTitle: products.metaTitle,
                metaDescription: products.metaDescription,
                ogImageUrl: products.ogImageUrl,
                createdAt: products.createdAt,
                updatedAt: products.updatedAt,
                category: {
                    id: productCategories.id,
                    name: productCategories.name,
                    handle: productCategories.handle,
                },
            })
            .from(products)
            .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
            .where(
                and(
                    eq(products.handle, handle),
                    eq(products.status, "published"),
                    isNull(products.deletedAt)
                )
            )
            .limit(1);

        if (!product) return notFound("Украшение не найдено");

        const [variants, areas, media] = await Promise.all([
            db
                .select({
                    id: productVariants.id,
                    title: productVariants.title,
                    sku: productVariants.sku,
                    materialFinish: productVariants.materialFinish,
                    gauge: productVariants.gauge,
                    lengthMm: productVariants.lengthMm,
                    diameterMm: productVariants.diameterMm,
                    gemType: productVariants.gemType,
                    gemColor: productVariants.gemColor,
                    priceRub: productVariants.priceRub,
                    originalPriceRub: productVariants.originalPriceRub,
                    inventoryQuantity: productVariants.inventoryQuantity,
                    imageUrl: productVariants.imageUrl,
                    sortOrder: productVariants.sortOrder,
                })
                .from(productVariants)
                .where(
                    and(
                        eq(productVariants.productId, product.id),
                        isNull(productVariants.deletedAt)
                    )
                )
                .orderBy(productVariants.sortOrder),
            db
                .select({ piercingArea: productPiercingAreas.piercingArea })
                .from(productPiercingAreas)
                .where(eq(productPiercingAreas.productId, product.id)),
            // Media: primary first, then by sortOrder ascending, then newest first
            // as a stable tiebreaker. Variant-scoped rows are included so the
            // storefront can group them by variant when rendering swatches.
            db
                .select({
                    id: productMedia.id,
                    variantId: productMedia.variantId,
                    url: productMedia.url,
                    alt: productMedia.alt,
                    kind: productMedia.kind,
                    isPrimary: productMedia.isPrimary,
                    sortOrder: productMedia.sortOrder,
                })
                .from(productMedia)
                .where(eq(productMedia.productId, product.id))
                .orderBy(
                    desc(productMedia.isPrimary),
                    asc(productMedia.sortOrder),
                    desc(productMedia.createdAt)
                ),
        ]);

        return ok({
            product: {
                ...product,
                variants: variants.map((v) => ({
                    ...v,
                    inStock: (v.inventoryQuantity ?? 0) > 0,
                })),
                piercingAreas: areas.map((a) => a.piercingArea),
                media,
            },
        });
    } catch (error) {
        console.error("[/api/products/[handle]] failed", error);
        return internal();
    }
}
