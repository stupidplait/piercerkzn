/**
 * Telegram Mini-App context helpers.
 *
 * The Mini-App entry point is `/visualizer?tgmini=1`, launched from a
 * BotFather menu button. When the page is rendered inside the Telegram
 * WebApp iframe we strip the public-site chrome (header, footer, theme
 * toggle) and let Telegram's own UI handle the shell.
 *
 * Detection priority:
 *   1. `?tgmini=1` query param — the canonical signal, set by the menu
 *      button URL we register via `scripts/setup-telegram-menu.ts`.
 *   2. `tgmini` cookie — sticky once the first request lands, so
 *      sub-navigations and refreshes keep the layout flag without needing
 *      the query string everywhere.
 *
 * Used by route components / layouts:
 *
 *     const tgmini = isTelegramMiniApp(searchParams);
 *     <Layout chrome={tgmini ? "minimal" : "full"}>…</Layout>
 *
 * `MINI_APP_VISUALIZER_PATH` is the single source of truth for the URL
 * path consumed by both the bot `/visualizer` command (in
 * `lib/telegram/bot.ts`) and the chat-menu-button setup script (in
 * `scripts/setup-telegram-menu.ts`).
 *
 * Pure / framework-free — safe to import from any RSC or server action.
 */
import "server-only";

import { cookies } from "next/headers";

export const TG_MINI_QUERY_PARAM = "tgmini";
export const TG_MINI_COOKIE = "pkzn_tgmini";
export const MINI_APP_VISUALIZER_PATH = "/visualizer?tgmini=1";

/**
 * Inspect a request's search params and return `true` when the caller is
 * inside the Telegram Mini-App iframe. Reads `?tgmini=1` first and falls
 * back to a sticky cookie (set on the entry navigation).
 */
export async function isTelegramMiniApp(
    searchParams: URLSearchParams | Record<string, string | string[] | undefined>
): Promise<boolean> {
    const fromQuery = readTgMiniFromParams(searchParams);
    if (fromQuery === true) return true;
    if (fromQuery === false) return false; // explicit `?tgmini=0` overrides cookie

    try {
        const store = await cookies();
        return store.get(TG_MINI_COOKIE)?.value === "1";
    } catch {
        // `cookies()` throws outside a request scope; treat as "no flag".
        return false;
    }
}

/**
 * Sync variant for cases where the cookie store is unavailable (e.g.
 * tests, static helpers). Only inspects the query parameters.
 */
export function isTelegramMiniAppFromParams(
    searchParams: URLSearchParams | Record<string, string | string[] | undefined>
): boolean {
    return readTgMiniFromParams(searchParams) === true;
}

function readTgMiniFromParams(
    searchParams: URLSearchParams | Record<string, string | string[] | undefined>
): boolean | null {
    const raw =
        searchParams instanceof URLSearchParams
            ? searchParams.get(TG_MINI_QUERY_PARAM)
            : Array.isArray(searchParams[TG_MINI_QUERY_PARAM])
              ? (searchParams[TG_MINI_QUERY_PARAM] as string[])[0]
              : (searchParams[TG_MINI_QUERY_PARAM] as string | undefined);
    if (raw === undefined || raw === null) return null;
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return null;
}

/**
 * Cookie attributes for stamping `pkzn_tgmini=1` once the iframe has
 * entered. 1-hour TTL — long enough to survive deep links inside the
 * Mini-App, short enough that a stale cookie can't break the normal site
 * if the user opens the same browser outside Telegram.
 */
export function buildTgMiniCookieAttrs(): {
    name: string;
    value: string;
    maxAge: number;
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
    path: string;
} {
    return {
        name: TG_MINI_COOKIE,
        value: "1",
        maxAge: 60 * 60, // 1 hour
        httpOnly: false, // client-side libs may want to read it
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    };
}
