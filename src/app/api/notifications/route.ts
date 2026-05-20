/**
 * GET /api/notifications — current customer's notification inbox.
 *
 * Storage strategy: we don't keep a separate "in-app inbox" table — every
 * outbound notification (email / SMS / push / Telegram) already lands in
 * `notification_log`. The "read" flag is recorded in the existing `metadata`
 * jsonb (`metadata.readAt`), so no migration is needed.
 *
 * Filters:
 *   - `channel`     email | sms | push | telegram
 *   - `unreadOnly`  hide rows where metadata.readAt is set
 */
import { and, desc, eq, sql } from "drizzle-orm";

import { forbidden, internal, ok, parseQuery, requireUser } from "@/lib/api";
import { db, notificationLogs } from "@/db";
import { listNotificationsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;
    if (!ctx.customerId) return forbidden("Сессия не привязана к покупателю");

    const url = new URL(req.url);
    const parsed = parseQuery(url, listNotificationsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(notificationLogs.customerId, ctx.customerId)];
        if (q.channel) filters.push(eq(notificationLogs.channel, q.channel));
        if (q.unreadOnly) {
            // metadata.readAt absent or null
            filters.push(sql`(${notificationLogs.metadata} ->> 'readAt') is null`);
        }
        const where = and(...filters);

        const rows = await db
            .select({
                id: notificationLogs.id,
                channel: notificationLogs.channel,
                type: notificationLogs.type,
                subject: notificationLogs.subject,
                contentPreview: notificationLogs.contentPreview,
                status: notificationLogs.status,
                sentAt: notificationLogs.sentAt,
                metadata: notificationLogs.metadata,
            })
            .from(notificationLogs)
            .where(where)
            .orderBy(desc(notificationLogs.sentAt))
            .limit(q.limit)
            .offset(q.offset);

        const [totalRow, unreadRow] = await Promise.all([
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(notificationLogs)
                .where(where)
                .then((r) => r[0]),
            db
                .select({ unread: sql<number>`count(*)::int` })
                .from(notificationLogs)
                .where(
                    and(
                        eq(notificationLogs.customerId, ctx.customerId),
                        sql`(${notificationLogs.metadata} ->> 'readAt') is null`
                    )
                )
                .then((r) => r[0]),
        ]);

        return ok({
            notifications: rows.map((r) => {
                const meta = (r.metadata ?? {}) as { readAt?: string };
                return {
                    id: r.id,
                    channel: r.channel,
                    type: r.type,
                    subject: r.subject,
                    contentPreview: r.contentPreview,
                    status: r.status,
                    sentAt: r.sentAt,
                    readAt: meta.readAt ?? null,
                };
            }),
            count: rows.length,
            total: totalRow.total,
            unreadCount: unreadRow.unread,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/notifications GET] failed", error);
        return internal();
    }
}
