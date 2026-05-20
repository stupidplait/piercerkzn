"use client";

/**
 * Cloudflare Turnstile widget renderer — shared across every public
 * form that needs server-side captcha verification (`/contact`,
 * any future reservation UI, and so on). Callers pass an `action`
 * label that the verifier echoes back as `expectedAction`, plus an
 * `onToken` callback that receives the issued token (or `""` on
 * expiry / error / dev fallback).
 *
 * Reads `NEXT_PUBLIC_CAPTCHA_PROVIDER` and `NEXT_PUBLIC_CAPTCHA_SITE_KEY`
 * at module bundle time and renders accordingly:
 *
 *   - `"turnstile"`: loads Cloudflare's `api.js` (once, globally) and uses
 *     the explicit render API to mount the widget into the component's
 *     own container. The widget's success callback feeds the token back
 *     to the parent via `onToken`. Expiry / error callbacks reset the
 *     token to `""` so the parent disables submit again.
 *
 *   - `"disabled"` (and any value besides `"turnstile"`): renders a
 *     hidden `<input>` whose default value is a fixed dev-bypass
 *     placeholder of length ≥ 20 (so the server-side Zod
 *     `captchaToken: z.string().min(20)` check passes). The server still
 *     refuses unless `CAPTCHA_DEV_BYPASS=1` and `NODE_ENV !== "production"`.
 *     This keeps local dev usable without a live site key.
 *
 * The hCaptcha branch is intentionally not wired here — the design picks
 * Turnstile as the default and the verifier is provider-agnostic, so a
 * future hCaptcha variant only adds a sibling branch.
 */
import { useCallback, useEffect, useId, useRef } from "react";

const TURNSTILE_SCRIPT_SRC =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";

/**
 * Length-≥20 sentinel value used in dev when the captcha provider is
 * `"disabled"`. Matches the public-form Zod schemas
 * (`contactInquirySchema.captchaToken.min(20)` and
 * `createReservationSchema.captchaToken.min(20)`) so the request passes
 * Zod parsing; the server's `CAPTCHA_DEV_BYPASS` flag then
 * decides whether to admit the submission.
 */
export const DEV_BYPASS_TOKEN = "dev-bypass-placeholder-token-0001";

interface TurnstileApi {
    render: (
        container: HTMLElement,
        params: {
            sitekey: string;
            action?: string;
            callback?: (token: string) => void;
            "error-callback"?: () => void;
            "expired-callback"?: () => void;
            theme?: "light" | "dark" | "auto";
        }
    ) => string;
    reset: (widgetId?: string) => void;
    remove: (widgetId?: string) => void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

/** Promise-based singleton script loader so multiple widgets share one tag. */
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("turnstile: server-side render"));
    }
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
        const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
        const tag = existing ?? document.createElement("script");
        if (!existing) {
            tag.id = TURNSTILE_SCRIPT_ID;
            tag.src = TURNSTILE_SCRIPT_SRC;
            tag.async = true;
            tag.defer = true;
        }
        const onReady = () => {
            if (window.turnstile) resolve(window.turnstile);
            else reject(new Error("turnstile: api.js loaded but window.turnstile is missing"));
        };
        tag.addEventListener("load", onReady, { once: true });
        tag.addEventListener(
            "error",
            () => {
                scriptPromise = null;
                reject(new Error("turnstile: failed to load api.js"));
            },
            { once: true }
        );
        if (!existing) document.head.appendChild(tag);
        // If the script was already loaded before we attached the handler,
        // the global will be present synchronously.
        if (window.turnstile) onReady();
    });
    return scriptPromise;
}

export interface TurnstileWidgetProps {
    /** Logical action name reported to Turnstile and echoed back to the verifier. */
    action?: string;
    /** Called whenever a fresh token is issued, expires, or errors. */
    onToken: (token: string) => void;
}

export function TurnstileWidget({ action, onToken }: TurnstileWidgetProps): React.ReactElement {
    const provider = process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER;
    const siteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY;
    const isProduction = process.env.NODE_ENV === "production";

    const inputName = "captchaToken";
    const fallbackId = useId();

    // ---------------------------------------------------------------
    // Disabled / fallback branch — render a hidden input with a
    // length-≥20 placeholder so local dev does not require a live key.
    // The server-side bypass flag (CAPTCHA_DEV_BYPASS) still gates
    // whether the request is admitted; in production this branch
    // produces a token the verifier will reject with
    // `verifier_disabled`, surfacing as the standard 422 envelope.
    // ---------------------------------------------------------------
    const renderFallback = useCallback(() => {
        // Push the placeholder into parent state once on mount so the
        // submit button can enable immediately.
        onToken(DEV_BYPASS_TOKEN);
    }, [onToken]);

    const widgetIdRef = useRef<string | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (provider !== "turnstile" || !siteKey) {
            renderFallback();
            return;
        }
        if (!containerRef.current) return;
        const container = containerRef.current;
        let cancelled = false;

        loadTurnstileScript()
            .then((api) => {
                if (cancelled || !containerRef.current) return;
                widgetIdRef.current = api.render(container, {
                    sitekey: siteKey,
                    action,
                    callback: (token) => onToken(token),
                    "error-callback": () => onToken(""),
                    "expired-callback": () => onToken(""),
                    theme: "auto",
                });
            })
            .catch(() => {
                // Surface as an empty token so the parent can display a
                // generic error and disable submit. We do NOT fall back to
                // the dev-bypass token here — a script-load failure is a
                // legitimate condition that should block submission.
                if (!cancelled) onToken("");
            });

        return () => {
            cancelled = true;
            const api = window.turnstile;
            if (api && widgetIdRef.current) {
                try {
                    api.remove(widgetIdRef.current);
                } catch {
                    /* widget may already be gone */
                }
                widgetIdRef.current = null;
            }
        };
    }, [provider, siteKey, action, onToken, renderFallback]);

    if (provider !== "turnstile" || !siteKey) {
        // No-op render in dev: keep an unfocusable hidden input around so
        // any non-JS / no-script fallback still has the field name in the
        // DOM. The actual token value is propagated via onToken (state).
        if (isProduction) {
            // In production with a missing/disabled provider we still
            // render an empty hidden input — the server will reject the
            // submission with verifier_disabled and the user will see the
            // localized rejection message from `fields.captchaToken`.
            return (
                <input id={fallbackId} type="hidden" name={inputName} defaultValue="" aria-hidden />
            );
        }
        return (
            <input
                id={fallbackId}
                type="hidden"
                name={inputName}
                defaultValue={DEV_BYPASS_TOKEN}
                aria-hidden
            />
        );
    }

    return <div ref={containerRef} data-testid="turnstile-widget" />;
}
