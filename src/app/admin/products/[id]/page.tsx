"use client";

import { use, useState } from "react";
import Link from "next/link";
import styles from "../../admin.module.css";
import { mockProducts, MATERIAL_LABELS } from "@/lib/admin-data";

const TABS = ["Основное", "Варианты", "Ценообразование", "SEO", "Склад"];

export default function ProductEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const isNew = id === "new";
    const product = isNew ? null : (mockProducts.find((p) => p.id === id) ?? mockProducts[0]);

    const [tab, setTab] = useState(0);
    const [title, setTitle] = useState(product?.title ?? "");
    const [price, setPrice] = useState(String(product?.price ?? ""));
    const [stock, setStock] = useState(String(product?.stock ?? ""));
    const [status, setStatus] = useState(product?.status ?? "draft");
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <>
            {/* Back + header */}
            <Link href="/admin/products" className={styles.backLink}>
                ← Украшения
            </Link>

            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>
                        {isNew ? "Новое украшение" : product?.title}
                    </h1>
                    <span className={styles.pageDesc}>
                        {isNew ? "Создание позиции каталога" : `ID: ${id}`}
                    </span>
                </div>
                <div className={styles.headerActions}>
                    <button className={`${styles.btn} ${styles.btnSecondary}`}>Предпросмотр</button>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
                        {saved ? "✓ Сохранено" : "Сохранить"}
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className={styles.tabs}>
                <div className={styles.tabList}>
                    {TABS.map((t, i) => (
                        <button
                            key={t}
                            className={`${styles.tabBtn} ${i === tab ? styles.tabBtnActive : ""}`}
                            onClick={() => setTab(i)}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab panels */}
            {tab === 0 && (
                <div className={styles.detailLayout}>
                    <div className={styles.detailMain}>
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Основная информация</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.formSection}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Название *</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            placeholder="Кольцо сегментное 8мм"
                                        />
                                    </div>
                                </div>

                                <div className={styles.formSection}>
                                    <div className={styles.formGrid}>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Материал</label>
                                            <select
                                                className={styles.formSelect}
                                                defaultValue={product?.material ?? ""}
                                            >
                                                <option value="">Выбрать...</option>
                                                {Object.entries(MATERIAL_LABELS).map(([k, v]) => (
                                                    <option key={k} value={k}>
                                                        {v}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>
                                                Тип украшения
                                            </label>
                                            <select
                                                className={styles.formSelect}
                                                defaultValue={product?.type ?? ""}
                                            >
                                                <option value="">Выбрать...</option>
                                                <option value="stud">Стад</option>
                                                <option value="hoop">Кольцо</option>
                                                <option value="barbell">Штанга</option>
                                                <option value="labret">Лабрет</option>
                                                <option value="segment_ring">
                                                    Сегментное кольцо
                                                </option>
                                                <option value="captive_ring">
                                                    Кольцо с шариком
                                                </option>
                                            </select>
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Категория</label>
                                            <select
                                                className={styles.formSelect}
                                                defaultValue={product?.category ?? ""}
                                            >
                                                <option value="">Выбрать...</option>
                                                <option value="Кольца">Кольца</option>
                                                <option value="Лабреты">Лабреты</option>
                                                <option value="Штанги">Штанги</option>
                                                <option value="Стады">Стады</option>
                                                <option value="Ностри">Ностри</option>
                                            </select>
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className={styles.formLabel}>Резьба</label>
                                            <select className={styles.formSelect}>
                                                <option value="">Выбрать...</option>
                                                <option value="threadless">Threadless</option>
                                                <option value="internal">Внутренняя</option>
                                                <option value="external">Внешняя</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.formSection}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Описание</label>
                                        <textarea
                                            className={styles.formTextarea}
                                            defaultValue=""
                                            placeholder="Описание украшения для каталога..."
                                            style={{ minHeight: 120 }}
                                        />
                                    </div>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Теги</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        defaultValue={product?.tags.join(", ") ?? ""}
                                        placeholder="Через запятую: хрящ, титан, 16G"
                                    />
                                    <span className={styles.formHint}>
                                        Теги влияют на поиск и фильтрацию
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.detailSide}>
                        {/* Status */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Статус публикации</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Статус</label>
                                    <select
                                        className={styles.formSelect}
                                        value={status}
                                        onChange={(e) => setStatus(e.target.value as typeof status)}
                                    >
                                        <option value="draft">Черновик</option>
                                        <option value="published">Опубликован</option>
                                        <option value="archived">Архив</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Piercing areas */}
                        <div className={styles.card} style={{ marginTop: 16 }}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Зоны пирсинга</h2>
                            </div>
                            <div className={styles.cardBody}>
                                {[
                                    "Мочка уха",
                                    "Хрящ уха",
                                    "Ноздря",
                                    "Перегородка",
                                    "Губа",
                                    "Бровь",
                                    "Пупок",
                                ].map((zone) => (
                                    <label
                                        key={zone}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            marginBottom: 8,
                                            cursor: "pointer",
                                        }}
                                    >
                                        <input type="checkbox" />
                                        <span style={{ fontSize: "0.83rem" }}>{zone}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 1 && (
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h2 className={styles.cardTitle}>Варианты</h2>
                        <button className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}>
                            + Добавить вариант
                        </button>
                    </div>
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead className={styles.tHead}>
                                <tr>
                                    <th>SKU</th>
                                    <th>Название варианта</th>
                                    <th>Размер (мм)</th>
                                    <th>Калибр</th>
                                    <th>Цена (₽)</th>
                                    <th>Склад</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody className={styles.tBody}>
                                <tr>
                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="RNG-SEG-TI-8"
                                            style={{ width: 130 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="8мм · Титан"
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="8"
                                            style={{ width: 70 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <select className={styles.formSelect} style={{ width: 80 }}>
                                            <option>16G</option>
                                            <option>18G</option>
                                            <option>14G</option>
                                        </select>
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="2200"
                                            style={{ width: 90 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="12"
                                            style={{ width: 70 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <button
                                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                        >
                                            ✕
                                        </button>
                                    </td>
                                </tr>
                                <tr>
                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="RNG-SEG-TI-10"
                                            style={{ width: 130 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="10мм · Титан"
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="10"
                                            style={{ width: 70 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <select className={styles.formSelect} style={{ width: 80 }}>
                                            <option>16G</option>
                                            <option>18G</option>
                                        </select>
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="2400"
                                            style={{ width: 90 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="5"
                                            style={{ width: 70 }}
                                        />
                                    </td>
                                    <td className={styles.td}>
                                        <button
                                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                        >
                                            ✕
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 2 && (
                <div className={styles.detailLayout}>
                    <div className={styles.detailMain}>
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Ценообразование</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.formGrid}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            Базовая цена (₽) *
                                        </label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            value={price}
                                            onChange={(e) => setPrice(e.target.value)}
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            Цена со скидкой (₽)
                                        </label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            placeholder="Оставьте пустым"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Начало акции</label>
                                        <input type="date" className={styles.formInput} />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Конец акции</label>
                                        <input type="date" className={styles.formInput} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className={styles.detailSide}>
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Итого</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <ul className={styles.infoList}>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Базовая цена</span>
                                        <span className={styles.infoValue}>
                                            {Number(price || 0).toLocaleString("ru")} ₽
                                        </span>
                                    </li>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Цена со скидкой</span>
                                        <span className={styles.infoValue}>—</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 3 && (
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h2 className={styles.cardTitle}>SEO</h2>
                    </div>
                    <div className={styles.cardBody}>
                        <div className={styles.formSection}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Meta-заголовок</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    defaultValue={product?.title ?? ""}
                                    placeholder="Заголовок страницы в поисковике"
                                />
                                <span className={styles.formHint}>
                                    Рекомендуется 50–60 символов
                                </span>
                            </div>
                        </div>
                        <div className={styles.formSection}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Meta-описание</label>
                                <textarea
                                    className={styles.formTextarea}
                                    placeholder="Описание страницы в поисковике"
                                />
                                <span className={styles.formHint}>
                                    Рекомендуется 120–160 символов
                                </span>
                            </div>
                        </div>
                        <div className={styles.formGroup}>
                            <label className={styles.formLabel}>URL-slug (handle)</label>
                            <input
                                type="text"
                                className={styles.formInput}
                                defaultValue={product?.handle ?? ""}
                            />
                        </div>
                    </div>
                </div>
            )}

            {tab === 4 && (
                <div className={styles.detailLayout}>
                    <div className={styles.detailMain}>
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Управление складом</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.formGrid}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            Количество на складе
                                        </label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            value={stock}
                                            onChange={(e) => setStock(e.target.value)}
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            Порог малого остатка
                                        </label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="3"
                                        />
                                        <span className={styles.formHint}>
                                            Оповещение при достижении порога
                                        </span>
                                    </div>
                                </div>
                                <hr className={styles.divider} />
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        cursor: "pointer",
                                    }}
                                >
                                    <input type="checkbox" defaultChecked />
                                    <span style={{ fontSize: "0.83rem" }}>Отслеживать остатки</span>
                                </label>
                                <br />
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        cursor: "pointer",
                                    }}
                                >
                                    <input type="checkbox" />
                                    <span style={{ fontSize: "0.83rem" }}>
                                        Разрешить предзаказ при нулевом остатке
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className={styles.detailSide}>
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Текущий остаток</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <span className={styles.statValue} style={{ fontSize: "2.5rem" }}>
                                    {stock}
                                </span>
                                <span
                                    className={styles.statLabel}
                                    style={{ display: "block", marginTop: 6 }}
                                >
                                    единиц на складе
                                </span>
                                {Number(stock) <= 3 && (
                                    <p
                                        className={`${styles.formHint} ${styles.textDanger}`}
                                        style={{ marginTop: 10 }}
                                    >
                                        Малый остаток — пора пополнить
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
