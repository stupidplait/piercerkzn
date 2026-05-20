/**
 * grammY Bot singleton + command / callback handlers.
 *
 * The bot lives entirely as a Next.js webhook (`/api/tg`); there is no
 * separate process. Incoming updates from Telegram POST to that route,
 * which calls `bot.handleUpdate(update)`.
 *
 * Commands:
 *   /start [<deep-link payload>]
 *       - `customer_<UUID>` — link this chat to that customer record.
 *       - `reserve_<variantId>` — link (if known) and quick-reserve.
 *   /my_reservations    — list active reservations + inline keyboard
 *   /my_appointments    — list upcoming/recent appointments
 *   /help               — show available commands
 *
 * Callback queries (inline keyboard):
 *   cancel_res:<reservationId> — customer-initiated reservation cancel
 *   reserve:<variantId>        — single-variant quick reservation
 *
 * Production env:
 *   TELEGRAM_BOT_TOKEN          — from @BotFather
 *   TELEGRAM_BOT_WEBHOOK_SECRET — random; verifies incoming webhook calls
 *   NEXT_PUBLIC_SITE_URL        — used for deep links back to the site
 */
import "server-only";

import { Bot, InlineKeyboard } from "grammy";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { appointments, customers, db, reservations, telegramBotUsers } from "@/db";
import { cancelReservation } from "@/lib/reservations";
import { quickReserveForCustomer } from "./quick-reserve";
import * as Reserve from "./flows/reserve";
import * as Book from "./flows/book";
import { clearBotState, loadBotState } from "./fsm";
import { MINI_APP_VISUALIZER_PATH } from "./mini-app";

// ---------------------------------------------------------------------------
// Russian copy — Mini-App / `/visualizer` command (exported for tests)
// ---------------------------------------------------------------------------
export const TXT_BOT_VISUALIZER_PROMPT = "🎨 Откройте 3D-примерку прямо в Telegram";
export const TXT_BOT_VISUALIZER_BUTTON = "🎨 Открыть 3D-примерку";
export const TXT_BOT_VISUALIZER_NOT_CONFIGURED = "Mini App пока не настроен. Попробуйте позже.";
export const TXT_BOT_HELP_VISUALIZER_LINE = "/visualizer — открыть 3D-примерку";

declare global {
    var __tgBot: Bot | undefined;
}

// ---------------------------------------------------------------------------
// Callback action prefixes
// ---------------------------------------------------------------------------
const CB_CANCEL_RES = "cancel_res:";
const CB_RESERVE = "reserve:";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function siteOrigin(): string {
    const v = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.AUTH_URL;
    return (v ?? "https://piercerkzn.ru").replace(/\/$/u, "");
}

function fmtDateTimeUtc(d: Date): string {
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function fmtRub(kopecks: number): string {
    return `${(kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}\u00A0₽`;
}

async function findLinkedCustomerId(tgId: number): Promise<string | null> {
    const [row] = await db
        .select({ customerId: telegramBotUsers.customerId })
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.telegramId, tgId))
        .limit(1);
    return row?.customerId ?? null;
}

/**
 * Ensure a telegram_bot_user row exists for this chat. Updates profile
 * fields + `lastInteractionAt` on every interaction. Returns the linked
 * `customerId` (if any).
 */
async function upsertTelegramUser(
    tgId: number,
    profile: {
        username?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        languageCode?: string | null;
    },
    /** When provided, links the chat to this customer if not already linked. */
    pendingCustomerId: string | null = null
): Promise<string | null> {
    const [existing] = await db
        .select()
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.telegramId, tgId))
        .limit(1);

    if (existing) {
        const nextCustomerId = existing.customerId ?? pendingCustomerId;
        await db
            .update(telegramBotUsers)
            .set({
                telegramUsername: profile.username ?? null,
                firstName: profile.firstName ?? null,
                lastName: profile.lastName ?? null,
                languageCode: profile.languageCode ?? "ru",
                customerId: nextCustomerId,
                lastInteractionAt: new Date(),
            })
            .where(eq(telegramBotUsers.id, existing.id));
        return nextCustomerId;
    }

    await db.insert(telegramBotUsers).values({
        telegramId: tgId,
        telegramUsername: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        languageCode: profile.languageCode ?? "ru",
        customerId: pendingCustomerId,
        lastInteractionAt: new Date(),
    });
    return pendingCustomerId;
}

function createBot(): Bot {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        throw new Error("TELEGRAM_BOT_TOKEN is not set. See .env.example.");
    }
    const b = new Bot(token);

    // -------------------------------------------------------------------
    // /start — register chat, optional deep-link payload:
    //   customer_<UUID>     → link to customer
    //   reserve_<variantId> → link (if known) + quick-reserve immediately
    // -------------------------------------------------------------------
    b.command("start", async (ctx) => {
        const tgId = ctx.from?.id;
        if (!tgId) return;
        const startParam = ctx.match?.toString().trim() || undefined;

        let pendingCustomerId: string | null = null;
        let pendingReserveVariantId: string | null = null;

        if (startParam?.startsWith("customer_")) {
            const candidate = startParam.slice("customer_".length);
            const [c] = await db
                .select({ id: customers.id })
                .from(customers)
                .where(eq(customers.id, candidate))
                .limit(1);
            if (c) pendingCustomerId = c.id;
        } else if (startParam?.startsWith("reserve_")) {
            pendingReserveVariantId = startParam.slice("reserve_".length);
        }

        const customerId = await upsertTelegramUser(
            tgId,
            {
                username: ctx.from?.username ?? null,
                firstName: ctx.from?.first_name ?? null,
                lastName: ctx.from?.last_name ?? null,
                languageCode: ctx.from?.language_code ?? "ru",
            },
            pendingCustomerId
        );

        if (pendingReserveVariantId) {
            if (!customerId) {
                await ctx.reply(
                    "Чтобы бронировать прямо из бота, привяжите чат к профилю на сайте."
                );
                return;
            }
            await Reserve.enterFromDeepLink(ctx, pendingReserveVariantId);
            return;
        }

        const greeting = customerId
            ? "Чат привязан к вашему профилю. Я буду присылать сюда подтверждения броней и напоминания о записях."
            : "Здравствуйте. Это бот PiercerKZN. Здесь вы будете получать подтверждения броней и напоминания о визите.";
        const greetingKb = new InlineKeyboard()
            .text("Записаться", "bk:start")
            .row()
            .text("Резерв украшения", "rsv:start");
        await ctx.reply(greeting, { reply_markup: greetingKb });
    });

    // -------------------------------------------------------------------
    // /my_reservations — list pending/confirmed reservations + inline kb
    // -------------------------------------------------------------------
    b.command("my_reservations", async (ctx) => {
        const tgId = ctx.from?.id;
        if (!tgId) return;
        const customerId = await findLinkedCustomerId(tgId);
        if (!customerId) {
            await ctx.reply(
                "Чат не привязан к профилю. Откройте бронь на сайте — придёт сообщение с кнопкой подтверждения."
            );
            return;
        }
        const rows = await db
            .select({
                id: reservations.id,
                referenceNumber: reservations.referenceNumber,
                status: reservations.status,
                expiresAt: reservations.expiresAt,
                total: reservations.total,
            })
            .from(reservations)
            .where(
                and(
                    eq(reservations.customerId, customerId),
                    inArray(reservations.status, ["pending", "confirmed"])
                )
            )
            .orderBy(desc(reservations.createdAt))
            .limit(10);

        if (rows.length === 0) {
            await ctx.reply("Активных броней нет.");
            return;
        }

        for (const r of rows) {
            const kb = new InlineKeyboard()
                .url("Открыть на сайте", `${siteOrigin()}/account/reservations/${r.id}`)
                .text("Отменить", `${CB_CANCEL_RES}${r.id}`);
            const text =
                `<b>${r.referenceNumber}</b>\n` +
                `Статус: ${r.status}\n` +
                `Срок до: ${fmtDateTimeUtc(r.expiresAt)}\n` +
                `Сумма: ${fmtRub(r.total)}`;
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }
    });

    // -------------------------------------------------------------------
    // /my_appointments — mirrors /my_reservations against appointments
    // -------------------------------------------------------------------
    b.command("my_appointments", async (ctx) => {
        const tgId = ctx.from?.id;
        if (!tgId) return;
        const customerId = await findLinkedCustomerId(tgId);
        if (!customerId) {
            await ctx.reply(
                "Чат не привязан к профилю. Запишитесь на сайте и получите ссылку для привязки."
            );
            return;
        }

        // Upcoming (date >= today) + non-cancelled, plus the most recent 3
        // historical rows so a returning customer sees something even when
        // they have no future bookings. We do this as a single ORDERed
        // SELECT and trim client-side to keep the query simple.
        const today = new Date().toISOString().slice(0, 10);
        const rows = await db
            .select({
                id: appointments.id,
                referenceNumber: appointments.referenceNumber,
                status: appointments.status,
                date: appointments.date,
                timeStart: appointments.timeStart,
                timeEnd: appointments.timeEnd,
                estimatedTotal: appointments.estimatedTotal,
            })
            .from(appointments)
            .where(
                and(
                    eq(appointments.customerId, customerId),
                    or(
                        gte(appointments.date, today),
                        // Always include "very recent" rows so the response is
                        // not empty just because the next visit is tomorrow.
                        sql`${appointments.date} >= (CURRENT_DATE - INTERVAL '30 days')`
                    )
                )
            )
            .orderBy(desc(appointments.date), desc(appointments.timeStart))
            .limit(10);

        if (rows.length === 0) {
            await ctx.reply("Записей нет. Запишитесь на сайте.");
            return;
        }

        const lines = rows.map((r) => {
            const priceLabel =
                typeof r.estimatedTotal === "number" && r.estimatedTotal > 0
                    ? ` · ${fmtRub(r.estimatedTotal)}`
                    : "";
            return (
                `• <b>${r.referenceNumber}</b> — ${r.status}\n` +
                `   ${r.date}, ${r.timeStart}—${r.timeEnd} МСК${priceLabel}`
            );
        });
        const kb = new InlineKeyboard().url("Все записи", `${siteOrigin()}/account/appointments`);
        await ctx.reply(`<b>Ваши записи</b>\n${lines.join("\n")}`, {
            parse_mode: "HTML",
            reply_markup: kb,
        });
    });

    // -------------------------------------------------------------------
    // /help
    // -------------------------------------------------------------------
    b.command("help", async (ctx) => {
        await ctx.reply(
            [
                "Команды:",
                "/start — привязать чат к профилю",
                "/my_reservations — мои брони",
                "/my_appointments — мои записи на пирсинг",
                "/notify_off — отключить рассылки",
                "/notify_on — включить рассылки",
                "/reserve — резерв украшения",
                "/book — запись на пирсинг",
                TXT_BOT_HELP_VISUALIZER_LINE,
                "/cancel — отменить текущее действие",
                "/help — эта подсказка",
            ].join("\n")
        );
    });

    // -------------------------------------------------------------------
    // /visualizer — open the 3D-try-on Mini App via WebApp inline keyboard
    // -------------------------------------------------------------------
    b.command("visualizer", async (ctx) => {
        const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/u, "");
        if (!origin || !origin.startsWith("https://")) {
            await ctx.reply(TXT_BOT_VISUALIZER_NOT_CONFIGURED);
            return;
        }
        const url = `${origin}${MINI_APP_VISUALIZER_PATH}`;
        const kb = new InlineKeyboard().webApp(TXT_BOT_VISUALIZER_BUTTON, url);
        await ctx.reply(TXT_BOT_VISUALIZER_PROMPT, { reply_markup: kb });
    });

    // -------------------------------------------------------------------
    // /reserve, /book, /cancel — interactive flows (rsv: / bk: namespaces)
    // -------------------------------------------------------------------
    b.command("reserve", async (ctx) => {
        await Reserve.enter(ctx);
    });

    b.command("book", async (ctx) => {
        await Book.enter(ctx);
    });

    b.command("cancel", async (ctx) => {
        const tgId = ctx.from?.id;
        if (typeof tgId !== "number") return;
        await clearBotState(tgId);
        await ctx.reply("Действие отменено.");
    });

    // -------------------------------------------------------------------
    // /notify_off, /notify_on — self-service broadcast opt-out toggles
    // -------------------------------------------------------------------
    b.command("notify_off", async (ctx) => {
        const tgId = ctx.from?.id;
        if (typeof tgId !== "number") return;

        const [row] = await db
            .select({ id: telegramBotUsers.id })
            .from(telegramBotUsers)
            .where(eq(telegramBotUsers.telegramId, tgId))
            .limit(1);
        if (!row) {
            await ctx.reply("Чтобы управлять уведомлениями, сначала отправьте /start.");
            return;
        }
        await db
            .update(telegramBotUsers)
            .set({ notificationsEnabled: false, lastInteractionAt: new Date() })
            .where(eq(telegramBotUsers.id, row.id));
        await ctx.reply("Уведомления отключены. Включить обратно — /notify_on");
    });

    b.command("notify_on", async (ctx) => {
        const tgId = ctx.from?.id;
        if (typeof tgId !== "number") return;

        const [row] = await db
            .select({ id: telegramBotUsers.id })
            .from(telegramBotUsers)
            .where(eq(telegramBotUsers.telegramId, tgId))
            .limit(1);
        if (!row) {
            await ctx.reply("Чтобы управлять уведомлениями, сначала отправьте /start.");
            return;
        }
        await db
            .update(telegramBotUsers)
            .set({ notificationsEnabled: true, lastInteractionAt: new Date() })
            .where(eq(telegramBotUsers.id, row.id));
        await ctx.reply("Уведомления включены. Отключить — /notify_off");
    });

    // -------------------------------------------------------------------
    // Callback queries — inline keyboard actions
    // -------------------------------------------------------------------
    b.on("callback_query:data", async (ctx) => {
        const tgId = ctx.from?.id;
        const data = ctx.callbackQuery.data ?? "";
        if (!tgId) {
            await ctx.answerCallbackQuery("Сессия не распознана").catch(() => {});
            return;
        }

        try {
            if (data.startsWith("rsv:")) {
                await Reserve.handleCallback(ctx, data);
                return;
            }
            if (data.startsWith("bk:")) {
                await Book.handleCallback(ctx, data);
                return;
            }

            if (data.startsWith(CB_CANCEL_RES)) {
                const reservationId = data.slice(CB_CANCEL_RES.length);
                const customerId = await findLinkedCustomerId(tgId);
                if (!customerId) {
                    await ctx.answerCallbackQuery({
                        text: "Чат не привязан к профилю.",
                        show_alert: true,
                    });
                    return;
                }

                // Ownership guard — never let one chat cancel another chat's
                // reservation by spoofing a callback payload.
                const [owner] = await db
                    .select({ customerId: reservations.customerId })
                    .from(reservations)
                    .where(eq(reservations.id, reservationId))
                    .limit(1);
                if (!owner || owner.customerId !== customerId) {
                    await ctx.answerCallbackQuery({
                        text: "Эта бронь не принадлежит вам.",
                        show_alert: true,
                    });
                    return;
                }

                const updated = await cancelReservation(reservationId, {
                    actor: "customer",
                    reason: "Отмена из Telegram",
                });
                if (!updated) {
                    await ctx.answerCallbackQuery({
                        text: "Бронь не найдена.",
                        show_alert: true,
                    });
                    return;
                }
                await ctx.answerCallbackQuery({ text: "Бронь отменена" });
                await ctx.reply(
                    `Бронь <b>${updated.referenceNumber}</b> отменена. Украшение возвращено в продажу.`,
                    { parse_mode: "HTML" }
                );
                return;
            }

            if (data.startsWith(CB_RESERVE)) {
                const variantId = data.slice(CB_RESERVE.length);
                const customerId = await findLinkedCustomerId(tgId);
                if (!customerId) {
                    await ctx.answerCallbackQuery({
                        text: "Чат не привязан к профилю.",
                        show_alert: true,
                    });
                    return;
                }
                await ctx.answerCallbackQuery({ text: "Создаю бронь…" });
                const outcome = await quickReserveForCustomer(customerId, variantId);
                if (outcome.ok) {
                    await ctx.reply(
                        `<b>Бронь создана</b>\n${outcome.referenceNumber} — ${outcome.productTitle}\nПодробности придут отдельным сообщением.`,
                        { parse_mode: "HTML" }
                    );
                } else {
                    await ctx.reply(outcome.message);
                }
                return;
            }

            await ctx.answerCallbackQuery({ text: "Неизвестная команда" });
        } catch (err) {
            console.error("[tg.callback] failed", err);
            await ctx
                .answerCallbackQuery({ text: "Ошибка. Попробуйте позже.", show_alert: true })
                .catch(() => {});
        }
    });

    // -------------------------------------------------------------------
    // Contact + text messages — only forwarded to the book flow when the
    // FSM is parked at `collect_contact`. Commands are handled by their
    // own dispatchers; we additionally guard against `/`-prefixed text.
    // -------------------------------------------------------------------
    b.on("message:contact", async (ctx) => {
        const tgId = ctx.from?.id;
        if (typeof tgId !== "number") return;
        const state = await loadBotState(tgId);
        if (state?.flow === "book" && state.step === "collect_contact") {
            await Book.handleContactMessage(ctx);
        }
    });

    b.on("message:text", async (ctx) => {
        const tgId = ctx.from?.id;
        if (typeof tgId !== "number") return;
        const text = ctx.message.text;
        if (text.startsWith("/")) return; // commands are dispatched separately
        const state = await loadBotState(tgId);
        if (state?.flow === "book" && state.step === "collect_contact") {
            await Book.handleTextMessage(ctx);
        }
    });

    return b;
}

/** Lazily-instantiated grammY Bot. Hot-reload safe in dev. */
export function getBot(): Bot {
    if (globalThis.__tgBot) return globalThis.__tgBot;
    const b = createBot();
    if (process.env.NODE_ENV !== "production") globalThis.__tgBot = b;
    return b;
}

/**
 * Initialize the bot's grammy state (loads bot info from Telegram) — must
 * be called once before `handleUpdate`. Safe to call multiple times.
 */
export async function ensureBotInitialised(): Promise<Bot> {
    const b = getBot();
    if (!b.isInited()) await b.init();
    return b;
}

// Re-export the callback prefixes so other modules can build matching
// keyboards without hard-coding strings.
export { CB_CANCEL_RES, CB_RESERVE };
