/**
 * `/reserve` interactive flow for the Telegram bot.
 *
 * Walks the customer through:
 *   browse_category → browse_product → browse_variant → confirm
 *
 * State lives in the `telegramBotUsers.botState` jsonb column via
 * `lib/telegram/fsm.ts`. Every callback handler in this module follows the
 * same recipe:
 *
 *   1. Parse the `rsv:*` payload via `parseReserve`. Unknown payload →
 *      `answerCallbackQuery({ text: "Неизвестная команда" })` and return.
 *   2. ALWAYS call `ctx.answerCallbackQuery()` first (Requirement 2.8) — no
 *      DB read, no message edit, no FSM write happens before the ack.
 *   3. Load current state and validate flow + step. Stale or wrong-flow
 *      state is ignored; the handler short-circuits with a clear/cancel.
 *   4. Compute the next state, write it via `saveBotState`, then re-render
 *      the matching keyboard via `editMessageText` (or `editMessageReplyMarkup`
 *      for in-place pagination).
 *
 * The flow has three entry points (Requirement 1):
 *   - `enter(ctx)`            — typed `/reserve` command (renders categories).
 *   - `enterFromDeepLink`     — `/start reserve_<variantId>` (jumps to confirm).
 *   - `handleCallback("rsv:start")` — inline button on the `/start` greeting,
 *     same destination as `enter` but edits the existing greeting message.
 *
 * Terminal step `confirm` calls `quickReserveForCustomer(customerId, variantId)`
 * which already fires `notifyReservationCreated` and the BullMQ expiry job;
 * we never duplicate either side effect here.
 *
 * Requirements covered: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6,
 * 2.7, 2.8, 11.2.
 */
import "server-only";

import type { Context as GrammyContext } from "grammy";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db, productCategories, productVariants, products, telegramBotUsers } from "@/db";

import { type BotStateReserve, clearBotState, loadBotState, saveBotState } from "../fsm";
import { quickReserveForCustomer } from "../quick-reserve";
import { parseReserve } from "./callback-data";
import {
    buildCategoryList,
    buildConfirmKeyboard,
    buildProductList,
    buildVariantList,
} from "./keyboards";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRODUCT_PAGE_SIZE = 10;

// Surface text — kept in one place so wording stays consistent across entry
// points and Russian copy reviews need to touch only this block.
const TXT_LINK_REQUIRED = "Привяжите чат к профилю на сайте.";
const TXT_NO_CATEGORIES = "Категории не настроены.";
const TXT_PICK_CATEGORY = "Выберите категорию";
const TXT_PICK_PRODUCT = "Выберите украшение";
const TXT_PICK_VARIANT = "Выберите вариант";
const TXT_VARIANT_UNAVAILABLE = "Это украшение недоступно.";
const TXT_CANCELLED = "Действие отменено.";
const TXT_CHAT_NOT_LINKED = "Чат не привязан";
const TXT_BACK_NOT_AVAILABLE = "Назад невозможен";
const TXT_UNKNOWN_PAGE = "На такой странице пусто";
const TXT_UNKNOWN_CALLBACK = "Неизвестная команда";
const TXT_GENERIC_ERROR = "Ошибка. Попробуйте позже.";
const TXT_CREATING_RESERVATION = "Создаю бронь…";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lookup the customer linked to this Telegram chat. Mirrors the helper in
 * `bot.ts` so flow modules don't have to import from there (the bot module
 * doesn't re-export it).
 */
async function findLinkedCustomerId(tgId: number): Promise<string | null> {
    const [row] = await db
        .select({ customerId: telegramBotUsers.customerId })
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.telegramId, tgId))
        .limit(1);
    return row?.customerId ?? null;
}

/** Format a kopeck amount as `"<rubles> ₽"` (no fractional rubles). */
function fmtRub(kopecks: number): string {
    return `${(kopecks / 100).toFixed(0)} ₽`;
}

/**
 * Pick a human-friendly label for a variant. Falls back to "Вариант" if
 * the row has no title (defensive — `title` is `notNull` in the schema).
 */
function variantLabel(v: { title: string | null; priceRub: number }): string {
    const base = v.title?.trim() ? v.title : "Вариант";
    return `${base} — ${fmtRub(v.priceRub)}`;
}

/** Body of the confirm summary, shared between deep-link and variant-tap entries. */
function buildConfirmBody(productTitle: string, variantTitle: string, priceRub: number): string {
    return [
        "<b>Подтверждение брони</b>",
        `Украшение: ${productTitle}`,
        `Вариант: ${variantTitle}`,
        `Цена: ${fmtRub(priceRub)}`,
        "",
        "Нажмите «Подтвердить» для бронирования.",
    ].join("\n");
}

/** Top-level published categories ordered by their sortOrder. */
async function loadTopCategories(): Promise<Array<{ id: string; name: string }>> {
    return db
        .select({ id: productCategories.id, name: productCategories.name })
        .from(productCategories)
        .where(and(isNull(productCategories.parentId), eq(productCategories.isActive, true)))
        .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
}

/** Published products in `categoryId` ordered by title (cap=200). */
async function loadProductsForCategory(
    categoryId: string
): Promise<Array<{ id: string; title: string }>> {
    return db
        .select({ id: products.id, title: products.title })
        .from(products)
        .where(and(eq(products.categoryId, categoryId), eq(products.status, "published")))
        .orderBy(asc(products.title))
        .limit(200);
}

/** All variants of a product ordered by price ascending then title. */
async function loadVariantsForProduct(
    productId: string
): Promise<Array<{ id: string; title: string; priceRub: number }>> {
    return db
        .select({
            id: productVariants.id,
            title: productVariants.title,
            priceRub: productVariants.priceRub,
        })
        .from(productVariants)
        .where(eq(productVariants.productId, productId))
        .orderBy(asc(productVariants.priceRub), asc(productVariants.title));
}

/**
 * Single SELECT joining `productVariants` + `products` for the confirm body.
 * Returns `null` if the variant doesn't exist (deleted between picker and
 * confirm tap, or supplied via a malformed deep-link).
 */
async function loadVariantSummary(variantId: string): Promise<{
    variantId: string;
    variantTitle: string;
    productTitle: string;
    priceRub: number;
} | null> {
    const [row] = await db
        .select({
            variantId: productVariants.id,
            variantTitle: productVariants.title,
            productTitle: products.title,
            priceRub: productVariants.priceRub,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(productVariants.id, variantId))
        .limit(1);
    return row ?? null;
}

/** Best-effort callback-query ack; never throws. */
async function safeAck(
    ctx: GrammyContext,
    opts?: { text?: string; show_alert?: boolean }
): Promise<void> {
    try {
        await ctx.answerCallbackQuery(opts);
    } catch (err) {
        console.error("[tg.reserve] answerCallbackQuery failed", err);
    }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * `/reserve` typed-command entry. Initialises state to
 * `{ flow: "reserve", step: "browse_category", data: {} }` and renders the
 * category keyboard. No-op when the chat is not linked to a customer.
 */
export async function enter(ctx: GrammyContext): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") return;

    try {
        const customerId = await findLinkedCustomerId(tgId);
        if (!customerId) {
            await ctx.reply(TXT_LINK_REQUIRED);
            return;
        }

        const categories = await loadTopCategories();
        if (categories.length === 0) {
            await ctx.reply(TXT_NO_CATEGORIES);
            return;
        }

        const next: BotStateReserve = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.reply(TXT_PICK_CATEGORY, {
            reply_markup: buildCategoryList(categories),
        });
    } catch (err) {
        console.error("[tg.reserve] enter failed", err);
        try {
            await ctx.reply(TXT_GENERIC_ERROR);
        } catch (replyErr) {
            console.error("[tg.reserve] enter reply failed", replyErr);
        }
    }
}

/**
 * `/start reserve_<variantId>` deep-link entry. Skips the picker steps and
 * lands directly at `confirm`. Requirement 1.3.
 */
export async function enterFromDeepLink(ctx: GrammyContext, variantId: string): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") return;

    try {
        const customerId = await findLinkedCustomerId(tgId);
        if (!customerId) {
            await ctx.reply(TXT_LINK_REQUIRED);
            return;
        }

        const summary = await loadVariantSummary(variantId);
        if (!summary) {
            await ctx.reply(TXT_VARIANT_UNAVAILABLE);
            return;
        }

        const next: BotStateReserve = {
            flow: "reserve",
            step: "confirm",
            data: { variantId: summary.variantId },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.reply(
            buildConfirmBody(summary.productTitle, summary.variantTitle, summary.priceRub),
            {
                parse_mode: "HTML",
                reply_markup: buildConfirmKeyboard("rsv"),
            }
        );
    } catch (err) {
        console.error("[tg.reserve] enterFromDeepLink failed", err);
        try {
            await ctx.reply(TXT_GENERIC_ERROR);
        } catch (replyErr) {
            console.error("[tg.reserve] enterFromDeepLink reply failed", replyErr);
        }
    }
}

// ---------------------------------------------------------------------------
// Callback dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a `rsv:*` inline-keyboard callback. The bot.ts dispatcher only
 * checks the prefix; this function owns everything inside the namespace.
 *
 * Always answers the callback query before any DB read or write
 * (Requirement 2.8). Wraps the body in try/catch and surfaces a generic
 * toast on failure rather than silently dropping the user.
 */
export async function handleCallback(ctx: GrammyContext, raw: string): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") {
        await safeAck(ctx, { text: TXT_GENERIC_ERROR });
        return;
    }

    const parsed = parseReserve(raw);
    if (!parsed) {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    try {
        switch (parsed.kind) {
            case "start":
                await handleStart(ctx, tgId);
                return;
            case "category":
                await handleCategory(ctx, tgId, parsed.categoryId);
                return;
            case "productPage":
                await handleProductPage(ctx, tgId, parsed.page);
                return;
            case "product":
                await handleProduct(ctx, tgId, parsed.productId);
                return;
            case "variant":
                await handleVariant(ctx, tgId, parsed.variantId);
                return;
            case "confirm":
                await handleConfirm(ctx, tgId);
                return;
            case "cancel":
                await handleCancel(ctx, tgId);
                return;
            case "back":
                await handleBack(ctx, tgId);
                return;
        }
    } catch (err) {
        console.error("[tg.reserve] handleCallback failed", { kind: parsed.kind, err });
        await safeAck(ctx, { text: TXT_GENERIC_ERROR, show_alert: true });
    }
}

// ---------------------------------------------------------------------------
// Per-action handlers
// ---------------------------------------------------------------------------

/**
 * Inline "Резерв украшения" greeting button → same destination as `enter`,
 * but we edit the greeting message in-place rather than send a new one.
 */
async function handleStart(ctx: GrammyContext, tgId: number): Promise<void> {
    await safeAck(ctx);
    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await ctx.reply(TXT_LINK_REQUIRED);
        return;
    }

    const categories = await loadTopCategories();
    if (categories.length === 0) {
        await ctx.reply(TXT_NO_CATEGORIES);
        return;
    }

    const next: BotStateReserve = {
        flow: "reserve",
        step: "browse_category",
        data: {},
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(TXT_PICK_CATEGORY, {
        reply_markup: buildCategoryList(categories),
    });
}

async function handleCategory(ctx: GrammyContext, tgId: number, categoryId: string): Promise<void> {
    await safeAck(ctx);
    const state = await loadBotState(tgId);
    if (state?.flow !== "reserve" || state.step !== "browse_category") {
        return;
    }

    const productList = await loadProductsForCategory(categoryId);
    const next: BotStateReserve = {
        flow: "reserve",
        step: "browse_product",
        data: { categoryId, page: 0 },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(TXT_PICK_PRODUCT, {
        parse_mode: "HTML",
        reply_markup: buildProductList(productList, 0, PRODUCT_PAGE_SIZE),
    });
}

async function handleProductPage(ctx: GrammyContext, tgId: number, page: number): Promise<void> {
    const state = await loadBotState(tgId);
    if (state?.flow !== "reserve" || state.step !== "browse_product" || !state.data.categoryId) {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    const productList = await loadProductsForCategory(state.data.categoryId);
    const totalPages = Math.max(1, Math.ceil(productList.length / PRODUCT_PAGE_SIZE));
    if (page < 0 || page >= totalPages) {
        await safeAck(ctx, { text: TXT_UNKNOWN_PAGE });
        return;
    }

    await safeAck(ctx);
    const next: BotStateReserve = {
        flow: "reserve",
        step: "browse_product",
        data: { categoryId: state.data.categoryId, page },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageReplyMarkup({
        reply_markup: buildProductList(productList, page, PRODUCT_PAGE_SIZE),
    });
}

async function handleProduct(ctx: GrammyContext, tgId: number, productId: string): Promise<void> {
    await safeAck(ctx);
    const state = await loadBotState(tgId);
    if (state?.flow !== "reserve" || state.step !== "browse_product" || !state.data.categoryId) {
        return;
    }

    const variants = await loadVariantsForProduct(productId);
    const next: BotStateReserve = {
        flow: "reserve",
        step: "browse_variant",
        data: {
            categoryId: state.data.categoryId,
            productId,
            page: state.data.page ?? 0,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(TXT_PICK_VARIANT, {
        parse_mode: "HTML",
        reply_markup: buildVariantList(variants.map((v) => ({ id: v.id, label: variantLabel(v) }))),
    });
}

async function handleVariant(ctx: GrammyContext, tgId: number, variantId: string): Promise<void> {
    await safeAck(ctx);
    const state = await loadBotState(tgId);
    if (state?.flow !== "reserve" || state.step !== "browse_variant") {
        return;
    }

    const summary = await loadVariantSummary(variantId);
    if (!summary) {
        await ctx.reply(TXT_VARIANT_UNAVAILABLE);
        return;
    }

    const next: BotStateReserve = {
        flow: "reserve",
        step: "confirm",
        data: {
            categoryId: state.data.categoryId,
            productId: state.data.productId,
            variantId: summary.variantId,
            page: state.data.page,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(
        buildConfirmBody(summary.productTitle, summary.variantTitle, summary.priceRub),
        {
            parse_mode: "HTML",
            reply_markup: buildConfirmKeyboard("rsv"),
        }
    );
}

async function handleConfirm(ctx: GrammyContext, tgId: number): Promise<void> {
    const state = await loadBotState(tgId);
    if (state?.flow !== "reserve" || state.step !== "confirm" || !state.data.variantId) {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await safeAck(ctx, { text: TXT_CHAT_NOT_LINKED, show_alert: true });
        await clearBotState(tgId);
        return;
    }

    await safeAck(ctx, { text: TXT_CREATING_RESERVATION });
    const outcome = await quickReserveForCustomer(customerId, state.data.variantId);
    await clearBotState(tgId);

    if (outcome.ok) {
        await ctx.reply(`✓ Бронь создана. ${outcome.referenceNumber} — ${outcome.productTitle}`);
    } else {
        await ctx.reply(outcome.message);
    }
}

async function handleCancel(ctx: GrammyContext, tgId: number): Promise<void> {
    await safeAck(ctx);
    await clearBotState(tgId);
    try {
        await ctx.editMessageText(TXT_CANCELLED);
    } catch (err) {
        // Some edit failures (e.g. message not modified) aren't fatal — fall
        // back to a fresh reply so the user still sees the cancellation.
        console.error("[tg.reserve] cancel editMessageText failed", err);
        await ctx.reply(TXT_CANCELLED);
    }
}

async function handleBack(ctx: GrammyContext, tgId: number): Promise<void> {
    const state = await loadBotState(tgId);
    if (state?.flow !== "reserve") {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    if (state.step === "browse_product") {
        await safeAck(ctx);
        const categories = await loadTopCategories();
        const next: BotStateReserve = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(TXT_PICK_CATEGORY, {
            reply_markup: buildCategoryList(categories),
        });
        return;
    }

    if (state.step === "browse_variant") {
        const categoryId = state.data.categoryId;
        if (!categoryId) {
            await safeAck(ctx, { text: TXT_BACK_NOT_AVAILABLE });
            return;
        }
        await safeAck(ctx);
        const productList = await loadProductsForCategory(categoryId);
        const page = state.data.page ?? 0;
        const next: BotStateReserve = {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId, page },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(TXT_PICK_PRODUCT, {
            parse_mode: "HTML",
            reply_markup: buildProductList(productList, page, PRODUCT_PAGE_SIZE),
        });
        return;
    }

    if (state.step === "confirm") {
        // Deep-link confirm has only `variantId` in data — no productId or
        // categoryId to navigate back to. The button is hidden on that path
        // by `buildConfirmKeyboard`, but a stale message could still fire
        // it; we politely refuse.
        const { categoryId, productId } = state.data;
        if (!categoryId || !productId) {
            await safeAck(ctx, { text: TXT_BACK_NOT_AVAILABLE });
            return;
        }
        await safeAck(ctx);
        const variants = await loadVariantsForProduct(productId);
        const next: BotStateReserve = {
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId, productId, page: state.data.page },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(TXT_PICK_VARIANT, {
            parse_mode: "HTML",
            reply_markup: buildVariantList(
                variants.map((v) => ({ id: v.id, label: variantLabel(v) }))
            ),
        });
        return;
    }

    // browse_category has nowhere to back-navigate to.
    await safeAck(ctx, { text: TXT_BACK_NOT_AVAILABLE });
}
