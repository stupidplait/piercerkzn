"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import { mockProducts, MATERIAL_LABELS, TYPE_LABELS, type ProductStatus } from "@/lib/admin-data";

const PAGE_SIZE = 8;

function statusClass(s: string) {
    if (s === "published") return styles.badgePublished;
    if (s === "archived") return styles.badgeInactive;
    return styles.badgeDraft;
}
function statusLabel(s: ProductStatus) {
    if (s === "published") return "Опубликован";
    if (s === "archived") return "Архив";
    return "Черновик";
}

export default function ProductsPage() {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [materialFilter, setMaterialFilter] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(1);

    const filtered = mockProducts.filter((p) => {
        const matchSearch =
            !search ||
            p.title.toLowerCase().includes(search.toLowerCase()) ||
            p.handle.includes(search.toLowerCase());
        const matchStatus = !statusFilter || p.status === statusFilter;
        const matchMaterial = !materialFilter || p.material === materialFilter;
        return matchSearch && matchStatus && matchMaterial;
    });

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === paginated.length) setSelected(new Set());
        else setSelected(new Set(paginated.map((p) => p.id)));
    };

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Украшения</h1>
                    <span className={styles.pageDesc}>Каталог · {mockProducts.length} позиций</span>
                </div>
                <div className={styles.headerActions}>
                    <Link
                        href="/admin/products/new"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                    >
                        + Добавить украшение
                    </Link>
                </div>
            </div>

            {/* Bulk bar */}
            {selected.size > 0 && (
                <div className={styles.bulkBar}>
                    <span className={styles.bulkCount}>{selected.size} выбрано</span>
                    <button className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}>
                        Опубликовать
                    </button>
                    <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}>
                        Удалить
                    </button>
                    <button
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        onClick={() => setSelected(new Set())}
                    >
                        Снять выделение
                    </button>
                </div>
            )}

            {/* Filter bar */}
            <div className={styles.filterBar}>
                <div className={styles.searchWrap}>
                    <svg
                        className={styles.searchIcon}
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <circle cx="6" cy="6" r="4" />
                        <line x1="9.5" y1="9.5" x2="13" y2="13" />
                    </svg>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Поиск украшений..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                    />
                </div>
                <select
                    className={styles.filterSelect}
                    value={statusFilter}
                    onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPage(1);
                    }}
                >
                    <option value="">Все статусы</option>
                    <option value="published">Опубликован</option>
                    <option value="draft">Черновик</option>
                    <option value="archived">Архив</option>
                </select>
                <select
                    className={styles.filterSelect}
                    value={materialFilter}
                    onChange={(e) => {
                        setMaterialFilter(e.target.value);
                        setPage(1);
                    }}
                >
                    <option value="">Все материалы</option>
                    <option value="titanium">Титан</option>
                    <option value="gold_14k">Золото 14к</option>
                    <option value="gold_18k">Золото 18к</option>
                    <option value="implant_steel">Сталь имплантат</option>
                    <option value="niobium">Ниобий</option>
                </select>
            </div>

            {/* Table */}
            <div className={styles.card}>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead className={styles.tHead}>
                            <tr>
                                <th style={{ width: 40, paddingLeft: 16 }}>
                                    <input
                                        type="checkbox"
                                        checked={
                                            selected.size === paginated.length &&
                                            paginated.length > 0
                                        }
                                        onChange={toggleAll}
                                    />
                                </th>
                                <th style={{ width: 52 }}></th>
                                <th>Название</th>
                                <th>Категория</th>
                                <th>Материал</th>
                                <th>Цена</th>
                                <th>Склад</th>
                                <th>Статус</th>
                                <th style={{ textAlign: "right", paddingRight: 22 }}>Действия</th>
                            </tr>
                        </thead>
                        <tbody className={styles.tBody}>
                            {paginated.length === 0 ? (
                                <tr>
                                    <td colSpan={9}>
                                        <div className={styles.emptyState}>
                                            <div className={styles.emptyIcon}>🔍</div>
                                            <p className={styles.emptyTitle}>Ничего не найдено</p>
                                            <p className={styles.emptyText}>
                                                Попробуйте изменить параметры поиска
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginated.map((p) => (
                                    <tr key={p.id}>
                                        <td className={styles.td} style={{ paddingLeft: 16 }}>
                                            <input
                                                type="checkbox"
                                                checked={selected.has(p.id)}
                                                onChange={() => toggleSelect(p.id)}
                                            />
                                        </td>
                                        <td className={styles.tdImage}>
                                            <div className={styles.productThumbPlaceholder}>
                                                {p.type === "stud"
                                                    ? "◈"
                                                    : p.type === "hoop" || p.type === "segment_ring"
                                                      ? "○"
                                                      : "—"}
                                            </div>
                                        </td>
                                        <td className={styles.td}>
                                            <div style={{ fontWeight: 500 }}>{p.title}</div>
                                            <div className={styles.tdMono} style={{ marginTop: 2 }}>
                                                {p.handle}
                                            </div>
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {p.category}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {MATERIAL_LABELS[p.material]}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {p.price.toLocaleString("ru")} ₽
                                        </td>
                                        <td className={styles.td}>
                                            <span
                                                style={{
                                                    color:
                                                        p.stock <= 3
                                                            ? "var(--adm-danger)"
                                                            : "inherit",
                                                }}
                                            >
                                                {p.stock} шт.
                                            </span>
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
                                                    href={`/admin/products/${p.id}`}
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
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className={styles.paginRow} style={{ padding: "14px 18px" }}>
                        <span className={styles.paginInfo}>
                            {(page - 1) * PAGE_SIZE + 1}–
                            {Math.min(page * PAGE_SIZE, filtered.length)} из {filtered.length}
                        </span>
                        <div className={styles.paginBtns}>
                            <button
                                className={`${styles.paginBtn} ${page === 1 ? styles.paginBtnDisabled : ""}`}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                            >
                                ←
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                                <button
                                    key={n}
                                    className={`${styles.paginBtn} ${n === page ? styles.paginBtnActive : ""}`}
                                    onClick={() => setPage(n)}
                                >
                                    {n}
                                </button>
                            ))}
                            <button
                                className={`${styles.paginBtn} ${page === totalPages ? styles.paginBtnDisabled : ""}`}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                            >
                                →
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
