/**
 * Newsletter marketing audience selector.
 *
 * Returns the set of customers eligible to receive a marketing newsletter:
 *   - notificationMarketing = true
 *   - deletedAt IS NULL
 *   - email IS NOT NULL
 *
 * Ordering is stable by `id` so a re-snapshot in the stuck-recovery sweeper
 * produces the same chunk boundaries as the original fanout.
 *
 * Pure DB module — no side effects, no caching, no settings reads. The
 * orchestration layer (`lib/newsletters/dispatch.ts`) wraps this with chunking
 * and per-recipient idempotency.
 */
import "server-only";

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { customers, db } from "@/db";

export interface MarketingAudienceMember {
    id: string;
    email: string;
}

/**
 * Select all customers opted in to marketing email, excluding soft-deleted
 * accounts and rows missing an email address. Sorted by `id` for deterministic
 * chunking across re-runs.
 */
export async function selectMarketingAudience(): Promise<MarketingAudienceMember[]> {
    const rows = await db
        .select({ id: customers.id, email: customers.email })
        .from(customers)
        .where(
            and(
                eq(customers.notificationMarketing, true),
                isNull(customers.deletedAt),
                isNotNull(customers.email)
            )
        )
        .orderBy(asc(customers.id));

    return rows.filter((r): r is { id: string; email: string } => r.email !== null);
}
