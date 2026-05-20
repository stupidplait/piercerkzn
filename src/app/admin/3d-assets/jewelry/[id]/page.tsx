"use client";

import { use, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../admin.module.css";
import {
    mockProducts,
    mockJewelry3dModels,
    mockPiercingPoints,
    JEWELRY_3D_TYPE_LABELS,
    type Jewelry3dStatus,
    type Jewelry3dType,
} from "@/lib/admin-data";

const JEWELRY_TYPES: Jewelry3dType[] = [
    "ring",
    "barbell",
    "labret",
    "stud",
    "hoop",
    "clicker",
    "chain",
];
const STATUS_OPTIONS: { value: Jewelry3dStatus; label: string }[] = [
    { value: "active", label: "Активна" },
    { value: "inactive", label: "Неактивна" },
    { value: "processing", label: "Обработка" },
];

export default function JewelryEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const isNew = id === "new";
    const existing = isNew ? null : (mockJewelry3dModels.find((j) => j.id === id) ?? null);

    // Find linked product for existing model
    const linkedProduct = existing ? mockProducts.find((p) => p.id === existing.productId) : null;

    // Form state
    const [productSearch, setProductSearch] = useState(linkedProduct?.title ?? "");
    const [selectedProductId, setSelectedProductId] = useState(existing?.productId ?? "");
    const [modelUrl, setModelUrl] = useState(existing?.modelUrl ?? "");
    const [thumbnailUrl, setThumbnailUrl] = useState(existing?.thumbnailUrl ?? "");
    const [jewelryType, setJewelryType] = useState<Jewelry3dType | "">(existing?.jewelryType ?? "");
    const [polygonCount, setPolygonCount] = useState(
        existing?.polygonCount != null ? String(existing.polygonCount) : ""
    );
    const [fileSize, setFileSize] = useState(
        existing?.fileSizeBytes != null ? String(existing.fileSizeBytes) : ""
    );
    const [defaultAttachment, setDefaultAttachment] = useState(existing?.defaultAttachment ?? "");
    const [materialMapping, setMaterialMapping] = useState(
        existing ? JSON.stringify(existing.materialMapping, null, 2) : "{}"
    );
    const [status, setStatus] = useState<Jewelry3dStatus>(existing?.status ?? "active");
    const [showDropdown, setShowDropdown] = useState(false);

    // Validation errors
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Filter products by search
    const filteredProducts = useMemo(() => {
        if (!productSearch.trim()) return mockProducts;
        const q = productSearch.toLowerCase();
        return mockProducts.filter((p) => p.title.toLowerCase().includes(q));
    }, [productSearch]);

    // Validation status from existing model
    const isValidated = existing?.isValidated ?? true;
    const validationErrors = existing?.validationErrors ?? [];

    function validate(): boolean {
        const newErrors: Record<string, string> = {};

        if (!selectedProductId) {
            newErrors.product = "Выберите привязанный товар";
        } else {
            const found = mockProducts.find((p) => p.id === selectedProductId);
            if (!found) {
                newErrors.product = "Товар не найден в каталоге";
            }
        }

        if (!modelUrl.trim()) {
            newErrors.modelUrl = "URL модели обязателен";
        } else if (modelUrl.length > 512) {
            newErrors.modelUrl = "Максимум 512 символов";
        }

        if (thumbnailUrl && thumbnailUrl.length > 512) {
            newErrors.thumbnailUrl = "Максимум 512 символов";
        }

        if (!jewelryType) {
            newErrors.jewelryType = "Выберите тип украшения";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    function handleSave() {
        if (!validate()) return;
        // Save to mock state (in real app would call API)
        router.push("/admin/3d-assets?tab=1");
    }

    function handleProductSelect(productId: string, productTitle: string) {
        setSelectedProductId(productId);
        setProductSearch(productTitle);
        setShowDropdown(false);
        if (errors.product) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next.product;
                return next;
            });
        }
    }

    return (
        <>
            <Link href="/admin/3d-assets" className={styles.backLink}>
                ← 3D-активы
            </Link>

            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>
                        {isNew
                            ? "Новая 3D-модель украшения"
                            : `3D-модель: ${linkedProduct?.title ?? id}`}
                    </h1>
                    <span className={styles.pageDesc}>
                        {isNew ? "Привязка 3D-модели к товару" : `ID: ${id}`}
                    </span>
                </div>
                <div className={styles.headerActions}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
                        Сохранить
                    </button>
                </div>
            </div>

            <div className={styles.detailLayout}>
                <div className={styles.detailMain}>
                    {/* Main form card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Основная информация</h2>
                        </div>
                        <div className={styles.cardBody}>
                            {/* Linked product - searchable select */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Привязанный товар *</label>
                                <div style={{ position: "relative" }}>
                                    <input
                                        type="text"
                                        className={`${styles.formInput} ${errors.product ? styles.formInputError : ""}`}
                                        value={productSearch}
                                        onChange={(e) => {
                                            setProductSearch(e.target.value);
                                            setSelectedProductId("");
                                            setShowDropdown(true);
                                        }}
                                        onFocus={() => setShowDropdown(true)}
                                        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                                        placeholder="Поиск товара по названию..."
                                    />
                                    {showDropdown && filteredProducts.length > 0 && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: "100%",
                                                left: 0,
                                                right: 0,
                                                maxHeight: 200,
                                                overflowY: "auto",
                                                background: "var(--adm-card-bg)",
                                                border: "1px solid var(--adm-border)",
                                                borderRadius: 6,
                                                zIndex: 10,
                                            }}
                                        >
                                            {filteredProducts.map((p) => (
                                                <div
                                                    key={p.id}
                                                    style={{
                                                        padding: "8px 12px",
                                                        cursor: "pointer",
                                                        fontSize: "0.85rem",
                                                    }}
                                                    onMouseDown={() =>
                                                        handleProductSelect(p.id, p.title)
                                                    }
                                                >
                                                    {p.title}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {errors.product && (
                                    <span className={styles.formError}>{errors.product}</span>
                                )}
                            </div>

                            {/* Model URL */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL модели *</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.modelUrl ? styles.formInputError : ""}`}
                                    value={modelUrl}
                                    onChange={(e) => setModelUrl(e.target.value)}
                                    placeholder="https://cdn.example.com/model.glb"
                                    maxLength={512}
                                />
                                {errors.modelUrl && (
                                    <span className={styles.formError}>{errors.modelUrl}</span>
                                )}
                            </div>

                            {/* Thumbnail URL */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL превью</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.thumbnailUrl ? styles.formInputError : ""}`}
                                    value={thumbnailUrl}
                                    onChange={(e) => setThumbnailUrl(e.target.value)}
                                    placeholder="https://cdn.example.com/thumb.webp"
                                    maxLength={512}
                                />
                                {errors.thumbnailUrl && (
                                    <span className={styles.formError}>{errors.thumbnailUrl}</span>
                                )}
                            </div>

                            {/* Jewelry type */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Тип украшения *</label>
                                <select
                                    className={`${styles.formSelect} ${errors.jewelryType ? styles.formInputError : ""}`}
                                    value={jewelryType}
                                    onChange={(e) =>
                                        setJewelryType(e.target.value as Jewelry3dType)
                                    }
                                >
                                    <option value="">Выбрать...</option>
                                    {JEWELRY_TYPES.map((t) => (
                                        <option key={t} value={t}>
                                            {JEWELRY_3D_TYPE_LABELS[t]}
                                        </option>
                                    ))}
                                </select>
                                {errors.jewelryType && (
                                    <span className={styles.formError}>{errors.jewelryType}</span>
                                )}
                            </div>

                            {/* Polygon count & file size */}
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Полигонов</label>
                                    <input
                                        type="number"
                                        className={styles.formInput}
                                        value={polygonCount}
                                        onChange={(e) => setPolygonCount(e.target.value)}
                                        placeholder="12000"
                                        min={0}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Размер файла (байт)</label>
                                    <input
                                        type="number"
                                        className={styles.formInput}
                                        value={fileSize}
                                        onChange={(e) => setFileSize(e.target.value)}
                                        placeholder="480000"
                                        min={0}
                                    />
                                </div>
                            </div>

                            {/* Default attachment point */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>
                                    Точка крепления по умолчанию
                                </label>
                                <select
                                    className={styles.formSelect}
                                    value={defaultAttachment}
                                    onChange={(e) => setDefaultAttachment(e.target.value)}
                                >
                                    <option value="">Не выбрана</option>
                                    {mockPiercingPoints.map((pp) => (
                                        <option key={pp.id} value={pp.name}>
                                            {pp.displayName} ({pp.name})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Material mapping card */}
                    <div className={styles.card} style={{ marginTop: 16 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Material Mapping (JSON)</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Маппинг материалов</label>
                                <textarea
                                    className={styles.formTextarea}
                                    value={materialMapping}
                                    onChange={(e) => setMaterialMapping(e.target.value)}
                                    style={{
                                        minHeight: 160,
                                        fontFamily: "monospace",
                                        fontSize: "0.82rem",
                                    }}
                                    placeholder='{"mesh_body": {"polished_titanium": "var_01"}}'
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.detailSide}>
                    {/* Status card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Статус</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Статус модели</label>
                                <select
                                    className={styles.formSelect}
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value as Jewelry3dStatus)}
                                >
                                    {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Validation status badge */}
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Валидация</label>
                                <span
                                    className={`${styles.badge} ${isValidated ? styles.badgeActive : styles.badgePending}`}
                                >
                                    {isValidated ? "Валидирована" : "Не валидирована"}
                                </span>
                            </div>

                            {/* Validation errors list */}
                            {!isValidated && validationErrors.length > 0 && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Ошибки валидации</label>
                                    <ul
                                        style={{
                                            margin: 0,
                                            paddingLeft: 16,
                                            fontSize: "0.82rem",
                                            color: "var(--adm-danger)",
                                        }}
                                    >
                                        {validationErrors.map((err, i) => (
                                            <li key={i} style={{ marginBottom: 4 }}>
                                                {err}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Linked product link */}
                            {selectedProductId && (
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Товар</label>
                                    <Link
                                        href={`/admin/products/${selectedProductId}`}
                                        style={{ fontSize: "0.85rem", color: "var(--adm-accent)" }}
                                    >
                                        {productSearch || "Перейти к товару"}
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
