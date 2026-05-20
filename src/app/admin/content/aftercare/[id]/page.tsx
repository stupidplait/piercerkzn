"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../admin.module.css";
import { mockAftercareGuides, type MockAftercareGuide } from "@/lib/admin-data";

interface Section {
    heading: string;
    body: string;
}

export default function AftercareEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const guide: MockAftercareGuide | null = mockAftercareGuides.find((g) => g.id === id) ?? null;

    const [title, setTitle] = useState(guide?.title ?? "");
    const [sections, setSections] = useState<Section[]>(
        guide?.sections ?? [{ heading: "", body: "" }]
    );
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Not found state
    if (!guide) {
        return (
            <>
                <Link href="/admin/content" className={styles.backLink}>
                    ← Публикации
                </Link>
                <div className={styles.emptyState}>
                    <h2>Контент не найден</h2>
                    <p>Запрашиваемый гайд не существует или был удалён.</p>
                    <Link href="/admin/content" className={`${styles.btn} ${styles.btnPrimary}`}>
                        Вернуться к публикациям
                    </Link>
                </div>
            </>
        );
    }

    const handleAddSection = () => {
        if (sections.length >= 20) return;
        setSections([...sections, { heading: "", body: "" }]);
    };

    const handleRemoveSection = (index: number) => {
        setSections(sections.filter((_, i) => i !== index));
    };

    const handleMoveUp = (index: number) => {
        if (index === 0) return;
        const updated = [...sections];
        [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
        setSections(updated);
    };

    const handleMoveDown = (index: number) => {
        if (index === sections.length - 1) return;
        const updated = [...sections];
        [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
        setSections(updated);
    };

    const handleSectionChange = (index: number, field: keyof Section, value: string) => {
        const updated = [...sections];
        updated[index] = { ...updated[index], [field]: value };
        setSections(updated);
    };

    const handleSubmit = () => {
        const newErrors: Record<string, string> = {};

        if (!title.trim()) newErrors.title = "Обязательное поле";
        else if (title.length > 100) newErrors.title = "Максимум 100 символов";

        if (sections.length === 0) {
            newErrors.sections = "Добавьте хотя бы одну секцию";
        } else {
            sections.forEach((section, i) => {
                if (!section.heading.trim())
                    newErrors[`section_${i}_heading`] = "Обязательное поле";
                if (!section.body.trim()) newErrors[`section_${i}_body`] = "Обязательное поле";
            });
        }

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
                    <h1 className={styles.pageHeading}>{guide.title}</h1>
                    <span className={styles.pageDesc}>Редактирование гайда по уходу</span>
                </div>
            </div>

            <div className={styles.detailLayout}>
                <div className={styles.detailMain}>
                    {/* Title card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Основная информация</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Зона пирсинга *</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.title ? styles.formInputError : ""}`}
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Уход за пирсингом мочки уха"
                                    maxLength={100}
                                />
                                {errors.title && (
                                    <span className={styles.formError}>{errors.title}</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sections card */}
                    <div className={styles.card} style={{ marginTop: 16 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Секции</h2>
                            {sections.length < 20 && (
                                <button
                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                    onClick={handleAddSection}
                                >
                                    + Добавить секцию
                                </button>
                            )}
                        </div>
                        <div className={styles.cardBody}>
                            {errors.sections && (
                                <span className={styles.formError}>{errors.sections}</span>
                            )}
                            {sections.map((section, index) => (
                                <div
                                    key={index}
                                    style={{
                                        border: "1px solid var(--adm-border)",
                                        borderRadius: 8,
                                        padding: 16,
                                        marginBottom: 12,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            marginBottom: 12,
                                        }}
                                    >
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                                            Секция {index + 1}
                                        </span>
                                        <div style={{ display: "flex", gap: 4 }}>
                                            <button
                                                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                onClick={() => handleMoveUp(index)}
                                                disabled={index === 0}
                                                title="Переместить вверх"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                onClick={() => handleMoveDown(index)}
                                                disabled={index === sections.length - 1}
                                                title="Переместить вниз"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                                                onClick={() => handleRemoveSection(index)}
                                                title="Удалить секцию"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Заголовок *</label>
                                        <input
                                            type="text"
                                            className={`${styles.formInput} ${errors[`section_${index}_heading`] ? styles.formInputError : ""}`}
                                            value={section.heading}
                                            onChange={(e) =>
                                                handleSectionChange(
                                                    index,
                                                    "heading",
                                                    e.target.value
                                                )
                                            }
                                            placeholder="Заголовок секции"
                                        />
                                        {errors[`section_${index}_heading`] && (
                                            <span className={styles.formError}>
                                                {errors[`section_${index}_heading`]}
                                            </span>
                                        )}
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Содержание *</label>
                                        <textarea
                                            className={`${styles.formTextarea} ${errors[`section_${index}_body`] ? styles.formInputError : ""}`}
                                            value={section.body}
                                            onChange={(e) =>
                                                handleSectionChange(index, "body", e.target.value)
                                            }
                                            placeholder="Текст секции..."
                                            style={{ minHeight: 100 }}
                                        />
                                        {errors[`section_${index}_body`] && (
                                            <span className={styles.formError}>
                                                {errors[`section_${index}_body`]}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {sections.length === 0 && (
                                <p
                                    style={{
                                        color: "var(--adm-text-muted)",
                                        textAlign: "center",
                                        padding: "24px 0",
                                    }}
                                >
                                    Нет секций. Нажмите «+ Добавить секцию» чтобы начать.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.detailSide}>
                    {/* Metadata & actions card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Действия</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Последнее обновление</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={new Date(guide.updatedAt).toLocaleDateString("ru-RU")}
                                    readOnly
                                />
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                    marginTop: 16,
                                }}
                            >
                                <button
                                    className={`${styles.btn} ${styles.btnPrimary}`}
                                    onClick={handleSubmit}
                                    style={{ width: "100%" }}
                                >
                                    Сохранить
                                </button>
                                <button
                                    className={`${styles.btn} ${styles.btnSecondary}`}
                                    onClick={() => router.push("/admin/content")}
                                    style={{ width: "100%" }}
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
