/**
 * GET /api/admin/notifications/log — delivery log across all channels.
 *
 * Filters: `channel`, `type`, `customerId`, `status`, `from`, `to`.
 */
import { and, between, desc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { db, notificationLogs } from "@/db";
import { listAdminNotificationLogQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAdminNotificationLogQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.channel) filters.push(eq(notificationLogs.channel, q.channel));
        if (q.type) filters.push(eq(notificationLogs.type, q.type));
        if (q.customerId) filters.push(eq(notificationLogs.customerId, q.customerId));
        if (q.status) filters.push(eq(notificationLogs.status, q.status));
        if (q.from && q.to) {
            filters.push(
                between(notificationLogs.sentAt, new Date(q.from), new Date(`${q.to}T23:59:59Z`))
            );
        } else if (q.from) {
            filters.push(sql`${notificationLogs.sentAt} >= ${new Date(q.from)}`);
        } else if (q.to) {
            filters.push(sql`${notificationLogs.sentAt} <= ${new Date(`${q.to}T23:59:59Z`)}`);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db
            .select({
                id: notificationLogs.id,
                customerId: notificationLogs.customerId,
                channel: notificationLogs.channel,
                type: notificationLogs.type,
                recipient: notificationLogs.recipient,
                subject: notificationLogs.subject,
                status: notificationLogs.status,
                providerId: notificationLogs.providerId,
                sentAt: notificationLogs.sentAt,
            })
            .from(notificationLogs);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(desc(notificationLogs.sentAt))
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(notificationLogs);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            logs: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/notifications/log] failed", error);
        return internal();
    }
}
