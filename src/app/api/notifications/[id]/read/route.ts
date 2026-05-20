/**
 * POST /api/notifications/[id]/read — mark a notification as read.
 *
 * Stores `readAt: <ISO>` inside the existing `metadata` jsonb so no schema
 * migration is needed. Idempotent: re-reading returns the same `readAt`.
 *
 * Ownership: the notification must belong to the authenticated customer.
 */
import { and, eq, sql } from "drizzle-orm";

import { forbidden, internal, notFound, ok, requireUser } from "@/lib/api";
import { db, notificationLogs } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;
    if (!sess.customerId) return forbidden("Сессия не привязана к покупателю");

    const { id } = await ctx.params;

    try {
        const [row] = await db
            .select({ id: notificationLogs.id, customerId: notificationLogs.customerId })
            .from(notificationLogs)
            .where(eq(notificationLogs.id, id))
            .limit(1);
        if (!row) return notFound("Уведомление не найдено");
        if (row.customerId !== sess.customerId) return forbidden("Это не ваше уведомление");

        const readAt = new Date().toISOString();
        const [updated] = await db
            .update(notificationLogs)
            .set({
                metadata: sql`jsonb_set(coalesce(${notificationLogs.metadata}, '{}'::jsonb), '{readAt}', to_jsonb(${readAt}::text), true)`,
            })
            .where(
                and(eq(notificationLogs.id, id), eq(notificationLogs.customerId, sess.customerId))
            )
            .returning({ id: notificationLogs.id, metadata: notificationLogs.metadata });

        const meta = (updated?.metadata ?? {}) as { readAt?: string };
        return ok({
            notification: { id: updated.id, readAt: meta.readAt ?? readAt },
        });
    } catch (error) {
        console.error("[/api/notifications/:id/read] failed", error);
        return internal();
    }
}
