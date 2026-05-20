/**
 * GET /api/wishlist/share/[token] — public read-only view of a shared wishlist.
 *
 * The token is an HMAC-derived share key (see `@/lib/wishlist`); anyone with
 * the URL can view, owner identity is not exposed beyond first-name initials.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { customers, db, productCategories, productVariants, products, wishlistItems } from "@/db";
import { verifyWishlistShareToken } from "@/lib/wishlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ token: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { token } = await ctx.params;

    const customerId = verifyWishlistShareToken(token);
    if (!customerId) return notFound("Список не найден");

    try {
        const [owner] = await db
            .select({
                id: customers.id,
                firstName: customers.firstName,
                lastName: customers.lastName,
                deletedAt: customers.deletedAt,
            })
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1);

        if (!owner || owner.deletedAt) return notFound("Список не найден");

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
            .where(and(eq(wishlistItems.customerId, customerId), isNull(products.deletedAt)))
            .orderBy(desc(wishlistItems.createdAt));

        const ownerLabel = [owner.firstName, owner.lastName ? `${owner.lastName[0]}.` : ""]
            .filter(Boolean)
            .join(" ")
            .trim();

        return ok({
            owner: { name: ownerLabel || "Аноним" },
            items: rows,
            count: rows.length,
        });
    } catch (error) {
        console.error("[/api/wishlist/share/:token] failed", error);
        return internal();
    }
}
