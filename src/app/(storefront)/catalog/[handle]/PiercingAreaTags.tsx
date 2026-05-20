import Link from "next/link";

import styles from "./product-detail.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PiercingAreaTagsProps {
    areas: string[];
}

// ---------------------------------------------------------------------------
// Area labels (Russian)
// ---------------------------------------------------------------------------

const AREA_LABELS: Record<string, string> = {
    ear_helix: "Хеликс",
    ear_tragus: "Трагус",
    ear_conch: "Конч",
    ear_rook: "Рук",
    ear_daith: "Дейс",
    ear_lobe: "Мочка",
    ear_industrial: "Индастриал",
    ear_forward_helix: "Форвард хеликс",
    ear_flat: "Флэт",
    ear_snug: "Снаг",
    nose_nostril: "Нострил",
    nose_septum: "Септум",
    nose_bridge: "Бридж",
    lip_labret: "Лабрет",
    lip_medusa: "Медуза",
    lip_monroe: "Монро",
    lip_vertical: "Вертикальный лабрет",
    navel: "Пупок",
    eyebrow: "Бровь",
    tongue: "Язык",
    nipple: "Сосок",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PiercingAreaTags({ areas }: PiercingAreaTagsProps) {
    return (
        <div className={styles.areaTagsSection}>
            <span className={styles.areaTagsLabel}>Зоны прокола</span>
            <div className={styles.areaTags}>
                {areas.map((area) => (
                    <Link
                        key={area}
                        href={`/catalog?area=${encodeURIComponent(area)}`}
                        className={styles.areaTag}
                    >
                        {AREA_LABELS[area] || area}
                    </Link>
                ))}
            </div>
        </div>
    );
}
