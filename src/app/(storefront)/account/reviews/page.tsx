import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { db, reviews, products } from "@/db";

import styles from "./reviews.module.css";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const customerReviews = await db
        .select({
            id: reviews.id,
            type: reviews.type,
            rating: reviews.rating,
            title: reviews.title,
            content: reviews.content,
            status: reviews.status,
            createdAt: reviews.createdAt,
            productId: reviews.productId,
            productTitle: products.title,
            productHandle: products.handle,
        })
        .from(reviews)
        .leftJoin(products, eq(reviews.productId, products.id))
        .where(eq(reviews.customerId, customerId))
        .orderBy(desc(reviews.createdAt));

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Мои отзывы</h1>

            {customerReviews.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>Вы ещё не оставляли отзывов</p>
                    <Link href="/catalog" className={styles.ctaLink}>
                        Посмотреть каталог
                    </Link>
                </div>
            ) : (
                <ul className={styles.list}>
                    {customerReviews.map((review) => (
                        <li key={review.id} className={styles.card}>
                            <div className={styles.cardHeader}>
                                <div className={styles.productInfo}>
                                    {review.productTitle ? (
                                        <Link
                                            href={`/catalog/${review.productHandle}`}
                                            className={styles.productLink}
                                        >
                                            {review.productTitle}
                                        </Link>
                                    ) : (
                                        <span className={styles.studioLabel}>Отзыв о студии</span>
                                    )}
                                </div>
                                <div className={styles.rating}>{renderStars(review.rating)}</div>
                            </div>
                            {review.content && (
                                <p className={styles.contentPreview}>
                                    {review.content.length > 100
                                        ? review.content.slice(0, 100) + "…"
                                        : review.content}
                                </p>
                            )}
                            <div className={styles.cardFooter}>
                                <span className={styles.cardDate}>
                                    {review.createdAt ? formatDate(review.createdAt) : "—"}
                                </span>
                                <Link
                                    href={`/account/reviews/${review.id}/edit`}
                                    className={styles.editLink}
                                >
                                    Редактировать
                                </Link>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Helpers ──

function renderStars(rating: number): string {
    return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function formatDate(date: Date): string {
    return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Moscow",
    });
}
