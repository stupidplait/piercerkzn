"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../../../admin.module.css";
import { mockBodyModels, type BodyModelArea } from "@/lib/admin-data";

const AREA_OPTIONS: { value: BodyModelArea; label: string }[] = [
    { value: "ear", label: "Ухо" },
    { value: "nose", label: "Нос" },
    { value: "lip", label: "Губа" },
    { value: "eyebrow", label: "Бровь" },
    { value: "navel", label: "Пупок" },
    { value: "face", label: "Лицо" },
];

const SIDE_OPTIONS: { value: string; label: string }[] = [
    { value: "left", label: "Левая" },
    { value: "right", label: "Правая" },
    { value: "none", label: "Нет" },
];

interface FormErrors {
    name?: string;
    area?: string;
    modelUrl?: string;
    cameraDefaults?: string;
}

function validateCameraDefaults(json: string): string | null {
    if (!json.trim()) return "Обязательное поле";
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== "object") return "Должен быть JSON-объект";
        if (
            !Array.isArray(parsed.position) ||
            parsed.position.length !== 3 ||
            !parsed.position.every((n: unknown) => typeof n === "number")
        ) {
            return "Поле position должно быть массивом из 3 чисел";
        }
        if (
            !Array.isArray(parsed.target) ||
            parsed.target.length !== 3 ||
            !parsed.target.every((n: unknown) => typeof n === "number")
        ) {
            return "Поле target должно быть массивом из 3 чисел";
        }
        if (typeof parsed.fov !== "number" || parsed.fov < 1 || parsed.fov > 180) {
            return "Поле fov должно быть числом от 1 до 180";
        }
        return null;
    } catch {
        return "Невалидный JSON";
    }
}

export default function BodyModelEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const isNew = id === "new";
    const model = isNew ? null : (mockBodyModels.find((m) => m.id === id) ?? null);

    const [name, setName] = useState(model?.name ?? "");
    const [area, setArea] = useState<BodyModelArea | "">(model?.area ?? "");
    const [side, setSide] = useState<string>(model?.side ?? "none");
    const [modelUrl, setModelUrl] = useState(model?.modelUrl ?? "");
    const [lod1Url, setLod1Url] = useState(model?.modelUrlLod1 ?? "");
    const [lod2Url, setLod2Url] = useState(model?.modelUrlLod2 ?? "");
    const [thumbnailUrl, setThumbnailUrl] = useState(model?.thumbnailUrl ?? "");
    const [polygonCount, setPolygonCount] = useState(
        model?.polygonCount ? String(model.polygonCount) : ""
    );
    const [fileSize, setFileSize] = useState(
        model?.fileSizeBytes ? String(model.fileSizeBytes) : ""
    );
    const [cameraDefaults, setCameraDefaults] = useState(
        model?.cameraDefaults ? JSON.stringify(model.cameraDefaults, null, 2) : ""
    );
    const [isActive, setIsActive] = useState(model?.isActive ?? true);
    const [errors, setErrors] = useState<FormErrors>({});

    const handleSubmit = () => {
        const newErrors: FormErrors = {};

        if (!name.trim()) newErrors.name = "Обязательное поле";
        else if (name.length > 100) newErrors.name = "Максимум 100 символов";

        if (!area) newErrors.area = "Обязательное поле";

        if (!modelUrl.trim()) newErrors.modelUrl = "Обязательное поле";
        else if (modelUrl.length > 512) newErrors.modelUrl = "Максимум 512 символов";

        const cameraError = validateCameraDefaults(cameraDefaults);
        if (cameraError) newErrors.cameraDefaults = cameraError;

        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) return;

        // Save to mock state (in a real app this would be an API call)
        router.push("/admin/3d-assets");
    };

    return (
        <>
            <Link href="/admin/3d-assets" className={styles.backLink}>
                ← 3D-активы
            </Link>

            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>
                        {isNew ? "Новая модель тела" : (model?.name ?? "Модель тела")}
                    </h1>
                    <span className={styles.pageDesc}>
                        {isNew ? "Создание новой 3D-модели" : `ID: ${id}`}
                    </span>
                </div>
                <div className={styles.headerActions}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSubmit}>
                        Сохранить
                    </button>
                </div>
            </div>

            <div className={styles.detailLayout}>
                <div className={styles.detailMain}>
                    {/* Basic info card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Основная информация</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Название *</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.name ? styles.formInputError : ""}`}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Ухо левое (стандарт)"
                                    maxLength={100}
                                />
                                {errors.name && (
                                    <span className={styles.formError}>{errors.name}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Зона *</label>
                                <select
                                    className={`${styles.formSelect} ${errors.area ? styles.formInputError : ""}`}
                                    value={area}
                                    onChange={(e) => setArea(e.target.value as BodyModelArea)}
                                >
                                    <option value="">Выбрать...</option>
                                    {AREA_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                                {errors.area && (
                                    <span className={styles.formError}>{errors.area}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Сторона</label>
                                <select
                                    className={styles.formSelect}
                                    value={side}
                                    onChange={(e) => setSide(e.target.value)}
                                >
                                    {SIDE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL модели *</label>
                                <input
                                    type="text"
                                    className={`${styles.formInput} ${errors.modelUrl ? styles.formInputError : ""}`}
                                    value={modelUrl}
                                    onChange={(e) => setModelUrl(e.target.value)}
                                    placeholder="https://cdn.example.com/models/model.glb"
                                    maxLength={512}
                                />
                                {errors.modelUrl && (
                                    <span className={styles.formError}>{errors.modelUrl}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL LOD1</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={lod1Url}
                                    onChange={(e) => setLod1Url(e.target.value)}
                                    placeholder="https://cdn.example.com/models/model_lod1.glb"
                                    maxLength={512}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL LOD2</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={lod2Url}
                                    onChange={(e) => setLod2Url(e.target.value)}
                                    placeholder="https://cdn.example.com/models/model_lod2.glb"
                                    maxLength={512}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>URL миниатюры</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={thumbnailUrl}
                                    onChange={(e) => setThumbnailUrl(e.target.value)}
                                    placeholder="https://cdn.example.com/thumbs/model.webp"
                                    maxLength={512}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Количество полигонов</label>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    value={polygonCount}
                                    onChange={(e) => setPolygonCount(e.target.value)}
                                    placeholder="72000"
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
                                    placeholder="2450000"
                                    min={0}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Camera defaults card */}
                    <div className={styles.card} style={{ marginTop: 16 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Настройки камеры</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Camera Defaults (JSON) *</label>
                                <textarea
                                    className={`${styles.formTextarea} ${errors.cameraDefaults ? styles.formInputError : ""}`}
                                    value={cameraDefaults}
                                    onChange={(e) => setCameraDefaults(e.target.value)}
                                    placeholder={
                                        '{\n  "position": [0, 0.5, 3],\n  "target": [0, 0, 0],\n  "fov": 45\n}'
                                    }
                                    style={{
                                        minHeight: 160,
                                        fontFamily: "var(--font-mono), monospace",
                                    }}
                                />
                                {errors.cameraDefaults && (
                                    <span className={styles.formError}>
                                        {errors.cameraDefaults}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.detailSide}>
                    {/* Status & metadata card */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Статус и метаданные</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Статус</label>
                                <select
                                    className={styles.formSelect}
                                    value={isActive ? "active" : "inactive"}
                                    onChange={(e) => setIsActive(e.target.value === "active")}
                                >
                                    <option value="active">Активна</option>
                                    <option value="inactive">Неактивна</option>
                                </select>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Дата создания</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={
                                        model?.createdAt
                                            ? new Date(model.createdAt).toLocaleDateString("ru-RU")
                                            : new Date().toLocaleDateString("ru-RU")
                                    }
                                    readOnly
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Версия</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={model?.version ?? 1}
                                    readOnly
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
