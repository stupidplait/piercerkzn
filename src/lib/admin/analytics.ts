/**
 * Tiny helpers for the analytics admin endpoints.
 *
 * - `resolveAnalyticsRange()` fills in sane defaults when `from`/`to` are omitted.
 * - `truncSql()` produces a Postgres `date_trunc` SQL fragment for a given period.
 *
 * Each `/api/admin/analytics/*` route handler does its own aggregation —
 * the shapes differ enough that a single generic helper would obscure intent.
 */
import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { AnalyticsRangeQuery } from "@/lib/validations";

export interface ResolvedRange {
    from: Date;
    /** End of day (inclusive). */
    to: Date;
    period: AnalyticsRangeQuery["period"];
}

/** Returns the default lookback window for each period. */
function defaultLookbackDays(period: AnalyticsRangeQuery["period"]): number {
    switch (period) {
        case "daily":
            return 90; // 3 months of dailies
        case "weekly":
            return 12 * 7; // ~12 weeks
        case "monthly":
        default:
            return 365; // 12 months
    }
}

export function resolveAnalyticsRange(q: AnalyticsRangeQuery): ResolvedRange {
    const period = q.period;
    const now = new Date();
    const to = q.to ? new Date(`${q.to}T23:59:59Z`) : now;

    let from: Date;
    if (q.from) {
        from = new Date(`${q.from}T00:00:00Z`);
    } else {
        from = new Date(to.getTime() - defaultLookbackDays(period) * 86_400_000);
    }
    return { from, to, period };
}

/**
 * Build a `date_trunc('period', column)` SQL fragment usable in a select /
 * group-by clause.
 */
export function truncSql(column: PgColumn, period: AnalyticsRangeQuery["period"]): SQL {
    // `date_trunc` accepts the literal name of the precision; we never trust
    // the runtime-supplied `period` directly because it's already an enum.
    const unit = period === "daily" ? "day" : period === "weekly" ? "week" : "month";
    return sql`date_trunc(${unit}, ${column})`;
}

/**
 * Render a fixed-shape ISO date label (`YYYY-MM-DD` for daily, `YYYY-Www`
 * for weekly, `YYYY-MM` for monthly). Used in the `data[].date` field of the
 * spec'd response shape.
 */
export function formatBucketLabel(d: Date, period: AnalyticsRangeQuery["period"]): string {
    if (period === "monthly") {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    if (period === "weekly") {
        // ISO week; getUTCDate is fine for the bucket boundary returned by
        // `date_trunc('week', ...)` which is always Monday in Postgres.
        const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const day = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
        return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    }
    return d.toISOString().slice(0, 10);
}
