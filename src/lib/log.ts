/**
 * Structured logger for security-relevant events.
 *
 * Emits a single line of JSON per call to either `console.info` or
 * `console.warn` per the `LEVEL_FOR` map. Failures are swallowed: if
 * serialization throws (e.g., circular `fields`) or `console` is broken,
 * the function still resolves cleanly and never propagates an error to
 * the caller. This means a misbehaving observability pipeline cannot
 * crash the request that triggered it (Req 9.6).
 *
 * Edge-runtime safe by construction: no `server-only`, no Node-only APIs.
 * Consumed by `lib/cors.ts`, which runs in `middleware.ts`.
 */

export type SecurityEvent =
    | "captcha_verified"
    | "captcha_rejected"
    | "captcha_disabled_dev_bypass"
    | "rate_limit_denied"
    | "cors_denied"
    | "cors_malformed_origin";

export interface SecurityLogFields {
    route: string;
    ip: string;
    userId?: string;
    reason?: string;
    retryAfterMs?: number;
    origin?: string;
    captchaTokenPrefix?: string;
}

const LEVEL_FOR: Record<SecurityEvent, "info" | "warn"> = {
    captcha_verified: "info",
    captcha_rejected: "info",
    captcha_disabled_dev_bypass: "warn",
    rate_limit_denied: "info",
    cors_denied: "info",
    cors_malformed_origin: "warn",
};

/**
 * Emit a single structured JSON line for a security event.
 *
 * Never throws. On serializer failure or a broken console, falls back to
 * `console.error("[observability] log emit failed: <msg>")` (also wrapped
 * in a try/catch so even a totally broken `console` cannot crash the
 * request).
 */
export async function logSecurityEvent(
    event: SecurityEvent,
    fields: SecurityLogFields
): Promise<void> {
    try {
        const level = LEVEL_FOR[event];
        const line = JSON.stringify({
            event,
            level,
            ...fields,
            ts: new Date().toISOString(),
        });
        if (level === "warn") {
            console.warn(line);
        } else {
            console.info(line);
        }
    } catch (err) {
        try {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[observability] log emit failed: ${message}`);
        } catch {
            /* swallow — broken console cannot crash the request */
        }
    }
}
