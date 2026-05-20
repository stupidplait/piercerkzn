import Link from "next/link";

import styles from "./product-detail.module.css";

export default function ProductNotFound() {
    return (
        <div className={styles.notFoundPage}>
            <div className={styles.notFoundCard}>
                <h1 className={styles.notFoundTitle}>404</h1>
                <p className={styles.notFoundText}>Товар не найден или снят с публикации</p>
                <Link href="/catalog" className={styles.notFoundLink}>
                    Вернуться в каталог
                </Link>
            </div>
        </div>
    );
}
