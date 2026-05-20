/**
 * POST /api/notifications/read-all — mark every unread notification owned by
 * the current customer as read in a single statement.
 *
 * Returns the number of rows that were freshly marked.
 */
import { and, eq, sql } from "drizzle-orm";

import { forbidden, internal, ok, requireUser } from "@/lib/api";
import { db, notificationLogs } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;
    if (!sess.customerId) return forbidden("Сессия не привязана к покупателю");

    try {
        const readAt = new Date().toISOString();
        const updated = await db
            .update(notificationLogs)
            .set({
                metadata: sql`jsonb_set(coalesce(${notificationLogs.metadata}, '{}'::jsonb), '{readAt}', to_jsonb(${readAt}::text), true)`,
            })
            .where(
                and(
                    eq(notificationLogs.customerId, sess.customerId),
                    sql`(${notificationLogs.metadata} ->> 'readAt') is null`
                )
            )
            .returning({ id: notificationLogs.id });

        return ok({ markedCount: updated.length, readAt });
    } catch (error) {
        console.error("[/api/notifications/read-all] failed", error);
        return internal();
    }
}
