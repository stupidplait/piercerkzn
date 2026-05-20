/**
 * /api/admin/products/[id]
 *
 *   GET    — full admin detail: product + variants + areas + media.
 *   PATCH  — partial update of mutable fields. Re-stamps `publishedAt` on
 *            first transition into `published`. Returns 409 on handle
 *            collisions, 400 on bad category FK.
 *   DELETE — soft delete via `deletedAt`, also flips status to `archived`
 *            so the new-arrival fanout and storefront stop considering it.
 *            Pass `?hard=true` to permanently delete (variants + areas +
 *            media cascade).
 *
 * Publish lives at `./publish/route.ts` (it does fanout + cache work that
 * doesn't belong in a generic PATCH).
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";

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
import { db, productMedia, productPiercingAreas, products, productVariants } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { updateProductSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET — admin detail (includes drafts, archived, and soft-deleted)
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
        if (!product) return notFound("Товар не найден");

        const [variants, areas, media] = await Promise.all([
            db
                .select()
                .from(productVariants)
                .where(and(eq(productVariants.productId, id), isNull(productVariants.deletedAt)))
                .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt)),
            db
                .select({ piercingArea: productPiercingAreas.piercingArea })
                .from(productPiercingAreas)
                .where(eq(productPiercingAreas.productId, id)),
            db
                .select()
                .from(productMedia)
                .where(eq(productMedia.productId, id))
                .orderBy(
                    desc(productMedia.isPrimary),
                    asc(productMedia.sortOrder),
                    desc(productMedia.createdAt)
                ),
        ]);

        return ok({
            product: {
                ...product,
                variants,
                piercingAreas: areas.map((a) => a.piercingArea),
                media,
            },
        });
    } catch (error) {
        console.error("[/api/admin/products/:id GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH — partial update
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateProductSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
        if (!existing) return notFound("Товар не найден");
        if (existing.deletedAt) {
            return fail(
                "product_soft_deleted",
                "Нельзя редактировать удалённый товар. Восстановите его сначала.",
                { status: 409 }
            );
        }

        const patch: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };

        if (input.handle !== undefined) patch.handle = input.handle;
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
        if (input.material !== undefined) patch.material = input.material;
        if (input.jewelryType !== undefined) patch.jewelryType = input.jewelryType;
        if (input.threading !== undefined) patch.threading = input.threading;
        if (input.isFeatured !== undefined) patch.isFeatured = input.isFeatured;
        if (input.has3dModel !== undefined) patch.has3dModel = input.has3dModel;
        if (input.thumbnailUrl !== undefined) patch.thumbnailUrl = input.thumbnailUrl;
        if (input.metaTitle !== undefined) patch.metaTitle = input.metaTitle;
        if (input.metaDescription !== undefined) patch.metaDescription = input.metaDescription;
        if (input.ogImageUrl !== undefined) patch.ogImageUrl = input.ogImageUrl;
        if (input.metadata !== undefined) patch.metadata = input.metadata;

        // Status transitions: first time into `published` stamps publishedAt.
        let publishedTransition = false;
        if (input.status !== undefined && input.status !== existing.status) {
            patch.status = input.status;
            if (input.status === "published" && existing.publishedAt === null) {
                patch.publishedAt = patch.updatedAt;
                publishedTransition = true;
            }
        }

        const [updated] = await db
            .update(products)
            .set(patch)
            .where(eq(products.id, id))
            .returning();

        // Replace piercingAreas if the caller sent the field at all (even if []).
        if (input.piercingAreas !== undefined) {
            await db.delete(productPiercingAreas).where(eq(productPiercingAreas.productId, id));
            const uniqueAreas = Array.from(new Set(input.piercingAreas));
            if (uniqueAreas.length > 0) {
                await db
                    .insert(productPiercingAreas)
                    .values(
                        uniqueAreas.map((area) => ({
                            productId: id,
                            piercingArea: area,
                        }))
                    )
                    .onConflictDoNothing({
                        target: [productPiercingAreas.productId, productPiercingAreas.piercingArea],
                    });
            }
        }

        // Anything that could affect the public list / detail invalidates the
        // catalog cache. Conservatively, we invalidate whenever:
        //   - a freshly-published transition happened, OR
        //   - the product is already published (any field could affect the card).
        const shouldInvalidate =
            publishedTransition ||
            updated.status === "published" ||
            existing.status === "published";
        if (shouldInvalidate) {
            void invalidateCatalogCache().catch((err) =>
                console.warn("[admin.products PATCH] cache invalidate failed", err)
            );
        }

        return ok({ product: updated, publishedTransition });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая категория", { status: 400 });
        }
        console.error("[/api/admin/products/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — soft delete (default) or hard delete with ?hard=true
// ---------------------------------------------------------------------------
export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "true";

    try {
        const [existing] = await db
            .select({
                id: products.id,
                status: products.status,
                deletedAt: products.deletedAt,
            })
            .from(products)
            .where(eq(products.id, id))
            .limit(1);
        if (!existing) return notFound("Товар не найден");

        if (hard) {
            // FK cascade handles variants/areas/media.
            await db.delete(products).where(eq(products.id, id));
            void invalidateCatalogCache().catch(() => {});
            return ok({ deleted: true, mode: "hard" });
        }

        if (existing.deletedAt) {
            return ok({ deleted: true, mode: "soft", alreadyDeleted: true });
        }

        const now = new Date();
        const [softDeleted] = await db
            .update(products)
            .set({ deletedAt: now, status: "archived", updatedAt: now })
            .where(eq(products.id, id))
            .returning({ id: products.id, deletedAt: products.deletedAt, status: products.status });

        // Was visible to the public; clear the cache.
        if (existing.status === "published") {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ deleted: true, mode: "soft", product: softDeleted });
    } catch (error) {
        console.error("[/api/admin/products/:id DELETE] failed", error);
        return internal();
    }
}
