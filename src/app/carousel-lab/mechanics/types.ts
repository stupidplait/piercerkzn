import type { JEWELRY_ITEMS } from "../../new-design/JewelryShowcase";

export interface MechanicProps {
    activeJewelry: number;
    items: typeof JEWELRY_ITEMS;
    triggerSwap: (direction: number) => void;
    goToIndex: (target: number) => void;
    chapterRef: React.RefObject<HTMLDivElement | null>;
}
