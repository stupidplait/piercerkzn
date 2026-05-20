/**
 * Telegram bot finite-state machine persistence layer.
 *
 * Owns every read and write of `telegram_bot_user.bot_state` from the bot
 * layer. Flow modules (`flows/reserve.ts`, `flows/book.ts`) never touch the
 * column directly — they go through `loadBotState`, `saveBotState`,
 * `clearBotState`, or the `withFsm` convenience wrapper.
 *
 * Stale states (`updatedAt` older than `STALE_TTL_MS`) are silently cleared on
 * the next read so abandoned flows do not leak between sessions. The legacy
 * `'{}'` default value (which lacks a `flow` key) decodes as `null`.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db, telegramBotUsers } from "@/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotStateBase {
    /** ISO 8601 UTC, e.g. "2025-05-16T14:32:01.000Z". */
    updatedAt: string;
}

export interface BotStateReserve extends BotStateBase {
    flow: "reserve";
    step: "browse_category" | "browse_product" | "browse_variant" | "confirm";
    data: {
        categoryId?: string;
        productId?: string;
        variantId?: string;
        page?: number;
    };
}

export interface BotStateBook extends BotStateBase {
    flow: "book";
    step: "select_service" | "select_date" | "select_time" | "collect_contact" | "confirm";
    data: {
        serviceId?: string;
        durationMin?: number;
        /** YYYY-MM-DD */
        date?: string;
        /** HH:mm */
        time?: string;
        page?: number;
        missing?: Array<"email" | "phone">;
        /**
         * Cached list of bookable ISO dates computed at `select_service` exit.
         * Re-used by `select_time` and the `back` transition from `select_time`
         * → `select_date` so the picker re-renders without re-querying.
         */
        dates?: string[];
    };
}

export type BotState = BotStateReserve | BotStateBook;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 30 minutes — abandoned flows older than this are cleared on the next read. */
export const STALE_TTL_MS = 30 * 60 * 1000;

const RESERVE_STEPS: ReadonlySet<BotStateReserve["step"]> = new Set([
    "browse_category",
    "browse_product",
    "browse_variant",
    "confirm",
]);

const BOOK_STEPS: ReadonlySet<BotStateBook["step"]> = new Set([
    "select_service",
    "select_date",
    "select_time",
    "collect_contact",
    "confirm",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the state's `updatedAt` is more than `STALE_TTL_MS` older
 * than `now`. Unparseable timestamps are treated as stale.
 */
export function isStale(state: Pick<BotState, "updatedAt">, now: number = Date.now()): boolean {
    const ts = Date.parse(state.updatedAt);
    if (Number.isNaN(ts)) return true;
    return now - ts > STALE_TTL_MS;
}

/**
 * Defensively decode a raw jsonb value into a `BotState`. Returns `null` when
 * the shape does not match either flow variant — including the historical
 * `'{}'` default which lacks a `flow` key.
 */
export function parseBotState(raw: unknown): BotState | null {
    if (raw === null || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;

    const flow = obj.flow;
    const step = obj.step;
    const updatedAt = obj.updatedAt;
    const data = obj.data;

    if (typeof updatedAt !== "string") return null;
    if (typeof step !== "string") return null;
    if (data === null || typeof data !== "object") return null;

    if (flow === "reserve") {
        if (!RESERVE_STEPS.has(step as BotStateReserve["step"])) return null;
        return {
            flow: "reserve",
            step: step as BotStateReserve["step"],
            data: data as BotStateReserve["data"],
            updatedAt,
        };
    }

    if (flow === "book") {
        if (!BOOK_STEPS.has(step as BotStateBook["step"])) return null;
        return {
            flow: "book",
            step: step as BotStateBook["step"],
            data: data as BotStateBook["data"],
            updatedAt,
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/**
 * Read and parse the current bot state for a Telegram user. Returns `null`
 * when the row is missing, the column is null, the payload is malformed, or
 * the state is stale (in which case the row is best-effort cleared).
 */
export async function loadBotState(tgId: number): Promise<BotState | null> {
    const [row] = await db
        .select({ botState: telegramBotUsers.botState })
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.telegramId, tgId))
        .limit(1);

    if (!row) return null;

    const parsed = parseBotState(row.botState);
    if (!parsed) return null;

    if (isStale(parsed)) {
        try {
            await clearBotState(tgId);
        } catch (err) {
            console.error("[fsm] stale clear failed", err);
        }
        return null;
    }

    return parsed;
}

/**
 * Stamp `state.updatedAt = now` and persist it to the user's row. Assumes the
 * row already exists (every Telegram interaction passes through
 * `upsertTelegramUser` first).
 */
export async function saveBotState(tgId: number, state: BotState): Promise<void> {
    const stamped: BotState = { ...state, updatedAt: new Date().toISOString() };
    await db
        .update(telegramBotUsers)
        .set({ botState: stamped })
        .where(eq(telegramBotUsers.telegramId, tgId));
}

/** Set the user's `bot_state` column back to `null`. */
export async function clearBotState(tgId: number): Promise<void> {
    await db
        .update(telegramBotUsers)
        .set({ botState: null })
        .where(eq(telegramBotUsers.telegramId, tgId));
}

// ---------------------------------------------------------------------------
// withFsm helper
// ---------------------------------------------------------------------------

type GrammyContextLike = {
    from?: { id?: number };
};

export type FsmHandler<C extends GrammyContextLike = GrammyContextLike> = (
    state: BotState | null,
    ctx: C
) => Promise<BotState | null>;

/**
 * Load the current state, run the handler, then persist the returned next
 * state (or clear when the handler returns `null`). No-op when the update
 * carries no `from.id` (channel posts, etc.).
 */
export async function withFsm<C extends GrammyContextLike>(
    ctx: C,
    handler: FsmHandler<C>
): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") return;

    const state = await loadBotState(tgId);
    const next = await handler(state, ctx);

    if (next === null) {
        await clearBotState(tgId);
    } else {
        await saveBotState(tgId, next);
    }
}
