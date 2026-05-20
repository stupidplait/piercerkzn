import type { Metadata } from "next";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db, productPiercingAreas, products, productVariants } from "@/db";
import { getProductFacetsCached } from "@/lib/products/catalog-cache";

import { CatalogGrid } from "./CatalogGrid";
import type { ProductCardData } from "./CatalogGrid";
import styles from "./catalog.module.css";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
    title: "Каталог украшений — PiercerKZN",
    description:
        "Ювелирные украшения для пирсинга из титана, золота и ниобия. Фильтры по материалу, типу и зоне прокола.",
    openGraph: {
        title: "Каталог украшений — PiercerKZN",
        description: "Ювелирные украшения для пирсинга из титана, золота и ниобия.",
        url: "https://piercerkzn.ru/catalog",
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "Каталог украшений — PiercerKZN",
        description: "Ювелирные украшения для пирсинга из титана, золота и ниобия.",
    },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const VALID_SORTS = ["newest", "price_asc", "price_desc", "relevance"] as const;
type SortOption = (typeof VALID_SORTS)[number];

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

interface CatalogPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
    const params = await searchParams;

    // Parse query params
    const material = typeof params.material === "string" ? params.material : undefined;
    const type = typeof params.type === "string" ? params.type : undefined;
    const area = typeof params.area === "string" ? params.area : undefined;
    const minPrice =
        typeof params.minPrice === "string" ? parseInt(params.minPrice, 10) : undefined;
    const maxPrice =
        typeof params.maxPrice === "string" ? parseInt(params.maxPrice, 10) : undefined;
    const search = typeof params.search === "string" ? params.search.slice(0, 200) : undefined;
    const sortParam = typeof params.sort === "string" ? params.sort : "newest";
    const sort: SortOption = VALID_SORTS.includes(sortParam as SortOption)
        ? (sortParam as SortOption)
        : "newest";
    const page = typeof params.page === "string" ? Math.max(1, parseInt(params.page, 10) || 1) : 1;
    const offset = (page - 1) * PAGE_SIZE;

    // Fetch facets (cached) and products in parallel
    const [facets, { products: productRows, total }] = await Promise.all([
        getProductFacetsCached(),
        fetchCatalogProducts({
            material,
            type,
            area,
            minPrice: minPrice && !isNaN(minPrice) ? minPrice : undefined,
            maxPrice: maxPrice && !isNaN(maxPrice) ? maxPrice : undefined,
            search,
            sort,
            limit: PAGE_SIZE,
            offset,
        }),
    ]);

    return (
        <div className={styles.catalogPage}>
            <header className={styles.catalogHeader}>
                <h1 className={styles.catalogTitle}>Каталог</h1>
                <p className={styles.catalogSubtitle}>
                    Украшения для пирсинга из премиальных материалов
                </p>
            </header>

            <CatalogGrid
                initialProducts={productRows}
                initialTotal={total}
                initialFacets={facets}
                initialLimit={PAGE_SIZE}
                initialOffset={offset}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Data fetching (direct DB query)
// ---------------------------------------------------------------------------

interface FetchParams {
    material?: string;
    type?: string;
    area?: string;
    minPrice?: number;
    maxPrice?: number;
    search?: string;
    sort: SortOption;
    limit: number;
    offset: number;
}

async function fetchCatalogProducts(
    params: FetchParams
): Promise<{ products: ProductCardData[]; total: number }> {
    const { material, type, area, minPrice, maxPrice, search, sort, limit, offset } = params;

    // Build filters
    const filters = [eq(products.status, "published"), isNull(products.deletedAt)];

    if (material) filters.push(eq(products.material, material));
    if (type) filters.push(eq(products.jewelryType, type));
    if (search) {
        filters.push(
            sql`to_tsvector('russian', coalesce(${products.title}, '') || ' ' || coalesce(${products.description}, '')) @@ plainto_tsquery('russian', ${search})`
        );
    }
    if (area) {
        const subq = db
            .select({ pid: productPiercingAreas.productId })
            .from(productPiercingAreas)
            .where(eq(productPiercingAreas.piercingArea, area));
        filters.push(inArray(products.id, subq));
    }

    // Sort clause
    const useRelevance = sort === "relevance" && Boolean(search);
    const minPriceSql = sql<number>`min(${productVariants.priceRub})`.as("min_price");
    const inStockSql = sql<boolean>`bool_or(${productVariants.inventoryQuantity} > 0)`.as(
        "in_stock"
    );

    const sortClause = (() => {
        switch (sort) {
            case "newest":
                return desc(products.createdAt);
            case "price_asc":
                return asc(sql`min_price`);
            case "price_desc":
                return desc(sql`min_price`);
            case "relevance":
                return useRelevance
                    ? desc(
                          sql`ts_rank_cd(
                              to_tsvector('russian', coalesce(${products.title}, '') || ' ' || coalesce(${products.description}, '')),
                              plainto_tsquery('russian', ${search})
                          )`
                      )
                    : desc(products.createdAt);
            default:
                return desc(products.createdAt);
        }
    })();

    // Base query with aggregation
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

    // Price filter (HAVING)
    const havings = [];
    if (minPrice !== undefined) havings.push(gte(minPriceSql, minPrice));
    if (maxPrice !== undefined) havings.push(lte(minPriceSql, maxPrice));

    const finalQuery = havings.length > 0 ? baseQuery.having(and(...havings)) : baseQuery;

    // Execute query + count in parallel
    const [rows, countResult] = await Promise.all([
        finalQuery.orderBy(sortClause).limit(limit).offset(offset),
        db
            .select({ total: sql<number>`count(distinct ${products.id})::int` })
            .from(products)
            .leftJoin(
                productVariants,
                and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt))
            )
            .where(and(...filters)),
    ]);

    const productCards: ProductCardData[] = rows.map((row) => ({
        id: row.id,
        handle: row.handle,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        material: row.material,
        jewelryType: row.jewelryType,
        has3dModel: row.has3dModel ?? false,
        minPrice: row.minPrice,
        inStock: row.inStock ?? false,
    }));

    return {
        products: productCards,
        total: countResult[0]?.total ?? 0,
    };
}
