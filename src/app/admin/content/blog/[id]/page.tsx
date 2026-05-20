"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../admin.module.css";
import { mockBlogPosts, type BlogStatus } from "@/lib/admin-data";

const STATUS_OPTIONS: { value: BlogStatus; label: string }[] = [
    { value: "draft", label: "Черновик" },
    { value: "published", label: "Опубликована" },
];

interface FormErrors {
    title?: string;
    excerpt?: string;
    slug?: string;
}

export default function BlogEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const isNew = id === "new";
    const post = isNew ? null : (mockBlogPosts.find((p) => p.id === id) ?? null);

    const [title, setTitle] = useState(post?.title ?? "");
    const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
    const [content, setContent] = useState("");
    const [status, setStatus] = useState<BlogStatus>(post?.status ?? "draft");
    const [slug, setSlug] = useState(post?.slug ?? "");
    const [errors, setErrors] = useState<FormErrors>({});

    // Not found state
    if (!isNew && !post) {
        return (
            <>
                <Link href="/admin/content" className={styles.backLink}>
                    ← Публикации
                </Link>
                <div className={styles.card}>
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>⚠️</div>
                        <p className={styles.emptyTitle}>Контент не найден</p>
                        <Link
                            href="/admin/content"
                            className={`${styles.btn} ${styles.btnSecondary}`}
                        >
                            Вернуться к публикациям
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    const handleSubmit = () => {
        const newErrors: FormErrors = {};

        if (!title.trim()) newErrors.title = "Обязательное поле";
        else if (title.length > 200) newErrors.title = "Максимум 200 символов";

        if (excerpt.length > 500) newErrors.excerpt = "Максимум 500 символов";

        if (slug.length > 100) newErrors.slug = "Максимум 100 символов";

        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) return;

        // Save to mock state (in a real app this would be an API call)
        router.push("/admin/content");
    };

    return (
        <>
            <Link href="/admin/content" className={styles.backLink}>
                ← Публикации
            </Link>

            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>
                        {isNew ? "Новая статья" : (post?.title ?? "Статья")}
                    </h1>
                    <span className={styles.pageDesc}>
                        {isNew ? "Создание новой публикации" : `ID: ${id}`}
                    </span>
                </div>
            </div>

            <div className={styles.detailLayout}>
                <div className={styles.detailMain}>
                    {/* Content card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Содержание</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Заголовок *</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.title ? styles.formInputError : ""}`}
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Введите заголовок статьи"
                                    maxLength={200}
                                />
                                {errors.title && (
                                    <span className={styles.formError}>{errors.title}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Краткое описание</label>
                                <textarea
                                    className={`${styles.formTextarea} ${errors.excerpt ? styles.formInputError : ""}`}
                                    value={excerpt}
                                    onChange={(e) => setExcerpt(e.target.value)}
                                    placeholder="Краткое описание статьи для превью"
                                    maxLength={500}
                                    style={{ minHeight: 80 }}
                                />
                                {errors.excerpt && (
                                    <span className={styles.formError}>{errors.excerpt}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Контент</label>
                                <textarea
                                    className={styles.formTextarea}
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    placeholder="Здесь будет интеграция с Tiptap-редактором..."
                                    style={{
                                        minHeight: 300,
                                        fontFamily: "var(--font-mono), monospace",
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.detailSide}>
                    {/* Publication card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Публикация</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Статус</label>
                                <select
                                    className={styles.formSelect}
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value as BlogStatus)}
                                >
                                    {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL slug</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.slug ? styles.formInputError : ""}`}
                                    value={slug}
                                    onChange={(e) => setSlug(e.target.value)}
                                    placeholder="url-slug-stati"
                                    maxLength={100}
                                />
                                {errors.slug && (
                                    <span className={styles.formError}>{errors.slug}</span>
                                )}
                            </div>

                            <div
                                className={styles.formGroup}
                                style={{ display: "flex", gap: 8, marginTop: 8 }}
                            >
                                <button
                                    className={`${styles.btn} ${styles.btnPrimary}`}
                                    onClick={handleSubmit}
                                >
                                    Сохранить
                                </button>
                                <button
                                    className={`${styles.btn} ${styles.btnSecondary}`}
                                    onClick={() => router.push("/admin/content")}
                                >
                                    Отмена
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
