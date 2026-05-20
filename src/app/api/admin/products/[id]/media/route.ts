/**
 * /api/admin/products/[id]/media
 *
 *   GET  — list every media row attached to the product (ordered: primary
 *          first, then sortOrder asc, then newest as a stable tiebreaker).
 *   POST — attach a new media row. The URL must already exist on R2/CDN —
 *          callers obtain it via /api/uploads/presign + /api/uploads/finalize.
 *          Setting `isPrimary: true` atomically demotes the existing primary
 *          and updates the denormalized `products.thumbnail_url` cache.
 */
import { and, asc, desc, eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, productMedia, productVariants, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { attachProductMediaSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [product] = await db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.id, id))
            .limit(1);
        if (!product) return notFound("Товар не найден");

        const rows = await db
            .select()
            .from(productMedia)
            .where(eq(productMedia.productId, id))
            .orderBy(
                desc(productMedia.isPrimary),
                asc(productMedia.sortOrder),
                desc(productMedia.createdAt)
            );

        return ok({ media: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/products/:id/media GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — attach
// ---------------------------------------------------------------------------
export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, attachProductMediaSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [product] = await db
            .select({
                id: products.id,
                status: products.status,
                deletedAt: products.deletedAt,
            })
            .from(products)
            .where(eq(products.id, id))
            .limit(1);
        if (!product) return notFound("Товар не найден");
        if (product.deletedAt) {
            return fail("product_soft_deleted", "Товар удалён", { status: 409 });
        }

        // Validate variant ownership if a variantId was supplied.
        if (input.variantId) {
            const [variant] = await db
                .select({ id: productVariants.id })
                .from(productVariants)
                .where(
                    and(eq(productVariants.id, input.variantId), eq(productVariants.productId, id))
                )
                .limit(1);
            if (!variant) {
                return fail("variant_not_found", "Указанный вариант не принадлежит товару", {
                    status: 400,
                });
            }
        }

        const created = await db.transaction(async (tx) => {
            // If the new row claims primary, demote the current primary first
            // to satisfy `uq_product_media_primary` (partial unique index).
            if (input.isPrimary) {
                await tx
                    .update(productMedia)
                    .set({ isPrimary: false, updatedAt: new Date() })
                    .where(and(eq(productMedia.productId, id), eq(productMedia.isPrimary, true)));
            }

            const [row] = await tx
                .insert(productMedia)
                .values({
                    productId: id,
                    variantId: input.variantId ?? null,
                    url: input.url,
                    alt: input.alt ?? null,
                    kind: input.kind,
                    isPrimary: input.isPrimary,
                    sortOrder: input.sortOrder,
                    metadata: input.metadata ?? {},
                })
                .returning();

            // Sync the denormalized thumbnail cache when the new row is primary.
            if (input.isPrimary) {
                await tx
                    .update(products)
                    .set({ thumbnailUrl: input.url, updatedAt: new Date() })
                    .where(eq(products.id, id));
            }

            return row;
        });

        if (product.status === "published") {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ media: created }, { status: 201 });
    } catch (error) {
        console.error("[/api/admin/products/:id/media POST] failed", error);
        return internal();
    }
}
