import type { JEWELRY_ITEMS } from "../../new-design/JewelryShowcase";

export interface LayerProps {
    activeJewelry: number;
    items: typeof JEWELRY_ITEMS;
}
