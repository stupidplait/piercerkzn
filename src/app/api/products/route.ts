/**
 * GET /api/products — paginated, filterable product catalogue.
 *
 * Query params validated via `listProductsQuerySchema` (Phase 4):
 *   material, type, area, gauge, categoryId, minPrice, maxPrice, search,
 *   sort, inStockOnly, limit, offset.
 *
 * Returns minimum-viable product cards with the cheapest variant priced;
 * full variant data is fetched on the detail endpoint.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { applyRateLimit, internal, ok, parseQuery } from "@/lib/api";
import { listProductsQuerySchema } from "@/lib/validations";
import { db, productPiercingAreas, products, productVariants } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const limited = await applyRateLimit(req, "auth"); // re-use generic IP limiter
    if (limited) return limited;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listProductsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        // ---------------------------------------------------------------
        // Filters
        // ---------------------------------------------------------------
        const filters = [eq(products.status, "published"), isNull(products.deletedAt)];
        if (q.material) filters.push(eq(products.material, q.material));
        if (q.type) filters.push(eq(products.jewelryType, q.type));
        if (q.categoryId) filters.push(eq(products.categoryId, q.categoryId));
        // Russian-language full-text search backed by `idx_product_search`
        // (GIN over to_tsvector('russian', title || ' ' || description) —
        // see migration 0003_product_fts.sql). `plainto_tsquery` accepts
        // free-form user input safely (no operator parsing).
        if (q.search) {
            filters.push(
                sql`to_tsvector('russian', coalesce(${products.title}, '') || ' ' || coalesce(${products.description}, '')) @@ plainto_tsquery('russian', ${q.search})`
            );
        }

        if (q.area) {
            const subq = db
                .select({ pid: productPiercingAreas.productId })
                .from(productPiercingAreas)
                .where(eq(productPiercingAreas.piercingArea, q.area));
            filters.push(inArray(products.id, subq));
        }

        // ---------------------------------------------------------------
        // Sorting
        // ---------------------------------------------------------------
        // Relevance is only meaningful with a search term; otherwise fall
        // through to newest. ts_rank_cd is computed server-side via the same
        // expression that's indexed, so the planner can reuse it.
        const useRelevance = q.sort === "relevance" && Boolean(q.search);
        const sortClause = (() => {
            switch (q.sort) {
                case "newest":
                    return desc(products.createdAt);
                case "price_asc":
                    return asc(sql`min_price`);
                case "price_desc":
                    return desc(sql`min_price`);
                case "rating":
                case "popularity":
                    // Placeholder until reviews / analytics are wired in Phase 6.x.
                    return desc(products.createdAt);
                case "relevance":
                    return useRelevance
                        ? desc(sql`ts_rank_cd(
                                to_tsvector('russian', coalesce(${products.title}, '') || ' ' || coalesce(${products.description}, '')),
                                plainto_tsquery('russian', ${q.search})
                            )`)
                        : desc(products.createdAt);
                default:
                    return desc(products.createdAt);
            }
        })();

        // ---------------------------------------------------------------
        // Aggregate cheapest variant per product in one query
        // ---------------------------------------------------------------
        const minPriceSql = sql<number>`min(${productVariants.priceRub})`.as("min_price");
        const inStockSql = sql<boolean>`bool_or(${productVariants.inventoryQuantity} > 0)`.as(
            "in_stock"
        );

        const baseQuery = db
            .select({
                id: products.id,
                handle: products.handle,
                title: products.title,
                thumbnailUrl: products.thumbnailUrl,
                material: products.material,
                jewelryType: products.jewelryType,
                has3dModel: products.has3dModel,
                createdAt: products.createdAt,
                minPrice: minPriceSql,
                inStock: inStockSql,
            })
            .from(products)
            .leftJoin(
                productVariants,
                and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt))
            )
            .where(and(...filters))
            .groupBy(products.id);

        // Price filter applied after grouping (HAVING-equivalent)
        const havings = [];
        if (q.minPrice !== undefined) havings.push(gte(minPriceSql, q.minPrice));
        if (q.maxPrice !== undefined) havings.push(lte(minPriceSql, q.maxPrice));
        if (q.inStockOnly) havings.push(eq(inStockSql, true));

        const finalQuery = havings.length > 0 ? baseQuery.having(and(...havings)) : baseQuery;

        const rows = await finalQuery.orderBy(sortClause).limit(q.limit).offset(q.offset);

        const [{ total }] = await db
            .select({ total: sql<number>`count(distinct ${products.id})::int` })
            .from(products)
            .leftJoin(
                productVariants,
                and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt))
            )
            .where(and(...filters));

        return ok({
            products: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/products] failed", error);
        return internal();
    }
}
