/**
 * /api/telegram/mini-app/verify
 *
 *   POST { initData: string } → exchange a Telegram WebApp `initData` payload
 *   for the linked `telegramBotUsers` row.
 *
 * The route is the canonical way for the Mini-App `/visualizer` page to
 * answer "which bot user opened me, and is it linked to a customer?". It
 * relies on `verifyInitData` (HMAC-SHA256 over the bot token, see
 * `lib/telegram/mini-app-auth.ts`) for cryptographic authenticity, then
 * looks up the matching row by `telegramId`.
 *
 * Status mapping:
 *   - 200 { telegramBotUser: { id, telegramId, customerId, displayName, notificationsEnabled } }
 *     ─ verified caller, bot user row found.
 *   - 200 { telegramBotUser: null }
 *     ─ verified caller, but the user has not yet `/start`-ed the bot. The
 *       page falls back to anonymous-Mini mode in this branch.
 *   - 401 { error: "invalid_init_data", reason }
 *     ─ HMAC mismatch, missing fields, or stale `auth_date` (>24h).
 *   - 422 (via `parseJson`)
 *     ─ Body shape rejected by zod.
 *   - 503 { error: "mini_app_not_configured" }
 *     ─ `TELEGRAM_BOT_TOKEN` not set in this environment.
 *   - 429
 *     ─ Rate limited by the shared "auth" bucket.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.4
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, telegramBotUsers } from "@/db";
import { applyRateLimit, fail, internal, ok, parseJson } from "@/lib/api";
import { verifyInitData } from "@/lib/telegram/mini-app-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
    initData: z.string().min(1).max(4096),
});

interface TelegramBotUserDTO {
    id: string;
    telegramId: string; // serialized as string for JSON safety (bigint)
    customerId: string | null;
    displayName: string | null;
    notificationsEnabled: boolean;
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response!;
    const { initData } = parsed.data!;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        return fail("mini_app_not_configured", "Mini App не настроен", {
            status: 503,
        });
    }

    const result = verifyInitData(initData, botToken);
    if (!result.ok) {
        return fail("invalid_init_data", "Не удалось проверить подпись Telegram", {
            status: 401,
            details: { reason: result.reason },
        });
    }

    const userId = result.data.user?.id;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
        return fail("invalid_init_data", "Не удалось проверить подпись Telegram", {
            status: 401,
            details: { reason: "missing_user" },
        });
    }

    try {
        const [row] = await db
            .select({
                id: telegramBotUsers.id,
                telegramId: telegramBotUsers.telegramId,
                customerId: telegramBotUsers.customerId,
                firstName: telegramBotUsers.firstName,
                lastName: telegramBotUsers.lastName,
                telegramUsername: telegramBotUsers.telegramUsername,
                notificationsEnabled: telegramBotUsers.notificationsEnabled,
            })
            .from(telegramBotUsers)
            .where(eq(telegramBotUsers.telegramId, userId))
            .limit(1);

        if (!row) {
            return ok({ telegramBotUser: null });
        }

        const displayName =
            [row.firstName, row.lastName].filter(Boolean).join(" ").trim() ||
            row.telegramUsername ||
            null;

        const dto: TelegramBotUserDTO = {
            id: row.id,
            telegramId: String(row.telegramId),
            customerId: row.customerId ?? null,
            displayName,
            notificationsEnabled: row.notificationsEnabled ?? true,
        };

        return ok({ telegramBotUser: dto });
    } catch (error) {
        console.error("[/api/telegram/mini-app/verify] failed", error);
        return internal();
    }
}
