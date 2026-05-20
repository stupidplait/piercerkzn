/**
 * Cached read-models for the public catalog surface.
 *
 * These helpers wrap the catalog DB queries that the storefront hits on
 * every page load (homepage hero categories, filter sidebar facets, nav
 * dropdown). They share a single 10-minute TTL — the catalog only changes
 * when an admin publishes/archives a product or edits a category, both of
 * which call `invalidateCatalogCache()`.
 *
 * Cache miss cost is ~30ms per query; cache hit is a Redis GET (~1ms).
 * Stale-while-revalidate keeps the SSR p50 flat even during a TTL refresh.
 */
import "server-only";

import { and, asc, eq, isNull, max, min, sql } from "drizzle-orm";

import { cacheKey, delByPattern, getOrSet } from "@/lib/cache";
import { db, productCategories, productPiercingAreas, productVariants, products } from "@/db";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export interface CatalogCategory {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    parentId: string | null;
    sortOrder: number | null;
}

async function loadActiveCategoriesFromDb(): Promise<CatalogCategory[]> {
    return db
        .select({
            id: productCategories.id,
            handle: productCategories.handle,
            name: productCategories.name,
            description: productCategories.description,
            imageUrl: productCategories.imageUrl,
            parentId: productCategories.parentId,
            sortOrder: productCategories.sortOrder,
        })
        .from(productCategories)
        .where(eq(productCategories.isActive, true))
        .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
}

/**
 * Active product categories, used by `/api/categories` and the nav
 * dropdown. Cached 10 min with ±10% jitter; refresh in the background on
 * cache staleness.
 */
export async function getActiveCategoriesCached(): Promise<CatalogCategory[]> {
    return getOrSet(cacheKey.activeCategories(), { ttlSeconds: 600 }, loadActiveCategoriesFromDb);
}

// ---------------------------------------------------------------------------
// Catalogue facets (filter sidebar)
// ---------------------------------------------------------------------------
export interface ProductFacets {
    /** Distinct materials present in published products, with counts. */
    materials: Array<{ value: string; count: number }>;
    /** Distinct jewelry types (stud / hoop / barbell / …), with counts. */
    jewelryTypes: Array<{ value: string; count: number }>;
    /** Distinct piercing areas (ear_helix / nose_septum / …), with counts. */
    piercingAreas: Array<{ value: string; count: number }>;
    /** Price bounds across all active variants of published products
     *  (RUB integers). `null` when the catalog is empty. */
    priceBounds: { minRub: number | null; maxRub: number | null };
    /** Total number of published, non-deleted products. */
    totalProducts: number;
}

async function loadProductFacetsFromDb(): Promise<ProductFacets> {
    // All facet queries scope to: published + non-soft-deleted products.
    const publishedFilter = and(eq(products.status, "published"), isNull(products.deletedAt));

    const [materialRows, typeRows, areaRows, priceRow, totalRow] = await Promise.all([
        db
            .select({
                value: products.material,
                count: sql<number>`count(*)::int`.as("count"),
            })
            .from(products)
            .where(publishedFilter)
            .groupBy(products.material)
            .orderBy(asc(products.material)),

        db
            .select({
                value: products.jewelryType,
                count: sql<number>`count(*)::int`.as("count"),
            })
            .from(products)
            .where(publishedFilter)
            .groupBy(products.jewelryType)
            .orderBy(asc(products.jewelryType)),

        db
            .select({
                value: productPiercingAreas.piercingArea,
                count: sql<number>`count(distinct ${productPiercingAreas.productId})::int`.as(
                    "count"
                ),
            })
            .from(productPiercingAreas)
            .innerJoin(products, eq(products.id, productPiercingAreas.productId))
            .where(publishedFilter)
            .groupBy(productPiercingAreas.piercingArea)
            .orderBy(asc(productPiercingAreas.piercingArea)),

        db
            .select({
                minRub: min(productVariants.priceRub),
                maxRub: max(productVariants.priceRub),
            })
            .from(productVariants)
            .innerJoin(products, eq(products.id, productVariants.productId))
            .where(and(publishedFilter, isNull(productVariants.deletedAt))),

        db
            .select({ n: sql<number>`count(*)::int`.as("n") })
            .from(products)
            .where(publishedFilter),
    ]);

    return {
        materials: materialRows.map((r) => ({
            value: r.value,
            count: r.count,
        })),
        jewelryTypes: typeRows.map((r) => ({
            value: r.value,
            count: r.count,
        })),
        piercingAreas: areaRows.map((r) => ({
            value: r.value,
            count: r.count,
        })),
        priceBounds: {
            minRub: priceRow[0]?.minRub ?? null,
            maxRub: priceRow[0]?.maxRub ?? null,
        },
        totalProducts: totalRow[0]?.n ?? 0,
    };
}

/**
 * Filter-sidebar facets across the entire published catalog. Cached 10
 * min — invalidated by `invalidateCatalogCache()` whenever an admin
 * publishes / archives / edits a product or category.
 */
export async function getProductFacetsCached(): Promise<ProductFacets> {
    return getOrSet(cacheKey.productFacets(), { ttlSeconds: 600 }, loadProductFacetsFromDb);
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/**
 * Drop every cached catalog read-model. Call from admin save paths whenever
 * a product or category is created / edited / published / archived.
 */
export async function invalidateCatalogCache(): Promise<void> {
    await Promise.all([
        delByPattern("categories:*"),
        delByPattern("products:facets:*"),
        delByPattern("site:nav"),
    ]);
}
