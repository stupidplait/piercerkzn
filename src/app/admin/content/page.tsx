"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import { mockBlogPosts, mockAftercareGuides, type BlogStatus } from "@/lib/admin-data";

const FAQ_DATA = [
    {
        id: "faq1",
        q: "Больно ли делать пирсинг?",
        a: "Ощущения индивидуальны. Большинство клиентов описывают это как быстрый щипок.",
    },
    {
        id: "faq2",
        q: "Сколько заживает мочка уха?",
        a: "Мочка уха заживает 6–8 недель при правильном уходе.",
    },
    {
        id: "faq3",
        q: "Можно ли мне делать пирсинг, если я несовершеннолетний?",
        a: "До 18 лет требуется присутствие и согласие родителя или опекуна.",
    },
    {
        id: "faq4",
        q: "Какие металлы вы используете?",
        a: "Только имплантат-сталь, титан класса ASTM F136 и золото 14к/18к.",
    },
];

function statusClass(s: BlogStatus) {
    return s === "published" ? styles.badgePublished : styles.badgeDraft;
}
function statusLabel(s: BlogStatus) {
    return s === "published" ? "Опубликована" : "Черновик";
}

export default function ContentPage() {
    const [tab, setTab] = useState(0);

    // FAQ inline editing state
    const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
    const [faqQuestion, setFaqQuestion] = useState("");
    const [faqAnswer, setFaqAnswer] = useState("");
    const [faqItems, setFaqItems] = useState(FAQ_DATA);

    function startEditFaq(faq: { id: string; q: string; a: string }) {
        setEditingFaqId(faq.id);
        setFaqQuestion(faq.q);
        setFaqAnswer(faq.a);
    }

    function cancelEditFaq() {
        setEditingFaqId(null);
        setFaqQuestion("");
        setFaqAnswer("");
    }

    function saveFaq() {
        if (!editingFaqId) return;
        setFaqItems((prev) =>
            prev.map((item) =>
                item.id === editingFaqId ? { ...item, q: faqQuestion, a: faqAnswer } : item
            )
        );
        cancelEditFaq();
    }

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Публикации</h1>
                    <span className={styles.pageDesc}>Контент студии</span>
                </div>
                <div className={styles.headerActions}>
                    {tab === 0 && (
                        <Link
                            href="/admin/content/blog/new"
                            className={`${styles.btn} ${styles.btnPrimary}`}
                        >
                            + Новая статья
                        </Link>
                    )}
                </div>
            </div>

            <div className={styles.tabs}>
                <div className={styles.tabList}>
                    {["Блог", "Уход после пирсинга", "FAQ"].map((t, i) => (
                        <button
                            key={t}
                            className={`${styles.tabBtn} ${tab === i ? styles.tabBtnActive : ""}`}
                            onClick={() => {
                                setTab(i);
                            }}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Blog ── */}
            {tab === 0 && (
                <div className={styles.card}>
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead className={styles.tHead}>
                                <tr>
                                    <th>Заголовок</th>
                                    <th>Slug</th>
                                    <th>Просмотры</th>
                                    <th>Создана</th>
                                    <th>Опубликована</th>
                                    <th>Статус</th>
                                    <th style={{ textAlign: "right", paddingRight: 22 }}>
                                        Действия
                                    </th>
                                </tr>
                            </thead>
                            <tbody className={styles.tBody}>
                                {mockBlogPosts.map((p) => (
                                    <tr key={p.id}>
                                        <td className={styles.td}>
                                            <div style={{ fontWeight: 500, maxWidth: 280 }}>
                                                {p.title}
                                            </div>
                                            <div
                                                className={styles.tdMono}
                                                style={{
                                                    marginTop: 2,
                                                    fontSize: "0.68rem",
                                                    opacity: 0.7,
                                                }}
                                            >
                                                {p.excerpt.slice(0, 60)}…
                                            </div>
                                        </td>
                                        <td
                                            className={`${styles.td} ${styles.tdMono}`}
                                            style={{ fontSize: "0.68rem" }}
                                        >
                                            {p.slug.slice(0, 28)}…
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {p.views.toLocaleString("ru")}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {new Date(p.createdAt).toLocaleDateString("ru", {
                                                day: "2-digit",
                                                month: "short",
                                            })}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {p.publishedAt
                                                ? new Date(p.publishedAt).toLocaleDateString("ru", {
                                                      day: "2-digit",
                                                      month: "short",
                                                  })
                                                : "—"}
                                        </td>
                                        <td className={styles.td}>
                                            <span
                                                className={`${styles.badge} ${statusClass(p.status)}`}
                                            >
                                                {statusLabel(p.status)}
                                            </span>
                                        </td>
                                        <td className={styles.td}>
                                            <div className={styles.tdActions}>
                                                <Link
                                                    href={`/admin/content/blog/${p.id}`}
                                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                >
                                                    Изм.
                                                </Link>
                                                <button
                                                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Aftercare ── */}
            {tab === 1 && (
                <div className={styles.card}>
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead className={styles.tHead}>
                                <tr>
                                    <th>Зона пирсинга</th>
                                    <th>Разделов</th>
                                    <th>Обновлена</th>
                                    <th style={{ textAlign: "right", paddingRight: 22 }}>
                                        Действия
                                    </th>
                                </tr>
                            </thead>
                            <tbody className={styles.tBody}>
                                {mockAftercareGuides.map((g) => (
                                    <tr key={g.id}>
                                        <td className={styles.td} style={{ fontWeight: 500 }}>
                                            {g.title}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {g.sections.length}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {new Date(g.updatedAt).toLocaleDateString("ru", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "numeric",
                                            })}
                                        </td>
                                        <td className={styles.td}>
                                            <div className={styles.tdActions}>
                                                <Link
                                                    href={`/admin/content/aftercare/${g.id}`}
                                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                >
                                                    Редактировать
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── FAQ ── */}
            {tab === 2 && (
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h2 className={styles.cardTitle}>Часто задаваемые вопросы</h2>
                        <button className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}>
                            + Добавить вопрос
                        </button>
                    </div>
                    <div className={styles.cardBody}>
                        {faqItems.map((faq, i) => (
                            <div
                                key={faq.id}
                                style={{
                                    padding: "14px 0",
                                    borderBottom:
                                        i < faqItems.length - 1
                                            ? "1px solid var(--adm-rule)"
                                            : "none",
                                }}
                            >
                                {editingFaqId === faq.id ? (
                                    /* ── FAQ inline edit form ── */
                                    <div>
                                        <div
                                            className={styles.formGroup}
                                            style={{ marginBottom: 12 }}
                                        >
                                            <label className={styles.formLabel}>Вопрос</label>
                                            <input
                                                type="text"
                                                className={styles.formInput}
                                                value={faqQuestion}
                                                onChange={(e) =>
                                                    setFaqQuestion(e.target.value.slice(0, 300))
                                                }
                                                maxLength={300}
                                                placeholder="Вопрос"
                                            />
                                        </div>
                                        <div
                                            className={styles.formGroup}
                                            style={{ marginBottom: 12 }}
                                        >
                                            <label className={styles.formLabel}>Ответ</label>
                                            <textarea
                                                className={styles.formTextarea}
                                                value={faqAnswer}
                                                onChange={(e) =>
                                                    setFaqAnswer(e.target.value.slice(0, 1000))
                                                }
                                                maxLength={1000}
                                                placeholder="Ответ"
                                                rows={3}
                                            />
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button
                                                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                                                onClick={saveFaq}
                                            >
                                                Сохранить
                                            </button>
                                            <button
                                                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                onClick={cancelEditFaq}
                                            >
                                                Отмена
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* ── FAQ display row ── */
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: 16,
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div
                                                style={{
                                                    fontWeight: 600,
                                                    marginBottom: 4,
                                                    fontSize: "0.875rem",
                                                }}
                                            >
                                                {faq.q}
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: "0.83rem",
                                                    color: "var(--ink-muted)",
                                                }}
                                            >
                                                {faq.a}
                                            </div>
                                        </div>
                                        <button
                                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                            onClick={() => startEditFaq(faq)}
                                        >
                                            Изм.
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
