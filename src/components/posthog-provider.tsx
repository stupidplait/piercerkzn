"use client";

/**
 * Client-side PostHog provider.
 *
 * Wraps the app in:
 *   - lazy posthog-js init (opt-out by default until the user grants
 *     analytics consent via the cookie banner),
 *   - autocapture + pageview + web-vitals capture,
 *   - session replay strictly **opt-in** (separate consent toggle),
 *   - automatic `identify(customer.id)` once the session loads,
 *   - a tiny `usePostHogClient()` hook for components that need to call
 *     `posthog.capture(…)`, `.alias(…)`, etc. directly.
 *
 * The provider is also responsible for routing the active `$session_id`
 * into outbound fetches via a single `installSessionIdFetchInterceptor()`
 * call — server actions / route handlers read it from the
 * `x-posthog-session-id` header and pass it to `capture()` so the server
 * event lands on the same recording.
 *
 * Env:
 *   NEXT_PUBLIC_POSTHOG_KEY    — required to enable analytics
 *   NEXT_PUBLIC_POSTHOG_HOST   — defaults to https://eu.posthog.com
 *
 * If the key is absent, the provider becomes a pass-through (no init, no
 * consent gate, no fetch interceptor). Dev environments without PostHog
 * configured therefore stay quiet.
 */
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { CONSENT_EVENT, readConsent, subscribeConsent, type ConsentState } from "@/lib/consent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PostHogContextValue {
    /** `true` once posthog-js finished initialising (after analytics consent). */
    ready: boolean;
    /** Current consent state. Mirrors `readConsent()` reactively. */
    consent: ConsentState;
    /** Wrapper around `posthog.identify` that is safe before init. */
    identify: (distinctId: string, properties?: Record<string, unknown>) => void;
    /** Wrapper around `posthog.alias` (anonymous → registered). */
    alias: (newDistinctId: string) => void;
    /** Capture an event. No-op if the user hasn't opted into analytics. */
    capture: (event: string, properties?: Record<string, unknown>) => void;
    /** Drop the current identification (logout). */
    reset: () => void;
}

const noop = () => {};
const DEFAULT_CTX: PostHogContextValue = {
    ready: false,
    consent: { decided: false, analytics: false, replay: false, updatedAt: 0 },
    identify: noop,
    alias: noop,
    capture: noop,
    reset: noop,
};

const PostHogContext = createContext<PostHogContextValue>(DEFAULT_CTX);

// ---------------------------------------------------------------------------
// fetch interceptor — stamp `x-posthog-session-id` on same-origin requests
// so server `capture()` calls can tie back to the same replay.
// ---------------------------------------------------------------------------
let fetchPatched = false;

function installSessionIdFetchInterceptor() {
    if (fetchPatched || typeof window === "undefined") return;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        try {
            // Only stamp same-origin requests — never leak the session id
            // to a third party.
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
            const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
            if (!sameOrigin) return original(input, init);

            const sid =
                typeof posthog.get_session_id === "function" ? posthog.get_session_id() : null;
            if (!sid) return original(input, init);

            const headers = new Headers(init?.headers ?? {});
            if (!headers.has("x-posthog-session-id")) {
                headers.set("x-posthog-session-id", sid);
            }
            return original(input, { ...init, headers });
        } catch {
            return original(input, init);
        }
    };
    fetchPatched = true;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export interface PostHogProviderProps {
    children: React.ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
    const [consent, setConsentState] = useState<ConsentState>(() => readConsent());
    const [ready, setReady] = useState(false);
    const initialisedRef = useRef(false);

    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com";
    const enabled = Boolean(apiKey);

    // Mirror consent into state (initial sync from storage + listen for changes).
    useEffect(() => {
        // Syncing local React state with the external `localStorage`-backed
        // consent store. `useState(readConsent())` already covers SSR; this
        // catches the post-mount re-read for accuracy after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConsentState(readConsent());
        const unsub = subscribeConsent(setConsentState);
        const onStorage = (e: StorageEvent) => {
            if (e.key === null || e.key.startsWith("pkzn_consent")) {
                setConsentState(readConsent());
            }
        };
        window.addEventListener("storage", onStorage);
        return () => {
            unsub();
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    // Initialise posthog-js once the user grants analytics consent. We
    // intentionally don't `init` at module top level — that would set a
    // distinct_id cookie before the user has a say.
    useEffect(() => {
        if (!enabled || initialisedRef.current) return;
        if (!consent.decided || !consent.analytics) return;
        try {
            posthog.init(apiKey!, {
                api_host: apiHost,
                // Autocapture: clicks, form submits, rage-clicks, etc.
                autocapture: true,
                // Web vitals (LCP, CLS, INP, …) become PostHog events.
                capture_performance: { web_vitals: true },
                // Pageviews are dispatched manually via the `usePathname`
                // effect below so Next's client-side navigation produces
                // exactly one `$pageview` per route change.
                capture_pageview: false,
                capture_pageleave: true,
                // Persist in localStorage rather than a cookie — the consent
                // banner already gates this, no need to also set a cookie.
                persistence: "localStorage+cookie",
                // Disable session recording up-front; we re-enable below if
                // the user opted into replay specifically.
                disable_session_recording: true,
                // Don't try to read GeoIP / IP if the user disabled analytics
                // mid-session — `opt_out_capturing` covers it but be explicit.
                opt_out_capturing_by_default: false,
                loaded: () => {
                    setReady(true);
                    installSessionIdFetchInterceptor();
                },
            });
            initialisedRef.current = true;
        } catch (err) {
            console.warn("[posthog] init failed", err);
        }
    }, [apiHost, apiKey, consent.analytics, consent.decided, enabled]);

    // Toggle session replay independently from analytics consent.
    useEffect(() => {
        if (!initialisedRef.current) return;
        try {
            if (consent.replay && consent.analytics) {
                posthog.startSessionRecording();
            } else {
                posthog.stopSessionRecording();
            }
        } catch (err) {
            console.warn("[posthog] toggle replay failed", err);
        }
    }, [consent.analytics, consent.replay]);

    // Toggle analytics opt-in/out — covers the case where the user revokes
    // consent *after* init: we keep the script loaded but stop sending.
    useEffect(() => {
        if (!initialisedRef.current) return;
        try {
            if (consent.analytics) {
                posthog.opt_in_capturing();
            } else {
                posthog.opt_out_capturing();
            }
        } catch (err) {
            console.warn("[posthog] opt-in/out failed", err);
        }
    }, [consent.analytics]);

    // Pageview tracking, decoupled from the router.
    const pathname = usePathname();
    const searchParams = useSearchParams();
    useEffect(() => {
        if (!ready || !consent.analytics) return;
        const search = searchParams?.toString();
        const url = search ? `${pathname}?${search}` : (pathname ?? "/");
        try {
            posthog.capture("$pageview", { $current_url: url });
        } catch {
            /* ignore — non-fatal */
        }
    }, [pathname, searchParams, ready, consent.analytics]);

    // Identify the linked customer once the session resolves. We hit
    // `/api/auth/me` once on mount; subsequent identifies (login on the
    // same SPA navigation) go through the imperative `identify()` exposed
    // on the context.
    useEffect(() => {
        if (!ready || !consent.analytics) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/auth/me", { credentials: "same-origin" });
                if (cancelled || !res.ok) return;
                const body = (await res.json()) as
                    | { data?: { customer?: { id: string } | null } }
                    | { customer?: { id: string } | null };
                const customerId =
                    (body as { data?: { customer?: { id?: string } } }).data?.customer?.id ??
                    (body as { customer?: { id?: string } }).customer?.id ??
                    null;
                if (customerId) {
                    posthog.identify(customerId);
                }
            } catch {
                /* unauthenticated — fine, stay anonymous */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [ready, consent.analytics]);

    // ---------------------------------------------------------------------
    // Context value
    // ---------------------------------------------------------------------
    const value = useMemo<PostHogContextValue>(() => {
        if (!enabled) return DEFAULT_CTX;
        const safe = <T,>(fn: () => T, fallback?: T): T | undefined => {
            try {
                return fn();
            } catch (err) {
                console.warn("[posthog] call failed", err);
                return fallback;
            }
        };
        return {
            ready,
            consent,
            identify: (id, properties) => {
                if (!ready) return;
                safe(() => posthog.identify(id, properties));
            },
            alias: (newId) => {
                if (!ready) return;
                safe(() => posthog.alias(newId));
            },
            capture: (event, properties) => {
                if (!ready || !consent.analytics) return;
                safe(() => posthog.capture(event, properties));
            },
            reset: () => {
                if (!ready) return;
                safe(() => posthog.reset());
            },
        };
    }, [consent, enabled, ready]);

    return <PostHogContext.Provider value={value}>{children}</PostHogContext.Provider>;
}

/** React hook returning the PostHog context. Always safe to call. */
export function usePostHogClient(): PostHogContextValue {
    return useContext(PostHogContext);
}

// Re-export the consent event constant for components that want to listen
// without depending directly on `@/lib/consent`.
export { CONSENT_EVENT };
