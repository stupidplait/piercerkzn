/**
 * Recalculate the cached price totals on a `curated_look` based on its
 * current `look_piece` set.
 *
 * Looks store three pricing fields:
 *   - `bundlePrice`           — admin-controlled (the discounted set price).
 *   - `totalIndividualPrice`  — sum of variant prices (auto-derived).
 *   - `discountPercent`       — `(1 - bundle/total) * 100`, 1 decimal.
 *
 * To prevent drift, the latter two are auto-recomputed every time the
 * piece set changes (add / remove / replace / update of variant). Admins
 * are not expected to maintain them by hand.
 *
 * Returns the freshly-computed totals so callers can echo them back in
 * the response without an extra SELECT.
 */
import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { curatedLooks, lookPieces, productVariants } from "@/db";

type Tx = PgTransaction<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface RecalculatedTotals {
    totalIndividualPrice: number;
    bundlePrice: number;
    discountPercent: string | null;
}

export async function recalcLookTotals(tx: Tx, lookId: string): Promise<RecalculatedTotals> {
    const [{ total }] = await tx
        .select({
            total: sql<number>`coalesce(sum(${productVariants.priceRub}), 0)::int`,
        })
        .from(lookPieces)
        .innerJoin(productVariants, eq(productVariants.id, lookPieces.variantId))
        .where(eq(lookPieces.lookId, lookId));

    const [look] = await tx
        .select({ bundlePrice: curatedLooks.bundlePrice })
        .from(curatedLooks)
        .where(eq(curatedLooks.id, lookId))
        .limit(1);
    const bundle = look?.bundlePrice ?? 0;

    let discountPercent: string | null = null;
    if (total > 0 && bundle <= total) {
        // Round to 1 decimal place via Math.round(x * 10) / 10. Stored as
        // text because the column is `numeric(4,1)` and Drizzle returns
        // numeric as string.
        const pct = Math.round(((total - bundle) / total) * 1000) / 10;
        discountPercent = pct.toFixed(1);
    }

    await tx
        .update(curatedLooks)
        .set({
            totalIndividualPrice: total,
            discountPercent,
            updatedAt: new Date(),
        })
        .where(eq(curatedLooks.id, lookId));

    return {
        totalIndividualPrice: total,
        bundlePrice: bundle,
        discountPercent,
    };
}
