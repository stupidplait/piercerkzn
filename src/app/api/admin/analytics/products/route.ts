/**
 * GET /api/admin/analytics/products
 *
 * - Best sellers (by units reserved that were actually picked up)
 * - Worst-performing published products (zero picked-up reservations in window)
 * - Low-stock variants (inventory_quantity ≤ low_stock_threshold)
 *
 * "Best sellers" requires reservation_items aggregated to product level over
 * picked-up reservations within the window.
 */
import { and, asc, between, desc, eq, isNull, lte, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import {
    db,
    productCategories,
    productVariants,
    products,
    reservationItems,
    reservations,
} from "@/db";
import { resolveAnalyticsRange } from "@/lib/admin/analytics";
import { analyticsRangeSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_N = 20;
const LOW_STOCK_LIMIT = 50;

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, analyticsRangeSchema);
    if (!parsed.ok) return parsed.response!;
    const range = resolveAnalyticsRange(parsed.data!);

    try {
        const pickedUpInWindow = and(
            eq(reservations.status, "picked_up"),
            between(reservations.pickedUpAt, range.from, range.to)
        );

        const [topSellers, lowStock] = await Promise.all([
            db
                .select({
                    productId: products.id,
                    handle: products.handle,
                    title: products.title,
                    categoryName: productCategories.name,
                    units: sql<number>`coalesce(sum(${reservationItems.quantity}), 0)::int`,
                    revenue: sql<number>`coalesce(sum(${reservationItems.total}), 0)::int`,
                    orderCount: sql<number>`count(distinct ${reservations.id})::int`,
                })
                .from(reservationItems)
                .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
                .innerJoin(products, eq(products.id, reservationItems.productId))
                .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
                .where(pickedUpInWindow)
                .groupBy(products.id, products.handle, products.title, productCategories.name)
                .orderBy(desc(sql`coalesce(sum(${reservationItems.quantity}), 0)`))
                .limit(TOP_N),
            db
                .select({
                    variantId: productVariants.id,
                    productId: productVariants.productId,
                    productHandle: products.handle,
                    productTitle: products.title,
                    variantTitle: productVariants.title,
                    sku: productVariants.sku,
                    inventoryQuantity: productVariants.inventoryQuantity,
                    lowStockThreshold: productVariants.lowStockThreshold,
                })
                .from(productVariants)
                .innerJoin(products, eq(products.id, productVariants.productId))
                .where(
                    and(
                        eq(productVariants.manageInventory, true),
                        isNull(productVariants.deletedAt),
                        isNull(products.deletedAt),
                        eq(products.status, "published"),
                        // <= threshold (default 3 per schema)
                        lte(
                            productVariants.inventoryQuantity,
                            sql<number>`coalesce(${productVariants.lowStockThreshold}, 3)`
                        )
                    )
                )
                .orderBy(asc(productVariants.inventoryQuantity))
                .limit(LOW_STOCK_LIMIT),
        ]);

        // "Worst" = published products with zero picked-up reservations in window.
        // Use a NOT EXISTS pattern.
        const inactive = await db
            .select({
                id: products.id,
                handle: products.handle,
                title: products.title,
                createdAt: products.createdAt,
            })
            .from(products)
            .where(
                and(
                    eq(products.status, "published"),
                    isNull(products.deletedAt),
                    sql`not exists (
                        select 1 from ${reservationItems}
                        join ${reservations} on ${reservations.id} = ${reservationItems.reservationId}
                        where ${reservationItems.productId} = ${products.id}
                          and ${reservations.status} = 'picked_up'
                          and ${reservations.pickedUpAt} between ${range.from} and ${range.to}
                    )`
                )
            )
            .limit(TOP_N);

        return ok({
            products: {
                period: range.period,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                topSellers: topSellers.map((r) => ({
                    productId: r.productId,
                    handle: r.handle,
                    title: r.title,
                    category: r.categoryName,
                    units: r.units,
                    revenue: r.revenue,
                    orderCount: r.orderCount,
                })),
                inactiveInWindow: inactive,
                lowStock,
            },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/products] failed", error);
        return internal();
    }
}
