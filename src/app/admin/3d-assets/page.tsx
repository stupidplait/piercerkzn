"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import {
    mockBodyModels,
    mockJewelry3dModels,
    mockPiercingPoints,
    mockProducts,
    BODY_MODEL_AREA_LABELS,
    JEWELRY_3D_TYPE_LABELS,
    JEWELRY_3D_STATUS_LABELS,
    type Jewelry3dStatus,
    type Jewelry3dType,
    type MockPiercingPoint,
} from "@/lib/admin-data";

// ── Anchor editing types ──────────────────────────────────────────────────────

interface EditableAnchor {
    _tempId: string;
    _isNew: boolean;
    _deleted: boolean;
    id: string;
    bodyModelId: string;
    name: string;
    displayName: string;
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    normalX: number;
    normalY: number;
    normalZ: number;
    compatibleJewelryTypes: Jewelry3dType[];
    compatibleGauges: string;
    maxJewelryDiameterMm: number | null;
    sortOrder: number;
}

interface AnchorRowError {
    name?: string;
    displayName?: string;
}

const ALL_JEWELRY_TYPES: Jewelry3dType[] = [
    "ring",
    "barbell",
    "labret",
    "stud",
    "hoop",
    "clicker",
    "chain",
];

function toEditableAnchor(pp: MockPiercingPoint): EditableAnchor {
    return {
        _tempId: pp.id,
        _isNew: false,
        _deleted: false,
        id: pp.id,
        bodyModelId: pp.bodyModelId,
        name: pp.name,
        displayName: pp.displayName,
        positionX: pp.positionX,
        positionY: pp.positionY,
        positionZ: pp.positionZ,
        rotationX: pp.rotationX,
        rotationY: pp.rotationY,
        rotationZ: pp.rotationZ,
        normalX: pp.normalX,
        normalY: pp.normalY,
        normalZ: pp.normalZ,
        compatibleJewelryTypes: [...pp.compatibleJewelryTypes],
        compatibleGauges: pp.compatibleGauges?.join(", ") ?? "",
        maxJewelryDiameterMm: pp.maxJewelryDiameterMm,
        sortOrder: pp.sortOrder,
    };
}

let tempIdCounter = 0;
function createEmptyAnchor(bodyModelId: string, nextSortOrder: number): EditableAnchor {
    tempIdCounter++;
    return {
        _tempId: `new_${tempIdCounter}_${Date.now()}`,
        _isNew: true,
        _deleted: false,
        id: "",
        bodyModelId,
        name: "",
        displayName: "",
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        normalX: 0,
        normalY: 0,
        normalZ: 1,
        compatibleJewelryTypes: [],
        compatibleGauges: "",
        maxJewelryDiameterMm: null,
        sortOrder: nextSortOrder,
    };
}

function bodyModelStatusClass(isActive: boolean) {
    return isActive ? styles.badgeActive : styles.badgeInactive;
}

function jewelryStatusClass(s: Jewelry3dStatus) {
    if (s === "active") return styles.badgeActive;
    if (s === "inactive") return styles.badgeInactive;
    return styles.badgePending;
}

function validationBadgeClass(isValidated: boolean) {
    return isValidated ? styles.badgeConfirmed : styles.badgeDraft;
}

export default function ThreeDAssetsPage() {
    const [tab, setTab] = useState(0);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [bodyModelFilter, setBodyModelFilter] = useState("");

    const totalCount =
        mockBodyModels.length + mockJewelry3dModels.length + mockPiercingPoints.length;

    // ── Body models filtering ──
    const filteredBodyModels = mockBodyModels.filter((m) => {
        const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase());
        const matchStatus =
            !statusFilter ||
            (statusFilter === "active" && m.isActive) ||
            (statusFilter === "inactive" && !m.isActive);
        return matchSearch && matchStatus;
    });

    // ── Jewelry models filtering ──
    const filteredJewelry = mockJewelry3dModels.filter((j) => {
        const product = mockProducts.find((p) => p.id === j.productId);
        const productTitle = product?.title ?? "";
        const matchSearch = !search || productTitle.toLowerCase().includes(search.toLowerCase());
        const matchStatus = !statusFilter || j.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const resetFilters = () => {
        setSearch("");
        setStatusFilter("");
        setBodyModelFilter("");
    };

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>3D-активы</h1>
                    <span className={styles.pageDesc}>
                        Управление 3D-моделями · {totalCount} объектов
                    </span>
                </div>
                <div className={styles.headerActions}>
                    <Link
                        href="/admin/3d-assets/body-models/new"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                    >
                        + Добавить модель
                    </Link>
                </div>
            </div>

            <div className={styles.tabs}>
                <div className={styles.tabList}>
                    {["Модели тела", "3D-украшения", "Якоря"].map((t, i) => (
                        <button
                            key={t}
                            className={`${styles.tabBtn} ${tab === i ? styles.tabBtnActive : ""}`}
                            onClick={() => {
                                setTab(i);
                                setSearch("");
                                setStatusFilter("");
                                setBodyModelFilter("");
                            }}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

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
                        placeholder={
                            tab === 0
                                ? "Поиск по названию модели..."
                                : tab === 1
                                  ? "Поиск по названию товара..."
                                  : "Поиск по названию якоря..."
                        }
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                {(tab === 0 || tab === 1) && (
                    <select
                        className={styles.filterSelect}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="">Все статусы</option>
                        {tab === 0 ? (
                            <>
                                <option value="active">Активна</option>
                                <option value="inactive">Неактивна</option>
                            </>
                        ) : (
                            <>
                                <option value="active">Активна</option>
                                <option value="inactive">Неактивна</option>
                                <option value="processing">Обработка</option>
                            </>
                        )}
                    </select>
                )}
                {tab === 2 && (
                    <select
                        className={styles.filterSelect}
                        value={bodyModelFilter}
                        onChange={(e) => setBodyModelFilter(e.target.value)}
                    >
                        <option value="">Все модели тела</option>
                        {mockBodyModels.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* ── Body Models Tab ── */}
            {tab === 0 && (
                <div className={styles.card}>
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead className={styles.tHead}>
                                <tr>
                                    <th>Название</th>
                                    <th>Зона</th>
                                    <th>Сторона</th>
                                    <th>Полигоны</th>
                                    <th>Статус</th>
                                    <th style={{ textAlign: "right", paddingRight: 22 }}>
                                        Действия
                                    </th>
                                </tr>
                            </thead>
                            <tbody className={styles.tBody}>
                                {filteredBodyModels.length === 0 ? (
                                    <tr>
                                        <td colSpan={6}>
                                            <div className={styles.emptyState}>
                                                <div className={styles.emptyIcon}>🔍</div>
                                                <p className={styles.emptyTitle}>
                                                    Ничего не найдено
                                                </p>
                                                <p className={styles.emptyText}>
                                                    Попробуйте изменить параметры поиска
                                                </p>
                                                <button
                                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                    onClick={resetFilters}
                                                >
                                                    Сбросить фильтры
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredBodyModels.map((m) => (
                                        <tr key={m.id}>
                                            <td className={styles.td}>
                                                <div style={{ fontWeight: 500 }}>{m.name}</div>
                                                <div
                                                    className={styles.tdMono}
                                                    style={{
                                                        marginTop: 2,
                                                        fontSize: "0.68rem",
                                                        opacity: 0.7,
                                                    }}
                                                >
                                                    v{m.version}
                                                </div>
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {BODY_MODEL_AREA_LABELS[m.area]}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {m.side === "left"
                                                    ? "Левая"
                                                    : m.side === "right"
                                                      ? "Правая"
                                                      : "—"}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {m.polygonCount.toLocaleString("ru")}
                                            </td>
                                            <td className={styles.td}>
                                                <span
                                                    className={`${styles.badge} ${bodyModelStatusClass(m.isActive)}`}
                                                >
                                                    {m.isActive ? "Активна" : "Неактивна"}
                                                </span>
                                            </td>
                                            <td className={styles.td}>
                                                <div className={styles.tdActions}>
                                                    <Link
                                                        href={`/admin/3d-assets/body-models/${m.id}`}
                                                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                    >
                                                        Изм.
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Jewelry Models Tab ── */}
            {tab === 1 && (
                <div className={styles.card}>
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead className={styles.tHead}>
                                <tr>
                                    <th>Товар</th>
                                    <th>Тип</th>
                                    <th>Полигоны</th>
                                    <th>Размер</th>
                                    <th>Валидация</th>
                                    <th>Статус</th>
                                    <th style={{ textAlign: "right", paddingRight: 22 }}>
                                        Действия
                                    </th>
                                </tr>
                            </thead>
                            <tbody className={styles.tBody}>
                                {filteredJewelry.length === 0 ? (
                                    <tr>
                                        <td colSpan={7}>
                                            <div className={styles.emptyState}>
                                                <div className={styles.emptyIcon}>🔍</div>
                                                <p className={styles.emptyTitle}>
                                                    Ничего не найдено
                                                </p>
                                                <p className={styles.emptyText}>
                                                    Попробуйте изменить параметры поиска
                                                </p>
                                                <button
                                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                    onClick={resetFilters}
                                                >
                                                    Сбросить фильтры
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredJewelry.map((j) => {
                                        const product = mockProducts.find(
                                            (p) => p.id === j.productId
                                        );
                                        return (
                                            <tr key={j.id}>
                                                <td className={styles.td}>
                                                    <div style={{ fontWeight: 500 }}>
                                                        {product?.title ?? "Неизвестный товар"}
                                                    </div>
                                                </td>
                                                <td className={`${styles.td} ${styles.tdMono}`}>
                                                    {JEWELRY_3D_TYPE_LABELS[j.jewelryType]}
                                                </td>
                                                <td className={`${styles.td} ${styles.tdMono}`}>
                                                    {j.polygonCount
                                                        ? j.polygonCount.toLocaleString("ru")
                                                        : "—"}
                                                </td>
                                                <td className={`${styles.td} ${styles.tdMono}`}>
                                                    {j.fileSizeBytes
                                                        ? `${(j.fileSizeBytes / 1024).toFixed(0)} КБ`
                                                        : "—"}
                                                </td>
                                                <td className={styles.td}>
                                                    <span
                                                        className={`${styles.badge} ${validationBadgeClass(j.isValidated)}`}
                                                    >
                                                        {j.isValidated ? "Валидна" : "Не валидна"}
                                                    </span>
                                                </td>
                                                <td className={styles.td}>
                                                    <span
                                                        className={`${styles.badge} ${jewelryStatusClass(j.status)}`}
                                                    >
                                                        {JEWELRY_3D_STATUS_LABELS[j.status]}
                                                    </span>
                                                </td>
                                                <td className={styles.td}>
                                                    <div className={styles.tdActions}>
                                                        <Link
                                                            href={`/admin/3d-assets/jewelry/${j.id}`}
                                                            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                        >
                                                            Изм.
                                                        </Link>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Anchors Tab (Editable) ── */}
            {tab === 2 && (
                <AnchorsEditor
                    bodyModelFilter={bodyModelFilter}
                    search={search}
                    resetFilters={resetFilters}
                />
            )}
        </>
    );
}

// ── Anchors Inline Editor Component ───────────────────────────────────────────

function AnchorsEditor({
    bodyModelFilter,
    search,
    resetFilters,
}: {
    bodyModelFilter: string;
    search: string;
    resetFilters: () => void;
}) {
    const [anchors, setAnchors] = useState<EditableAnchor[]>(() => {
        if (!bodyModelFilter) return [];
        return mockPiercingPoints
            .filter((pp) => pp.bodyModelId === bodyModelFilter)
            .map(toEditableAnchor);
    });
    const [errors, setErrors] = useState<Record<string, AnchorRowError>>({});
    const [globalError, setGlobalError] = useState("");
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [lastLoadedModel, setLastLoadedModel] = useState(bodyModelFilter);

    // Reload anchors when body model filter changes
    if (bodyModelFilter !== lastLoadedModel) {
        setLastLoadedModel(bodyModelFilter);
        if (bodyModelFilter) {
            setAnchors(
                mockPiercingPoints
                    .filter((pp) => pp.bodyModelId === bodyModelFilter)
                    .map(toEditableAnchor)
            );
        } else {
            setAnchors([]);
        }
        setErrors({});
        setGlobalError("");
        setSaveSuccess(false);
    }

    // Filter visible anchors by search (but keep all in state for editing)
    const visibleAnchors = anchors.filter((a) => {
        if (a._deleted) return false;
        if (!search) return true;
        return (
            a.displayName.toLowerCase().includes(search.toLowerCase()) ||
            a.name.toLowerCase().includes(search.toLowerCase())
        );
    });

    const updateAnchor = useCallback(
        (tempId: string, field: keyof EditableAnchor, value: unknown) => {
            setAnchors((prev) =>
                prev.map((a) => (a._tempId === tempId ? { ...a, [field]: value } : a))
            );
            // Clear error for this field
            setErrors((prev) => {
                const rowErrors = prev[tempId];
                if (!rowErrors) return prev;
                const updated = { ...rowErrors };
                delete updated[field as keyof AnchorRowError];
                if (Object.keys(updated).length === 0) {
                    const next = { ...prev };
                    delete next[tempId];
                    return next;
                }
                return { ...prev, [tempId]: updated };
            });
            setSaveSuccess(false);
        },
        []
    );

    const toggleJewelryType = useCallback((tempId: string, type: Jewelry3dType) => {
        setAnchors((prev) =>
            prev.map((a) => {
                if (a._tempId !== tempId) return a;
                const types = a.compatibleJewelryTypes.includes(type)
                    ? a.compatibleJewelryTypes.filter((t) => t !== type)
                    : [...a.compatibleJewelryTypes, type];
                return { ...a, compatibleJewelryTypes: types };
            })
        );
        setSaveSuccess(false);
    }, []);

    const addAnchor = useCallback(() => {
        const activeAnchors = anchors.filter((a) => !a._deleted);
        const maxSort =
            activeAnchors.length > 0 ? Math.max(...activeAnchors.map((a) => a.sortOrder)) : 0;
        setAnchors((prev) => [...prev, createEmptyAnchor(bodyModelFilter, maxSort + 1)]);
        setSaveSuccess(false);
    }, [anchors, bodyModelFilter]);

    const deleteAnchor = useCallback((tempId: string) => {
        setAnchors((prev) =>
            prev.map((a) => (a._tempId === tempId ? { ...a, _deleted: true } : a))
        );
        // Clear errors for deleted row
        setErrors((prev) => {
            const next = { ...prev };
            delete next[tempId];
            return next;
        });
        setSaveSuccess(false);
    }, []);

    const validate = (): boolean => {
        const newErrors: Record<string, AnchorRowError> = {};
        const activeAnchors = anchors.filter((a) => !a._deleted);
        const machineNames = new Map<string, string[]>();

        for (const a of activeAnchors) {
            const rowErr: AnchorRowError = {};

            // Machine name validation
            if (!a.name.trim()) {
                rowErr.name = "Обязательное поле";
            } else if (a.name.length > 50) {
                rowErr.name = "Максимум 50 символов";
            } else if (!/^[a-z][a-z0-9_]*$/.test(a.name)) {
                rowErr.name = "Только строчные латинские буквы и подчёркивания";
            }

            // Display name validation
            if (!a.displayName.trim()) {
                rowErr.displayName = "Обязательное поле";
            } else if (a.displayName.length > 100) {
                rowErr.displayName = "Максимум 100 символов";
            }

            if (Object.keys(rowErr).length > 0) {
                newErrors[a._tempId] = rowErr;
            }

            // Track machine names for duplicate check
            const nameLower = a.name.trim().toLowerCase();
            if (nameLower) {
                if (!machineNames.has(nameLower)) {
                    machineNames.set(nameLower, []);
                }
                machineNames.get(nameLower)!.push(a._tempId);
            }
        }

        // Check for duplicates
        for (const [, ids] of machineNames) {
            if (ids.length > 1) {
                for (const id of ids) {
                    if (!newErrors[id]) newErrors[id] = {};
                    newErrors[id].name = "Дублирующееся машинное имя";
                }
            }
        }

        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) {
            setGlobalError("Исправьте ошибки в выделенных строках");
            return false;
        }

        setGlobalError("");
        return true;
    };

    const handleSaveAll = () => {
        if (!validate()) return;
        // Mock save: in real app this would call an API
        setSaveSuccess(true);
        setGlobalError("");
    };

    // No body model selected — show prompt
    if (!bodyModelFilter) {
        return (
            <div className={styles.card}>
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>📌</div>
                    <p className={styles.emptyTitle}>Выберите модель тела</p>
                    <p className={styles.emptyText}>
                        Для редактирования якорей выберите модель тела из выпадающего списка выше
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.card}>
            {globalError && (
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--adm-rule)" }}>
                    <span
                        className={styles.formError}
                        style={{ display: "block", fontSize: "0.72rem" }}
                    >
                        {globalError}
                    </span>
                </div>
            )}
            {saveSuccess && (
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--adm-rule)" }}>
                    <span
                        style={{
                            color: "var(--adm-green, #22c55e)",
                            fontFamily: "var(--font-mono), monospace",
                            fontSize: "0.72rem",
                        }}
                    >
                        ✓ Якоря успешно сохранены
                    </span>
                </div>
            )}

            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead className={styles.tHead}>
                        <tr>
                            <th>Машинное имя</th>
                            <th>Название</th>
                            <th>Позиция (X/Y/Z)</th>
                            <th>Вращение (X/Y/Z)</th>
                            <th>Нормаль (X/Y/Z)</th>
                            <th>Типы украшений</th>
                            <th>Калибры</th>
                            <th>Макс. ∅</th>
                            <th>Порядок</th>
                            <th style={{ textAlign: "right", paddingRight: 12 }}>Действия</th>
                        </tr>
                    </thead>
                    <tbody className={styles.tBody}>
                        {visibleAnchors.length === 0 ? (
                            <tr>
                                <td colSpan={10}>
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyIcon}>🔍</div>
                                        <p className={styles.emptyTitle}>Ничего не найдено</p>
                                        <p className={styles.emptyText}>
                                            Нет якорей для этой модели или поиск не дал результатов
                                        </p>
                                        <button
                                            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                            onClick={resetFilters}
                                        >
                                            Сбросить фильтры
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            visibleAnchors.map((anchor) => {
                                const rowErrors = errors[anchor._tempId];
                                return (
                                    <tr
                                        key={anchor._tempId}
                                        style={
                                            rowErrors
                                                ? { background: "rgba(248, 113, 113, 0.05)" }
                                                : undefined
                                        }
                                    >
                                        {/* Machine name */}
                                        <td className={styles.td} style={{ minWidth: 140 }}>
                                            <input
                                                type="text"
                                                className={`${styles.formInput} ${rowErrors?.name ? styles.formInputError : ""}`}
                                                value={anchor.name}
                                                onChange={(e) =>
                                                    updateAnchor(
                                                        anchor._tempId,
                                                        "name",
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="machine_name"
                                                style={{ fontSize: "0.72rem", padding: "4px 6px" }}
                                            />
                                            {rowErrors?.name && (
                                                <span className={styles.formError}>
                                                    {rowErrors.name}
                                                </span>
                                            )}
                                        </td>

                                        {/* Display name */}
                                        <td className={styles.td} style={{ minWidth: 130 }}>
                                            <input
                                                type="text"
                                                className={`${styles.formInput} ${rowErrors?.displayName ? styles.formInputError : ""}`}
                                                value={anchor.displayName}
                                                onChange={(e) =>
                                                    updateAnchor(
                                                        anchor._tempId,
                                                        "displayName",
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="Название"
                                                style={{ fontSize: "0.72rem", padding: "4px 6px" }}
                                            />
                                            {rowErrors?.displayName && (
                                                <span className={styles.formError}>
                                                    {rowErrors.displayName}
                                                </span>
                                            )}
                                        </td>

                                        {/* Position X/Y/Z */}
                                        <td className={styles.td} style={{ minWidth: 180 }}>
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.positionX}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "positionX",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.positionY}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "positionY",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.positionZ}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "positionZ",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                            </div>
                                        </td>

                                        {/* Rotation X/Y/Z */}
                                        <td className={styles.td} style={{ minWidth: 180 }}>
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.rotationX}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "rotationX",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.rotationY}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "rotationY",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.rotationZ}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "rotationZ",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                            </div>
                                        </td>

                                        {/* Normal X/Y/Z */}
                                        <td className={styles.td} style={{ minWidth: 180 }}>
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.normalX}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "normalX",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.normalY}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "normalY",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    className={styles.formInput}
                                                    value={anchor.normalZ}
                                                    onChange={(e) =>
                                                        updateAnchor(
                                                            anchor._tempId,
                                                            "normalZ",
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    style={{
                                                        width: 56,
                                                        fontSize: "0.68rem",
                                                        padding: "4px 4px",
                                                    }}
                                                />
                                            </div>
                                        </td>

                                        {/* Compatible jewelry types (multi-select checkboxes) */}
                                        <td className={styles.td} style={{ minWidth: 160 }}>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    flexWrap: "wrap",
                                                    gap: 3,
                                                }}
                                            >
                                                {ALL_JEWELRY_TYPES.map((type) => (
                                                    <label
                                                        key={type}
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 2,
                                                            fontSize: "0.62rem",
                                                            cursor: "pointer",
                                                            opacity:
                                                                anchor.compatibleJewelryTypes.includes(
                                                                    type
                                                                )
                                                                    ? 1
                                                                    : 0.5,
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={anchor.compatibleJewelryTypes.includes(
                                                                type
                                                            )}
                                                            onChange={() =>
                                                                toggleJewelryType(
                                                                    anchor._tempId,
                                                                    type
                                                                )
                                                            }
                                                            style={{ width: 12, height: 12 }}
                                                        />
                                                        {JEWELRY_3D_TYPE_LABELS[type]}
                                                    </label>
                                                ))}
                                            </div>
                                        </td>

                                        {/* Compatible gauges */}
                                        <td className={styles.td} style={{ minWidth: 90 }}>
                                            <input
                                                type="text"
                                                className={styles.formInput}
                                                value={anchor.compatibleGauges}
                                                onChange={(e) =>
                                                    updateAnchor(
                                                        anchor._tempId,
                                                        "compatibleGauges",
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="18g, 16g"
                                                style={{
                                                    fontSize: "0.68rem",
                                                    padding: "4px 4px",
                                                    width: 80,
                                                }}
                                            />
                                        </td>

                                        {/* Max diameter */}
                                        <td className={styles.td} style={{ minWidth: 60 }}>
                                            <input
                                                type="number"
                                                step="0.1"
                                                className={styles.formInput}
                                                value={anchor.maxJewelryDiameterMm ?? ""}
                                                onChange={(e) =>
                                                    updateAnchor(
                                                        anchor._tempId,
                                                        "maxJewelryDiameterMm",
                                                        e.target.value
                                                            ? parseFloat(e.target.value)
                                                            : null
                                                    )
                                                }
                                                placeholder="мм"
                                                style={{
                                                    fontSize: "0.68rem",
                                                    padding: "4px 4px",
                                                    width: 54,
                                                }}
                                            />
                                        </td>

                                        {/* Sort order */}
                                        <td className={styles.td} style={{ minWidth: 54 }}>
                                            <input
                                                type="number"
                                                className={styles.formInput}
                                                value={anchor.sortOrder}
                                                onChange={(e) =>
                                                    updateAnchor(
                                                        anchor._tempId,
                                                        "sortOrder",
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                                style={{
                                                    fontSize: "0.68rem",
                                                    padding: "4px 4px",
                                                    width: 48,
                                                }}
                                            />
                                        </td>

                                        {/* Delete button */}
                                        <td
                                            className={styles.td}
                                            style={{ textAlign: "right", paddingRight: 12 }}
                                        >
                                            <button
                                                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                                                onClick={() => deleteAnchor(anchor._tempId)}
                                                title="Удалить якорь"
                                            >
                                                ✕
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Action buttons */}
            <div
                style={{
                    display: "flex",
                    gap: 12,
                    padding: "16px",
                    borderTop: "1px solid var(--adm-rule)",
                }}
            >
                <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={addAnchor}>
                    + Добавить якорь
                </button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSaveAll}>
                    Сохранить все
                </button>
            </div>
        </div>
    );
}
