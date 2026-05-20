/**
 * /api/wishlist
 *
 *   GET    — list current customer's wishlist with hydrated product info.
 *   POST   — add a product (idempotent via the `(customer_id, product_id)` unique
 *            constraint — re-adding returns the existing row).
 *
 * Per-product removal lives at `/api/wishlist/[productId]`.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { forbidden, internal, notFound, ok, parseJson, requireUser } from "@/lib/api";
import { db, productCategories, productVariants, products, wishlistItems } from "@/db";
import { addWishlistItemSchema } from "@/lib/validations";
import { buildWishlistShareToken } from "@/lib/wishlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — current customer's wishlist
// ---------------------------------------------------------------------------
export async function GET() {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;
    if (!ctx.customerId) return forbidden("Сессия не привязана к покупателю");

    try {
        const minPriceSql = sql<number>`(
            select min(${productVariants.priceRub})
            from ${productVariants}
            where ${productVariants.productId} = ${products.id}
              and ${productVariants.deletedAt} is null
        )::int`;

        const rows = await db
            .select({
                productId: products.id,
                handle: products.handle,
                title: products.title,
                thumbnailUrl: products.thumbnailUrl,
                material: products.material,
                jewelryType: products.jewelryType,
                has3dModel: products.has3dModel,
                categoryName: productCategories.name,
                addedAt: wishlistItems.createdAt,
                minPrice: minPriceSql,
            })
            .from(wishlistItems)
            .innerJoin(products, eq(products.id, wishlistItems.productId))
            .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
            .where(and(eq(wishlistItems.customerId, ctx.customerId), isNull(products.deletedAt)))
            .orderBy(desc(wishlistItems.createdAt));

        return ok({
            items: rows,
            count: rows.length,
            shareToken: buildWishlistShareToken(ctx.customerId),
        });
    } catch (error) {
        console.error("[/api/wishlist GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — add a product
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;
    if (!ctx.customerId) return forbidden("Сессия не привязана к покупателю");

    const parsed = await parseJson(req, addWishlistItemSchema);
    if (!parsed.ok) return parsed.response!;
    const { productId } = parsed.data!;

    try {
        const [product] = await db
            .select({ id: products.id, status: products.status, deletedAt: products.deletedAt })
            .from(products)
            .where(eq(products.id, productId))
            .limit(1);
        if (!product || product.deletedAt || product.status !== "published") {
            return notFound("Товар не найден");
        }

        // Insert-or-noop using the unique (customer_id, product_id) constraint.
        const [existing] = await db
            .select()
            .from(wishlistItems)
            .where(
                and(
                    eq(wishlistItems.customerId, ctx.customerId),
                    eq(wishlistItems.productId, productId)
                )
            )
            .limit(1);

        const item =
            existing ??
            (await db
                .insert(wishlistItems)
                .values({ customerId: ctx.customerId, productId })
                .returning()
                .then((r) => r[0]));

        return ok(
            {
                item: {
                    id: item.id,
                    productId: item.productId,
                    addedAt: item.createdAt,
                },
                wasAlreadyPresent: Boolean(existing),
            },
            { status: existing ? 200 : 201 }
        );
    } catch (error) {
        console.error("[/api/wishlist POST] failed", error);
        return internal();
    }
}
