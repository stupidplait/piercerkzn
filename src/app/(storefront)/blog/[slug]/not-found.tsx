import Link from "next/link";

import styles from "./blog-post.module.css";

export default function BlogPostNotFound() {
    return (
        <div className={styles.notFoundPage}>
            <div className={styles.notFoundCard}>
                <h1 className={styles.notFoundTitle}>404</h1>
                <p className={styles.notFoundText}>Статья не найдена или снята с публикации</p>
                <Link href="/blog" className={styles.notFoundLink}>
                    Вернуться в блог
                </Link>
            </div>
        </div>
    );
}
