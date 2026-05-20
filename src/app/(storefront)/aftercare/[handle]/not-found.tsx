import Link from "next/link";

import styles from "./aftercare-detail.module.css";

export default function AftercareNotFound() {
    return (
        <div className={styles.notFoundPage}>
            <div className={styles.notFoundCard}>
                <h1 className={styles.notFoundTitle}>404</h1>
                <p className={styles.notFoundText}>Гайд по уходу не найден или снят с публикации</p>
                <Link href="/aftercare" className={styles.notFoundLink}>
                    Вернуться к гайдам
                </Link>
            </div>
        </div>
    );
}
