/**
 * Cookie-consent helper — single source of truth for the storefront's
 * analytics + session-replay opt-in state.
 *
 * The consent record lives in `localStorage` under `pkzn_consent_v1` so a
 * full re-prompt is one version bump away. There are intentionally **two**
 * orthogonal toggles:
 *
 *   - `analytics`  — autocapture + pageviews + web-vitals (PostHog product
 *                    analytics). Required for almost anything funnel-related.
 *   - `replay`     — session replay. Off by default even if `analytics` is
 *                    on, because replay records the DOM and is a much
 *                    stronger consent ask.
 *
 * The provider in `@/components/posthog-provider` subscribes to changes via
 * the `consentchange` custom event we dispatch on every `setConsent()` call.
 */

/** Storage key + version. Bump the suffix to force a fresh prompt. */
export const CONSENT_STORAGE_KEY = "pkzn_consent_v1";

/** DOM event name we dispatch on every consent mutation. */
export const CONSENT_EVENT = "pkzn:consentchange";

export interface ConsentState {
    /** User has interacted with the banner. False until then. */
    decided: boolean;
    /** Autocapture, pageviews, web vitals. */
    analytics: boolean;
    /** Session replay (DOM recording). Separate consent. */
    replay: boolean;
    /** Epoch ms timestamp of the last update. */
    updatedAt: number;
}

const DEFAULT_STATE: ConsentState = {
    decided: false,
    analytics: false,
    replay: false,
    updatedAt: 0,
};

function isBrowser(): boolean {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Read the current state synchronously. Returns defaults on the server. */
export function readConsent(): ConsentState {
    if (!isBrowser()) return DEFAULT_STATE;
    try {
        const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
        if (!raw) return DEFAULT_STATE;
        const parsed = JSON.parse(raw) as Partial<ConsentState>;
        return {
            decided: parsed.decided === true,
            analytics: parsed.analytics === true,
            replay: parsed.replay === true,
            updatedAt:
                typeof parsed.updatedAt === "number" && parsed.updatedAt >= 0
                    ? parsed.updatedAt
                    : 0,
        };
    } catch {
        return DEFAULT_STATE;
    }
}

/**
 * Persist a new consent state and notify listeners. Pass a partial — the
 * function merges with the existing state and always stamps `decided: true`
 * + a fresh `updatedAt`.
 */
export function setConsent(
    patch: Partial<Pick<ConsentState, "analytics" | "replay">>
): ConsentState {
    const prev = readConsent();
    const next: ConsentState = {
        decided: true,
        analytics: patch.analytics ?? prev.analytics,
        replay: patch.replay ?? prev.replay,
        updatedAt: Date.now(),
    };
    if (!isBrowser()) return next;
    try {
        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: next }));
    } catch {
        /* quota / SecurityError — ignore */
    }
    return next;
}

/**
 * Subscribe to consent changes. Returns an unsubscribe handle. Useful for
 * React components that don't already use the provider hook.
 */
export function subscribeConsent(listener: (state: ConsentState) => void): () => void {
    if (!isBrowser()) return () => {};
    const handler = (e: Event) => listener((e as CustomEvent<ConsentState>).detail);
    window.addEventListener(CONSENT_EVENT, handler);
    return () => window.removeEventListener(CONSENT_EVENT, handler);
}
