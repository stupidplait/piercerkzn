/**
 * PostHog server-side capture singleton.
 *
 * Server-side capture is reserved for events the browser cannot reliably
 * emit: reservation expiry (worker-driven), bot interactions, email events
 * forwarded by Resend webhooks. Most product analytics still fire from the
 * client via `posthog-js` (configured separately in app/providers.tsx —
 * not part of Phase 4).
 *
 * Behavior in dev: if `POSTHOG_API_KEY` is missing, capture() is a no-op
 * so handlers don't crash on missing config.
 */
import "server-only";

import { PostHog } from "posthog-node";

declare global {
    var __posthog: PostHog | null | undefined;
}

function createPostHog(): PostHog | null {
    // Server-side capture uses the project API key (the same key as the
    // public NEXT_PUBLIC_POSTHOG_KEY — PostHog has a single ingest key).
    const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com";
    if (!key) return null;
    return new PostHog(key, {
        host,
        flushAt: 20,
        flushInterval: 10_000,
    });
}

export const posthog: PostHog | null =
    globalThis.__posthog ?? (globalThis.__posthog = createPostHog());

export interface CaptureParams {
    event: string;
    distinctId: string; // customer.id, telegram_bot_user.id, or "anon:<ip-hash>"
    properties?: Record<string, unknown>;
    groups?: Record<string, string>;
    /**
     * Active session-replay id (PostHog `$session_id`). When the caller
     * passes it, the server event lands on the same recording as the
     * client-side capture. Typically read from the `x-posthog-session-id`
     * request header via `getPostHogSessionId(headers)`.
     */
    sessionId?: string;
}

export function capture(params: CaptureParams): void {
    if (!posthog) return;
    const properties = params.sessionId
        ? { ...(params.properties ?? {}), $session_id: params.sessionId }
        : params.properties;
    posthog.capture({
        event: params.event,
        distinctId: params.distinctId,
        properties,
        groups: params.groups,
    });
}

/**
 * Extract the client's PostHog session id from a request's headers.
 * The browser-side provider stamps every same-origin fetch with
 * `x-posthog-session-id`; route handlers and server actions can call this
 * to forward the id into `capture({ sessionId })`.
 *
 * Returns `null` when the header is missing or empty.
 */
export function getPostHogSessionId(
    headers: Headers | Record<string, string | undefined>
): string | null {
    const raw =
        headers instanceof Headers
            ? headers.get("x-posthog-session-id")
            : headers["x-posthog-session-id"];
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Defensive: PostHog session ids are short UUID-ish strings. Cap the
    // value so a malicious client can't push 10MB through this header.
    return trimmed.slice(0, 64);
}

/**
 * Call from long-running scripts (e.g. workers) on shutdown to flush the
 * in-memory queue. Vercel function handlers should use `waitUntil(flush())`
 * or rely on `await posthog.shutdown()` if they need synchronous delivery.
 */
export async function flush(): Promise<void> {
    if (!posthog) return;
    await posthog.flush();
}
