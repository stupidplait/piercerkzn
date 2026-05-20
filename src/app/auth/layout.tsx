/**
 * Customer auth layout (`/auth/*`).
 *
 * Renders a centred card frame with the brand wordmark. Each child page
 * (login / register / forgot / reset) supplies its own form via the
 * `auth.module.css` primitives.
 */
import Link from "next/link";

import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <main className={styles.shell}>
            <div className={styles.gridBackdrop} aria-hidden />
            <div className={styles.frame}>
                <Link href="/" className={styles.brand} aria-label="PiercerKZN — на главную">
                    <span className={styles.brandMark}>P/KZN</span>
                    <span className={styles.brandLine} />
                    <span className={styles.brandSub}>Студия пирсинга · Казань</span>
                </Link>
                <section className={styles.card}>{children}</section>
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
