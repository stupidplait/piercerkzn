import { desc, eq, sql, inArray } from "drizzle-orm";
import Link from "next/link";
import Image from "next/image";

import { auth } from "@/lib/auth";
import { db, wishlistItems, products, productVariants } from "@/db";

import styles from "./wishlist.module.css";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const items = await db
        .select({
            id: wishlistItems.id,
            productId: wishlistItems.productId,
            productTitle: products.title,
            productHandle: products.handle,
            thumbnailUrl: products.thumbnailUrl,
            createdAt: wishlistItems.createdAt,
        })
        .from(wishlistItems)
        .innerJoin(products, eq(wishlistItems.productId, products.id))
        .where(eq(wishlistItems.customerId, customerId))
        .orderBy(desc(wishlistItems.createdAt));

    // Get min price for each product
    const productIds = items.map((i) => i.productId);
    let minPrices: Record<string, number> = {};
    if (productIds.length > 0) {
        const prices = await db
            .select({
                productId: productVariants.productId,
                minPrice: sql<number>`min(${productVariants.priceRub})::int`,
            })
            .from(productVariants)
            .where(inArray(productVariants.productId, productIds))
            .groupBy(productVariants.productId);

        minPrices = prices.reduce(
            (acc, row) => {
                if (row.productId) acc[row.productId] = row.minPrice;
                return acc;
            },
            {} as Record<string, number>
        );
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Избранное</h1>

            {items.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>В избранном пока ничего нет</p>
                    <Link href="/catalog" className={styles.ctaLink}>
                        Перейти в каталог
                    </Link>
                </div>
            ) : (
                <ul className={styles.grid}>
                    {items.map((item) => (
                        <li key={item.id} className={styles.card}>
                            <Link
                                href={`/catalog/${item.productHandle}`}
                                className={styles.cardLink}
                            >
                                <div className={styles.thumbnail}>
                                    {item.thumbnailUrl ? (
                                        <Image
                                            src={item.thumbnailUrl}
                                            alt={item.productTitle}
                                            width={120}
                                            height={120}
                                            className={styles.thumbnailImg}
                                        />
                                    ) : (
                                        <div className={styles.thumbnailPlaceholder} />
                                    )}
                                </div>
                                <div className={styles.cardInfo}>
                                    <span className={styles.cardTitle}>{item.productTitle}</span>
                                    <span className={styles.cardPrice}>
                                        {minPrices[item.productId]
                                            ? `от ${formatPrice(minPrices[item.productId])}`
                                            : "—"}
                                    </span>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function formatPrice(kopecks: number): string {
    return `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}
