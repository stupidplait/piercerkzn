/**
 * /api/admin/products/[id]/media/[mediaId]
 *
 *   PATCH  — partial update. `isPrimary: true` atomically demotes the existing
 *            primary and updates the denormalized `products.thumbnail_url`.
 *            `isPrimary: false` only succeeds if at least one OTHER media row
 *            is already primary, otherwise the product would be left with no
 *            primary media (use the dedicated "set primary" flow on a
 *            different row to swap).
 *   DELETE — drop the row. If it was primary, `products.thumbnail_url` is
 *            cleared and the product is left without a primary until an admin
 *            sets a new one.
 */
import { and, eq, ne } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, productMedia, productVariants, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { updateProductMediaSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string; mediaId: string }>;
}

async function loadMediaOwned(
    productId: string,
    mediaId: string
): Promise<typeof productMedia.$inferSelect | null> {
    const [row] = await db
        .select()
        .from(productMedia)
        .where(and(eq(productMedia.productId, productId), eq(productMedia.id, mediaId)))
        .limit(1);
    return row ?? null;
}

async function isProductPublished(productId: string): Promise<boolean> {
    const [row] = await db
        .select({ status: products.status })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
    return row?.status === "published";
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id, mediaId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateProductMediaSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const media = await loadMediaOwned(id, mediaId);
        if (!media) return notFound("Файл не найден");

        // If a variantId was supplied, ensure it belongs to this product.
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

        const patch: Partial<typeof productMedia.$inferInsert> = { updatedAt: new Date() };
        if (input.url !== undefined) patch.url = input.url;
        if (input.alt !== undefined) patch.alt = input.alt;
        if (input.kind !== undefined) patch.kind = input.kind;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
        if (input.variantId !== undefined) patch.variantId = input.variantId;
        if (input.metadata !== undefined) patch.metadata = input.metadata;
        // isPrimary handled below — needs the demote-old/set-new dance.

        const updated = await db.transaction(async (tx) => {
            // Step 1: handle the primary flip if requested.
            if (input.isPrimary === true && !media.isPrimary) {
                await tx
                    .update(productMedia)
                    .set({ isPrimary: false, updatedAt: new Date() })
                    .where(
                        and(
                            eq(productMedia.productId, id),
                            eq(productMedia.isPrimary, true),
                            ne(productMedia.id, mediaId)
                        )
                    );
                patch.isPrimary = true;
            } else if (input.isPrimary === false && media.isPrimary) {
                // Refuse: can't demote the only primary without picking a successor.
                throw new Error("CANNOT_DEMOTE_LONE_PRIMARY");
            }

            const [row] = await tx
                .update(productMedia)
                .set(patch)
                .where(eq(productMedia.id, mediaId))
                .returning();

            // Sync denormalized thumbnail cache when this row becomes primary
            // OR when the URL of the existing primary changes.
            const becamePrimary = input.isPrimary === true && !media.isPrimary;
            const isPrimaryUrlEdit = media.isPrimary && input.url !== undefined;
            if (becamePrimary || isPrimaryUrlEdit) {
                await tx
                    .update(products)
                    .set({ thumbnailUrl: row.url, updatedAt: new Date() })
                    .where(eq(products.id, id));
            }

            return row;
        });

        if (await isProductPublished(id)) {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ media: updated });
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "CANNOT_DEMOTE_LONE_PRIMARY") {
            return fail(
                "cannot_demote_lone_primary",
                "Нельзя снять флаг 'основной' с единственного основного файла. Сначала пометьте другой файл как основной.",
                { status: 409 }
            );
        }
        console.error("[/api/admin/products/:id/media/:mediaId PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id, mediaId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const media = await loadMediaOwned(id, mediaId);
        if (!media) return notFound("Файл не найден");

        await db.transaction(async (tx) => {
            await tx.delete(productMedia).where(eq(productMedia.id, mediaId));
            if (media.isPrimary) {
                // Clear the denormalized thumbnail cache; admins must pick a
                // new primary explicitly.
                await tx
                    .update(products)
                    .set({ thumbnailUrl: null, updatedAt: new Date() })
                    .where(eq(products.id, id));
            }
        });

        if (await isProductPublished(id)) {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ deleted: true, wasPrimary: media.isPrimary });
    } catch (error) {
        console.error("[/api/admin/products/:id/media/:mediaId DELETE] failed", error);
        return internal();
    }
}
