/**
 * Server-side captcha verification.
 *
 * Wraps the provider's `siteverify` HTTP call (hCaptcha or Cloudflare
 * Turnstile — both speak the same wire protocol) and returns a single
 * discriminated union, `CaptchaVerifyResult`, that route handlers can
 * pattern-match on.
 *
 * Design notes:
 *   - The token-shape short-circuit (`!token || token.length < 20`) and the
 *     disabled-provider short-circuit fire BEFORE any `fetch` call, so a
 *     malformed or missing token never costs a network round-trip.
 *   - The fetch call is wrapped in an `AbortController` whose timeout is
 *     `options.timeoutMs ?? env.CAPTCHA_VERIFY_TIMEOUT_MS ?? 5000`. Every
 *     failure mode (rejection, non-2xx, JSON parse failure, abort) maps to
 *     `{ ok: false, reason: "provider_unavailable" }`.
 *   - `interpretProviderResponse` is exported as a separate pure function
 *     (and `ERROR_CODE_MAP` alongside it) so property tests can drive the
 *     mapping table from Requirement 1 / Table A without touching `fetch`.
 *   - `options.fetchImpl` is a test seam that defaults to the global
 *     `fetch`. This keeps the production call identical to a plain
 *     `fetch(...)` while letting unit and property tests inject a stub.
 *
 * The dev-bypass (`CAPTCHA_DEV_BYPASS=1` in non-production) and hostname
 * cross-check (`CAPTCHA_EXPECTED_HOSTNAME`) are NOT applied here — they are
 * the route handler's concern, per design §7. The verifier simply reports
 * what the provider said.
 */
import { env } from "@/lib/env";

export type CaptchaProvider = "hcaptcha" | "turnstile";

export type CaptchaFailureReason =
    | "missing_token"
    | "invalid_token"
    | "expired_token"
    | "duplicate_token"
    | "hostname_mismatch"
    | "provider_unavailable"
    | "verifier_disabled";

export type CaptchaVerifyResult =
    | {
          ok: true;
          provider: CaptchaProvider;
          hostname?: string;
          action?: string;
      }
    | {
          ok: false;
          reason: CaptchaFailureReason;
      };

export interface VerifyOptions {
    /** Forwarded to the provider as the `remoteip` form field when set. */
    remoteIp?: string;
    /**
     * Expected `action` value (Turnstile only). Provided for forward
     * compatibility — the verifier currently passes this through to the
     * caller via the success-result `action` field rather than enforcing it
     * here, since enforcement is a per-route policy decision.
     */
    expectedAction?: string;
    /** Test seam — defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /**
     * Test seam — overrides `env.CAPTCHA_VERIFY_TIMEOUT_MS`. Falls back to
     * 5000 ms when neither is set.
     */
    timeoutMs?: number;
}

/**
 * Provider-specific siteverify endpoints. Both providers accept identical
 * request bodies and emit identical JSON shapes; only the URL differs.
 */
export const VERIFY_URLS: Record<CaptchaProvider, string> = {
    hcaptcha: "https://api.hcaptcha.com/siteverify",
    turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
};

/**
 * Provider error-code → CaptchaVerifyResult.reason mapping.
 *
 * Mirrors design Table A. Codes not present in this table fall through to
 * `"invalid_token"` (the catch-all per Req 1.4).
 */
export const ERROR_CODE_MAP: Readonly<Record<string, CaptchaFailureReason>> = Object.freeze({
    "missing-input-response": "missing_token",
    "missing-input-secret": "missing_token",
    "invalid-input-response": "invalid_token",
    "invalid-input-secret": "invalid_token",
    "bad-request": "invalid_token",
    "timeout-or-duplicate": "duplicate_token",
    "already-seen-response": "duplicate_token",
    "expired-input-response": "expired_token",
    "hostname-mismatch": "hostname_mismatch",
    "sitekey-secret-mismatch": "hostname_mismatch",
});

/**
 * Raw shape of the provider's siteverify JSON response. All fields except
 * `success` are optional / provider-specific.
 */
interface ProviderResponse {
    success?: unknown;
    "error-codes"?: unknown;
    hostname?: unknown;
    action?: unknown; // Turnstile only
    challenge_ts?: unknown;
}

/**
 * Verify a captcha token against the configured provider.
 *
 * Returns `{ ok: true, ... }` on a successful provider response and
 * `{ ok: false, reason }` for every failure mode. Never throws.
 */
export async function verifyCaptcha(
    token: string | undefined,
    options: VerifyOptions = {}
): Promise<CaptchaVerifyResult> {
    // (1) Disabled / unset provider — never call the network. Per Req 1.6 the
    //     route handler is responsible for the optional dev-bypass; the
    //     verifier itself just reports `verifier_disabled`.
    if (env.CAPTCHA_PROVIDER === "disabled") {
        return { ok: false, reason: "verifier_disabled" };
    }

    // (2) Token-shape short-circuit. Strict-equal `undefined`, empty string,
    //     and any string shorter than 20 chars all collapse to the same
    //     `missing_token` outcome — no `fetch` is issued (Req 1.2 / 3.1).
    if (!token || token.length < 20) {
        return { ok: false, reason: "missing_token" };
    }

    const provider = env.CAPTCHA_PROVIDER as CaptchaProvider;
    const secret = env.CAPTCHA_SECRET_KEY;

    // No secret configured? Treat the verifier as disabled. In production
    // the env loader rejects this state at startup; in dev/test we still
    // refuse to issue an unsigned siteverify call.
    if (!secret || secret.trim().length === 0) {
        return { ok: false, reason: "verifier_disabled" };
    }

    const timeoutMs = options.timeoutMs ?? env.CAPTCHA_VERIFY_TIMEOUT_MS ?? 5000;
    const fetchImpl = options.fetchImpl ?? fetch;

    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (options.remoteIp) {
        body.set("remoteip", options.remoteIp);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(VERIFY_URLS[provider], {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            signal: controller.signal,
        });
        if (!res.ok) {
            return { ok: false, reason: "provider_unavailable" };
        }
        const json = (await res.json()) as ProviderResponse;
        return interpretProviderResponse(json, provider);
    } catch {
        // Network rejection, abort, or JSON parse failure all collapse to
        // the same wire reason per Req 1.5.
        return { ok: false, reason: "provider_unavailable" };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Map a parsed provider JSON body into a `CaptchaVerifyResult`.
 *
 * Pure function — exported so property tests can drive the mapping table
 * (Property 2 / Property 3 in the design) without spinning up a fake
 * `fetch`.
 *
 * Defensive against arbitrary inputs:
 *   - `null`, non-objects → `{ ok: false, reason: "invalid_token" }`
 *   - `success === true` → `{ ok: true, ... }` (passes through `hostname`
 *     and `action` only when they are strings)
 *   - non-success → looks up the FIRST string entry of `error-codes` in
 *     `ERROR_CODE_MAP`; unknown / missing codes collapse to `"invalid_token"`.
 */
export function interpretProviderResponse(
    body: unknown,
    provider: CaptchaProvider
): CaptchaVerifyResult {
    if (!body || typeof body !== "object") {
        return { ok: false, reason: "invalid_token" };
    }
    const r = body as ProviderResponse;

    if (r.success === true) {
        return {
            ok: true,
            provider,
            hostname: typeof r.hostname === "string" ? r.hostname : undefined,
            action: typeof r.action === "string" ? r.action : undefined,
        };
    }

    const codes = Array.isArray(r["error-codes"]) ? r["error-codes"] : [];
    const firstCode = codes.find((c): c is string => typeof c === "string");
    if (!firstCode) {
        return { ok: false, reason: "invalid_token" };
    }
    return { ok: false, reason: ERROR_CODE_MAP[firstCode] ?? "invalid_token" };
}
