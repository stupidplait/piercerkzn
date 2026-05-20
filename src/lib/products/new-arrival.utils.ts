/**
 * Pure helpers used by `@/lib/products/new-arrival`. Extracted so they can
 * be unit-tested without booting the database.
 */
export type NewArrivalAudience = "wishlist" | "marketing";

export interface AudienceCandidate {
    customerId: string;
    /** Source the candidate came from. Wishlist trumps marketing because
     *  wishlisted recipients get a higher-intent variant of the email + push. */
    audience: NewArrivalAudience;
}

/**
 * Combine wishlist + marketing audiences into a deduped, deterministic list.
 * If a customer appears in both pools, the wishlist record wins.
 */
export function dedupeAudience(
    wishlist: readonly { customerId: string }[],
    marketing: readonly { customerId: string }[]
): AudienceCandidate[] {
    const out = new Map<string, AudienceCandidate>();
    for (const w of wishlist) {
        if (!w.customerId) continue;
        out.set(w.customerId, { customerId: w.customerId, audience: "wishlist" });
    }
    for (const m of marketing) {
        if (!m.customerId) continue;
        if (out.has(m.customerId)) continue;
        out.set(m.customerId, { customerId: m.customerId, audience: "marketing" });
    }
    return Array.from(out.values());
}

/**
 * Split an array into fixed-size batches. Used to pace fanout dispatch
 * against Resend / Telegram Bot API rate limits (Resend: 10 req/s default,
 * Telegram: ~30 msg/s/recipient).
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
    if (size <= 0) return [items.slice()];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

/**
 * Build the canonical product URL used in emails / Telegram links.
 */
export function productUrl(siteOrigin: string, handle: string): string {
    return `${siteOrigin.replace(/\/$/, "")}/jewelry/${encodeURIComponent(handle)}`;
}

/**
 * Material slug -> Russian display label. Mirrors the catalogue filter
 * vocabulary in `@/lib/validations/product`.
 */
export const MATERIAL_LABELS_RU: Record<string, string> = {
    titanium: "титан",
    gold_14k: "золото 14к",
    gold_18k: "золото 18к",
    gold_white_14k: "белое золото 14к",
    gold_rose_14k: "розовое золото 14к",
    steel: "сталь",
    niobium: "ниобий",
    bioplast: "биопласт",
};

export const JEWELRY_TYPE_LABELS_RU: Record<string, string> = {
    stud: "гвоздик",
    hoop: "кольцо",
    barbell: "штанга",
    labret: "лабрет",
    captive: "captive",
    bcr: "BCR",
    circular: "циркулярная штанга",
    plug: "плаг",
    tunnel: "тоннель",
};
