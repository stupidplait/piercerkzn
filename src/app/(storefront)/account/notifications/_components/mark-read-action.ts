"use server";

import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db, notificationLogs } from "@/db";

export async function markNotificationReadAction(
    notificationId: string
): Promise<{ ok: boolean; error?: string }> {
    const session = await auth();
    if (!session?.user?.customerId) {
        return { ok: false, error: "Не авторизован" };
    }

    const customerId = session.user.customerId;

    // Verify the notification belongs to this customer
    const [notif] = await db
        .select({ id: notificationLogs.id })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.id, notificationId),
                eq(notificationLogs.customerId, customerId)
            )
        )
        .limit(1);

    if (!notif) {
        return { ok: false, error: "Уведомление не найдено" };
    }

    // Mark as read by updating metadata
    await db
        .update(notificationLogs)
        .set({
            metadata: sql`COALESCE(${notificationLogs.metadata}, '{}'::jsonb) || '{"read": true}'::jsonb`,
        })
        .where(eq(notificationLogs.id, notificationId));

    revalidatePath("/account/notifications");
    revalidatePath("/account");

    return { ok: true };
}
