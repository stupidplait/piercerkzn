/**
 * /api/admin/products — admin catalogue management.
 *
 *   GET  — list (filterable, includes draft / archived, optionally soft-deleted).
 *   POST — create a new product (optional initial piercingAreas[]).
 *
 * Admin-gated. The public list at `/api/products` only ever exposes
 * `status='published'` and `deleted_at IS NULL`; this admin endpoint lifts
 * both filters and is the source of truth for the studio CMS.
 */
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    ok,
    parseJson,
    parseQuery,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, productPiercingAreas, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { adminListProductsQuerySchema, createProductSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — admin list
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListProductsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (!q.includeDeleted) filters.push(isNull(products.deletedAt));
        if (q.status) filters.push(eq(products.status, q.status));
        if (q.material) filters.push(eq(products.material, q.material));
        if (q.type) filters.push(eq(products.jewelryType, q.type));
        if (q.categoryId) filters.push(eq(products.categoryId, q.categoryId));
        if (q.search) {
            const like = `%${q.search}%`;
            filters.push(or(ilike(products.title, like), ilike(products.handle, like))!);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy = (() => {
            switch (q.sort) {
                case "newest":
                    return [desc(products.createdAt)];
                case "price_asc":
                case "price_desc":
                    // No per-product price aggregation in this admin list — the
                    // editor doesn't need it, and computing it would require the
                    // same variant JOIN as the public endpoint. Fall back to
                    // newest so the UI behaves predictably.
                    return [desc(products.createdAt)];
                default:
                    return [desc(products.createdAt)];
            }
        })();

        const baseQuery = db
            .select({
                id: products.id,
                handle: products.handle,
                title: products.title,
                status: products.status,
                material: products.material,
                jewelryType: products.jewelryType,
                isFeatured: products.isFeatured,
                has3dModel: products.has3dModel,
                thumbnailUrl: products.thumbnailUrl,
                categoryId: products.categoryId,
                publishedAt: products.publishedAt,
                createdAt: products.createdAt,
                updatedAt: products.updatedAt,
                deletedAt: products.deletedAt,
            })
            .from(products);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(products);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            products: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/products GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createProductSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        // Pre-flight uniqueness check so we can return a friendly 409 instead
        // of a raw 23505 from Postgres.
        const [existing] = await db
            .select({ id: products.id, deletedAt: products.deletedAt })
            .from(products)
            .where(eq(products.handle, input.handle))
            .limit(1);
        if (existing) {
            if (existing.deletedAt) {
                return fail(
                    "handle_in_use_soft_deleted",
                    "Слаг занят товаром в корзине. Восстановите его или используйте другой слаг.",
                    { status: 409 }
                );
            }
            return fail("handle_in_use", "Слаг уже используется", { status: 409 });
        }

        const now = new Date();
        const status = input.status;
        const publishedAt = status === "published" ? now : null;

        const [created] = await db
            .insert(products)
            .values({
                handle: input.handle,
                title: input.title,
                description: input.description ?? null,
                categoryId: input.categoryId ?? null,
                material: input.material,
                jewelryType: input.jewelryType,
                threading: input.threading ?? null,
                status,
                publishedAt,
                isFeatured: input.isFeatured,
                has3dModel: input.has3dModel,
                thumbnailUrl: input.thumbnailUrl ?? null,
                metaTitle: input.metaTitle ?? null,
                metaDescription: input.metaDescription ?? null,
                ogImageUrl: input.ogImageUrl ?? null,
                metadata: input.metadata ?? {},
            })
            .returning();

        if (input.piercingAreas && input.piercingAreas.length > 0) {
            // De-dupe in case the client sent the same area twice.
            const uniqueAreas = Array.from(new Set(input.piercingAreas));
            await db
                .insert(productPiercingAreas)
                .values(uniqueAreas.map((area) => ({ productId: created.id, piercingArea: area })))
                .onConflictDoNothing({
                    target: [productPiercingAreas.productId, productPiercingAreas.piercingArea],
                });
        }

        // Invalidate the public catalog cache only when the new product is
        // immediately visible; drafts stay private until a separate publish.
        if (status === "published") {
            void invalidateCatalogCache().catch((err) =>
                console.warn("[admin.products POST] cache invalidate failed", err)
            );
        }

        return ok({ product: created }, { status: 201 });
    } catch (error: unknown) {
        // Belt-and-braces — the pre-flight check above should catch unique
        // collisions, but a concurrent create could still race us.
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая категория", { status: 400 });
        }
        console.error("[/api/admin/products POST] failed", error);
        return internal();
    }
}
