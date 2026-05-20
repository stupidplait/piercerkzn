/**
 * Pure helpers for `@/lib/media/process` — DB-/R2-free so they can be
 * unit-tested without booting the runtime side of the worker.
 */
export interface ImageVariantSpec {
    suffix: "thumb" | "large" | "og";
    width: number;
    height?: number;
    fit?: "cover" | "inside";
}

export const IMAGE_VARIANTS: ReadonlyArray<ImageVariantSpec> = [
    { suffix: "thumb", width: 300, fit: "inside" },
    { suffix: "large", width: 1024, fit: "inside" },
    { suffix: "og", width: 1200, height: 630, fit: "cover" },
];

/**
 * Build a derivative key from a source key.
 *
 *   products/2026/05/abc.jpg + "thumb"  =>  products/2026/05/abc.thumb.webp
 */
export function deriveVariantKey(sourceKey: string, suffix: string): string {
    const lastDot = sourceKey.lastIndexOf(".");
    const stem = lastDot === -1 ? sourceKey : sourceKey.slice(0, lastDot);
    return `${stem}.${suffix}.webp`;
}
