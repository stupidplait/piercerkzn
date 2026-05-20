/**
 * Public unsubscribe confirmation page (`/unsubscribe`).
 *
 * Reached by 302 redirects from `GET /api/unsubscribe?token=…` after the
 * marketing flag flip succeeds (`?ok=1`) or the token is rejected
 * (`?error=invalid`). Pure Server Component — no client interactivity, no
 * form submission, no DB access. Russian copy is hard-coded per the design
 * doc's "Russian Copy Outlines" section.
 *
 * Uses the same cyanotype brand header and card frame as `/auth/*` so the
 * unsubscribe terminus feels like part of the storefront. This route lives
 * directly under `app/` (no `(public)` route group) to match how other
 * public-facing pages — `/`, `/auth/*` — are organised in this project.
 *
 * Validates: Requirement 10.1
 */
import type { Metadata } from "next";
import Link from "next/link";

import styles from "./unsubscribe.module.css";

export const metadata: Metadata = {
    title: "Отписаться от рассылки — PiercerKZN",
    description: "Управление подпиской на новости PiercerKZN.",
    robots: { index: false, follow: false },
};

interface UnsubscribePageProps {
    searchParams: Promise<{ ok?: string; error?: string }>;
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
    const params = await searchParams;
    const isOk = params.ok === "1";
    const isError = params.error === "invalid";

    let heading: string;
    let body: string;
    if (isOk) {
        heading = "Вы отписались";
        body =
            "Мы больше не будем присылать вам новостные рассылки. Если передумаете — настройки уведомлений в личном кабинете.";
    } else if (isError) {
        heading = "Ссылка недействительна";
        body =
            "Возможно, ссылка устарела или была изменена. Откройте письмо ещё раз и перейдите по свежей ссылке.";
    } else {
        // Direct visit without a query param. Mirror the `error=invalid`
        // copy so the page never renders a blank card.
        heading = "Управление подпиской";
        body = "Чтобы отписаться от рассылки, перейдите по ссылке из последнего письма PiercerKZN.";
    }

    return (
        <main className={styles.shell}>
            <div className={styles.gridBackdrop} aria-hidden />
            <div className={styles.frame}>
                <Link href="/" className={styles.brand} aria-label="PiercerKZN — на главную">
                    <span className={styles.brandMark}>P/KZN</span>
                    <span className={styles.brandLine} />
                    <span className={styles.brandSub}>Студия пирсинга · Казань</span>
                </Link>
                <section className={styles.card}>
                    <h1 className={styles.heading}>{heading}</h1>
                    <p className={styles.body}>{body}</p>
                </section>
                <footer className={styles.footnote}>
                    <span>© {new Date().getFullYear()} PiercerKZN</span>
                    <span aria-hidden>·</span>
                    <Link href="/" className={styles.footLink}>
                        На главную
                    </Link>
                </footer>
            </div>
        </main>
    );
}
