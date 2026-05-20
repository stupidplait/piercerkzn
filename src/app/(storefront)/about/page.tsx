import type { Metadata } from "next";

import { asc, desc, eq } from "drizzle-orm";

import { db, piercerProfile, portfolioImages, reviews } from "@/db";
import { customers } from "@/db/schema/customers";

import { PortfolioGallery } from "./PortfolioGallery";
import styles from "./about.module.css";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
    title: "О мастере — PiercerKZN",
    description:
        "Профессиональный пирсер в Казани. Опыт, сертификации, портфолио работ и отзывы клиентов.",
    openGraph: {
        title: "О мастере — PiercerKZN",
        description:
            "Профессиональный пирсер в Казани. Опыт, сертификации, портфолио работ и отзывы клиентов.",
        url: "https://piercerkzn.ru/about",
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "О мастере — PiercerKZN",
        description:
            "Профессиональный пирсер в Казани. Опыт, сертификации, портфолио работ и отзывы клиентов.",
    },
};

// ---------------------------------------------------------------------------
// Config — ISR 5 min
// ---------------------------------------------------------------------------

export const revalidate = 300;

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

export default async function AboutPage() {
    const [profile, portfolio, approvedReviews] = await Promise.all([
        fetchPiercerProfile(),
        fetchPortfolioImages(),
        fetchApprovedReviews(),
    ]);

    // Compute aggregate rating
    const totalReviews = approvedReviews.length;
    const aggregateRating =
        totalReviews > 0
            ? (approvedReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(2)
            : null;

    return (
        <div className={styles.aboutPage}>
            {/* Piercer Hero */}
            {profile && <PiercerHero profile={profile} />}

            {/* Studio Info */}
            <StudioInfo profile={profile} />

            {/* Portfolio Gallery (client component) */}
            <PortfolioGallery images={portfolio} />

            {/* Reviews — hidden when none exist */}
            {totalReviews > 0 && (
                <ReviewsList
                    reviews={approvedReviews}
                    aggregateRating={aggregateRating!}
                    totalCount={totalReviews}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// PiercerHero Section
// ---------------------------------------------------------------------------

interface ProfileData {
    id: string;
    firstName: string;
    lastName: string | null;
    title: string | null;
    bio: string | null;
    avatarUrl: string | null;
    experienceYears: number | null;
    specializations: string[] | null;
    certifications: string[] | null;
    socialInstagram: string | null;
    socialTelegram: string | null;
}

function PiercerHero({ profile }: { profile: ProfileData }) {
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

    return (
        <section className={styles.piercerHero}>
            {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt={fullName} className={styles.heroAvatar} />
            ) : (
                <div className={styles.heroAvatarPlaceholder} aria-hidden="true">
                    AVATAR
                </div>
            )}

            <h1 className={styles.heroName}>{fullName}</h1>

            {profile.title && <p className={styles.heroTitle}>{profile.title}</p>}

            {profile.bio && <p className={styles.heroBio}>{profile.bio}</p>}

            {/* Experience & certs meta */}
            <div className={styles.heroMeta}>
                {profile.experienceYears && (
                    <div className={styles.heroMetaItem}>
                        <span className={styles.heroMetaValue}>{profile.experienceYears}+</span>
                        <span className={styles.heroMetaLabel}>лет опыта</span>
                    </div>
                )}
                {profile.certifications && profile.certifications.length > 0 && (
                    <div className={styles.heroMetaItem}>
                        <span className={styles.heroMetaValue}>
                            {profile.certifications.length}
                        </span>
                        <span className={styles.heroMetaLabel}>сертификатов</span>
                    </div>
                )}
            </div>

            {/* Specializations */}
            {profile.specializations && profile.specializations.length > 0 && (
                <div className={styles.heroTags}>
                    {profile.specializations.map((spec) => (
                        <span key={spec} className={styles.heroTag}>
                            {spec}
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------------
// StudioInfo Section
// ---------------------------------------------------------------------------

function StudioInfo({ profile }: { profile: ProfileData | null }) {
    return (
        <section className={styles.studioInfo}>
            <div className={styles.studioInfoBlock}>
                <h2 className={styles.studioInfoLabel}>Адрес</h2>
                <p className={styles.studioInfoValue}>
                    г. Казань, ул. Баумана, 68
                    {"\n"}(вход со двора, 2 этаж)
                </p>
            </div>

            <div className={styles.studioInfoBlock}>
                <h2 className={styles.studioInfoLabel}>Часы работы</h2>
                <p className={styles.studioInfoValue}>
                    Пн–Пт: 11:00 – 20:00
                    {"\n"}Сб: 12:00 – 18:00
                    {"\n"}Вс: выходной
                </p>
            </div>

            <div className={styles.studioInfoBlock}>
                <h2 className={styles.studioInfoLabel}>Контакты</h2>
                <div className={styles.contactLinks}>
                    {profile?.socialTelegram && (
                        <a
                            href={`https://t.me/${profile.socialTelegram.replace("@", "")}`}
                            className={styles.contactLink}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className={styles.contactLinkIcon}>TG</span>
                            {profile.socialTelegram}
                        </a>
                    )}
                    {profile?.socialInstagram && (
                        <a
                            href={`https://instagram.com/${profile.socialInstagram.replace("@", "")}`}
                            className={styles.contactLink}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className={styles.contactLinkIcon}>IG</span>
                            {profile.socialInstagram}
                        </a>
                    )}
                    <a href="mailto:hello@piercerkzn.ru" className={styles.contactLink}>
                        <span className={styles.contactLinkIcon}>@</span>
                        hello@piercerkzn.ru
                    </a>
                    <a href="tel:+79179999999" className={styles.contactLink}>
                        <span className={styles.contactLinkIcon}>☎</span>
                        +7 (917) 999-99-99
                    </a>
                </div>
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// ReviewsList Section
// ---------------------------------------------------------------------------

interface ReviewData {
    id: string;
    rating: number;
    content: string | null;
    createdAt: Date | null;
    customerFirstName: string;
    customerLastName: string | null;
}

function ReviewsList({
    reviews: reviewList,
    aggregateRating,
    totalCount,
}: {
    reviews: ReviewData[];
    aggregateRating: string;
    totalCount: number;
}) {
    return (
        <section className={styles.reviewsSection}>
            <div className={styles.reviewsHeader}>
                <h2 className={styles.sectionTitle}>Отзывы</h2>
                <div className={styles.reviewsAggregate}>
                    <span className={styles.aggregateRating}>{aggregateRating}</span>
                    <span className={styles.aggregateCount}>
                        из 5 · {totalCount} {pluralizeReviews(totalCount)}
                    </span>
                </div>
            </div>

            <div className={styles.reviewsList}>
                {reviewList.map((review) => (
                    <ReviewCard key={review.id} review={review} />
                ))}
            </div>
        </section>
    );
}

function ReviewCard({ review }: { review: ReviewData }) {
    const authorName = formatAuthorName(review.customerFirstName, review.customerLastName);
    const dateStr = review.createdAt
        ? new Intl.DateTimeFormat("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
          }).format(new Date(review.createdAt))
        : "";

    return (
        <article className={styles.reviewCard}>
            <div className={styles.reviewTop}>
                <span className={styles.reviewRating}>
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}
                </span>
                <span className={styles.reviewAuthor}>{authorName}</span>
                {dateStr && <span className={styles.reviewDate}>{dateStr}</span>}
            </div>
            {review.content && <p className={styles.reviewContent}>{review.content}</p>}
        </article>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format author as "First name + last initial" */
function formatAuthorName(firstName: string, lastName: string | null): string {
    if (lastName && lastName.length > 0) {
        return `${firstName} ${lastName.charAt(0)}.`;
    }
    return firstName;
}

/** Russian pluralization for "отзыв" */
function pluralizeReviews(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "отзыв";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "отзыва";
    return "отзывов";
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchPiercerProfile(): Promise<ProfileData | null> {
    const [row] = await db
        .select({
            id: piercerProfile.id,
            firstName: piercerProfile.firstName,
            lastName: piercerProfile.lastName,
            title: piercerProfile.title,
            bio: piercerProfile.bio,
            avatarUrl: piercerProfile.avatarUrl,
            experienceYears: piercerProfile.experienceYears,
            specializations: piercerProfile.specializations,
            certifications: piercerProfile.certifications,
            socialInstagram: piercerProfile.socialInstagram,
            socialTelegram: piercerProfile.socialTelegram,
        })
        .from(piercerProfile)
        .limit(1);

    return row ?? null;
}

async function fetchPortfolioImages() {
    const rows = await db
        .select({
            id: portfolioImages.id,
            imageUrl: portfolioImages.imageUrl,
            thumbnailUrl: portfolioImages.thumbnailUrl,
            description: portfolioImages.description,
        })
        .from(portfolioImages)
        .where(eq(portfolioImages.clientConsent, true))
        .orderBy(asc(portfolioImages.sortOrder), desc(portfolioImages.createdAt))
        .limit(20);

    return rows;
}

async function fetchApprovedReviews(): Promise<ReviewData[]> {
    const rows = await db
        .select({
            id: reviews.id,
            rating: reviews.rating,
            content: reviews.content,
            createdAt: reviews.createdAt,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
        })
        .from(reviews)
        .innerJoin(customers, eq(reviews.customerId, customers.id))
        .where(eq(reviews.status, "approved"))
        .orderBy(desc(reviews.createdAt))
        .limit(20);

    return rows;
}
