import Link from "next/link";

import styles from "./look-detail.module.css";

export default function LookNotFound() {
    return (
        <div className={styles.notFoundPage}>
            <div className={styles.notFoundCard}>
                <h1 className={styles.notFoundTitle}>404</h1>
                <p className={styles.notFoundText}>Образ не найден или снят с публикации</p>
                <Link href="/looks" className={styles.notFoundLink}>
                    Вернуться к образам
                </Link>
            </div>
        </div>
    );
}
