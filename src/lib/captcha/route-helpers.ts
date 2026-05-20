/**
 * Per-route helpers shared by the public-form captcha gate.
 *
 * Two pieces both `POST /api/contact` and `POST /api/reservations` need:
 *
 *   - {@link isVerifyOk} — interprets a {@link CaptchaVerifyResult} as a
 *     pass / fail decision, applying the optional dev-bypass (Req 1.6 /
 *     1.7) and the hostname cross-check (Req 2.7 / 2.8). The verifier
 *     itself reports what the provider said; this helper folds the
 *     route-level policy on top.
 *   - {@link captchaRejection} — the canonical 422 response body for
 *     every captcha-failure outcome (Req 2.3 / 9.5). The user-facing
 *     `fields.captchaToken` string is the same Russian sentence for
 *     `missing_token`, `invalid_token`, `expired_token`,
 *     `duplicate_token`, `hostname_mismatch`, `provider_unavailable`,
 *     and `verifier_disabled`; the precise reason lives only in the
 *     structured log emitted by the route.
 *
 * Why a sibling file rather than `lib/api.ts`?
 *   - `lib/api.ts` is the generic HTTP envelope (`fail`/`ok`/`created`,
 *     auth helpers, rate-limit shortcut). Keeping captcha-specific glue
 *     out of it preserves that module's narrow responsibility and avoids
 *     pulling `lib/env.ts` and `lib/captcha/verify.ts` into every
 *     consumer of `lib/api.ts`.
 *   - Both route handlers import from `lib/captcha/*` already (for
 *     `verifyCaptcha`), so colocating the helpers under
 *     `lib/captcha/route-helpers.ts` keeps the import graph tight.
 */
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import type { CaptchaVerifyResult } from "@/lib/captcha/verify";

/**
 * `true` IFF the request should proceed past the captcha gate.
 *
 * Decision rules:
 *   - Verifier returned `ok: true`:
 *       - When `CAPTCHA_EXPECTED_HOSTNAME` is set and non-empty AND the
 *         provider returned a `hostname` AND the two differ → `false`
 *         (Req 2.7). The route caller then logs `reason: "hostname_mismatch"`.
 *       - Otherwise → `true`.
 *       - When `CAPTCHA_EXPECTED_HOSTNAME` is unset or empty, hostname
 *         matching is NOT enforced regardless of the provider's
 *         `hostname` value (Req 2.8).
 *   - Verifier returned `ok: false`:
 *       - When `CAPTCHA_PROVIDER === "disabled"` AND
 *         `CAPTCHA_DEV_BYPASS === "1"` AND `NODE_ENV !== "production"`
 *         the dev-bypass admits the request (Req 1.6). Production
 *         builds ignore the bypass even if it's set (Req 1.7).
 *       - Otherwise → `false`.
 */
export function isVerifyOk(r: CaptchaVerifyResult): boolean {
    if (!r.ok) {
        // Dev-bypass: only valid when the verifier is explicitly disabled
        // AND the bypass flag is set AND we are not in a production build.
        // Production deploys ignore CAPTCHA_DEV_BYPASS entirely (Req 1.7).
        return (
            env.CAPTCHA_PROVIDER === "disabled" &&
            env.CAPTCHA_DEV_BYPASS === "1" &&
            env.NODE_ENV !== "production"
        );
    }
    // Hostname cross-check (Req 2.7). Skipped when the env var is
    // unset / empty (Req 2.8).
    const expected = env.CAPTCHA_EXPECTED_HOSTNAME;
    if (expected && expected.trim().length > 0 && r.hostname && r.hostname !== expected) {
        return false;
    }
    return true;
}

/**
 * Public 422 response body emitted by every captcha rejection. Mirrors
 * the wire format from Requirement 2.3 verbatim — the `error` field is
 * a plain string code rather than the `{ code, message }` envelope used
 * by `fail()` from `lib/api.ts`, because the requirement specifies the
 * JSON body explicitly. The single localised string in
 * `fields.captchaToken` is the same regardless of the precise failure
 * reason; the reason lives only in the structured log line emitted by
 * the route (Req 9.5).
 */
export function captchaRejection(): NextResponse<{
    error: "validation_error";
    message: string;
    fields: { captchaToken: string };
}> {
    return NextResponse.json(
        {
            error: "validation_error" as const,
            message: "Не удалось подтвердить отправку формы.",
            fields: {
                captchaToken: "Проверка не пройдена, обновите страницу и попробуйте снова.",
            },
        },
        { status: 422 }
    );
}
