/**
 * /visualizer route segment layout.
 *
 * Detects Mini-App context via the existing `isTelegramMiniApp` helper
 * and:
 *   - Inside the Mini App, applies the Telegram theme bridge class,
 *     hides the cookie consent banner via the scoped CSS rule, and
 *     stamps the sticky `pkzn_tgmini=1` cookie so sub-navigations and
 *     refreshes keep the layout flag.
 *   - Outside the Mini App, renders a thin "← На сайт" header so a
 *     direct browser visit to `/visualizer` is not a dead end.
 *
 * The cookie banner suppression is layout-scoped via the
 * `[data-mini="1"] [data-pkzn-consent]` rule in the theme CSS module —
 * we don't have to remount or unmount the banner to hide it.
 *
 * Requirements: 1.2, 1.3, 1.4, 2.2, 2.3, 8.2, 8.3
 */
import { cookies } from "next/headers";
import Link from "next/link";

import {
    buildTgMiniCookieAttrs,
    isTelegramMiniApp,
    TG_MINI_QUERY_PARAM,
} from "@/lib/telegram/mini-app";

import styles from "@/components/visualizer/telegram-theme.module.css";

// Next 16 ships a strict `LayoutProps` validator that compares the
// component's argument type against the segment-aware `LayoutProps<R>`
// generic. A custom interface with a `searchParams: Promise<...>` field
// fails that comparison because `LayoutProps<R>` does NOT include
// `searchParams` for layout segments — only pages get search params,
// per the Next.js routing convention. Read `searchParams` here instead
// via `next/headers` so the layout signature stays clean.
import { headers } from "next/headers";

export default async function VisualizerLayout({ children }: { children: React.ReactNode }) {
    // Recover the search params from the incoming URL via the request
    // headers — Next.js does not pass `searchParams` to layouts, but
    // the `x-invoke-path` / referer / next-url headers carry the URL
    // we can parse for the `?tgmini=1` flag. Falling back to the
    // standard URL() parser keeps the helper resilient if the header
    // shape changes between Next minor versions.
    const h = await headers();
    const urlHeader =
        h.get("x-invoke-path") ??
        h.get("next-url") ??
        h.get("x-url") ??
        h.get("referer") ??
        "/visualizer";
    let params: Record<string, string | string[] | undefined> = {};
    try {
        const u = new URL(urlHeader, "http://localhost");
        params = Object.fromEntries(u.searchParams.entries());
    } catch {
        // Header missing or malformed — proceed with empty params.
    }

    const isMini = await isTelegramMiniApp(params);

    // Stamp the sticky cookie when entered fresh via `?tgmini=1`. We only
    // set it on explicit query entry — the cookie's job is to keep the
    // flag across sub-navigations after the first iframe load, not to
    // promote any future visit into a Mini-App context.
    const tgminiQuery = params[TG_MINI_QUERY_PARAM];
    const enteredFresh =
        tgminiQuery === "1" ||
        tgminiQuery === "true" ||
        (Array.isArray(tgminiQuery) && (tgminiQuery[0] === "1" || tgminiQuery[0] === "true"));

    if (enteredFresh) {
        try {
            const c = await cookies();
            const attrs = buildTgMiniCookieAttrs();
            c.set(attrs.name, attrs.value, {
                maxAge: attrs.maxAge,
                httpOnly: attrs.httpOnly,
                sameSite: attrs.sameSite,
                secure: attrs.secure,
                path: attrs.path,
            });
        } catch {
            // `cookies()` throws outside a fully-wired request scope (e.g.
            // certain test setups). Ignore — detection still works via
            // the query param within the same request.
        }
    }

    return (
        <div data-mini={isMini ? "1" : "0"} className={isMini ? styles.telegramThemed : undefined}>
            {!isMini && (
                <header
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.75rem 1.25rem",
                        borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
                        fontSize: "0.95rem",
                    }}
                >
                    <Link href="/" style={{ textDecoration: "none" }}>
                        ← На сайт
                    </Link>
                    <span style={{ fontWeight: 600 }}>3D-примерка</span>
                    <span style={{ width: "5rem" }} aria-hidden="true" />
                </header>
            )}
            {children}
        </div>
    );
}
