/**
 * POST /api/contact — public contact-form endpoint.
 *
 * Pipeline (per design §7):
 *   1. `decideCors(req)`                — classify the request against the
 *      CORS allowlist; the resulting decision is applied to EVERY
 *      response (rejections, 429, success) so allowed origins receive
 *      `ACAO`/`Vary` and denied origins do not.
 *   2. `applyRateLimit(req, "contact")` — per-IP + (when authenticated)
 *      per-user gate. Returns a 429 envelope if exhausted.
 *   3. `parseJson(req, contactInquirySchema)` — Zod parse; the schema
 *      requires `captchaToken` so a structurally-broken request never
 *      reaches the verifier.
 *   4. `verifyCaptcha(...)`             — server-side captcha check;
 *      rejections collapse to a uniform 422 envelope and emit a
 *      structured `captcha_rejected` log line.
 *   5. `nextReferenceNumber` + `db.insert` — persistence.
 *   6. PostHog `capture` — analytics fire only on the success path
 *      (Req 9.4); rejections emit no `capture`.
 *   7. `applyCors(res, corsDecision)`   — mutate response headers.
 *
 * Notes:
 *   - The full captcha token is never logged. Only the first 8 chars are
 *     forwarded as `captchaTokenPrefix` for correlation.
 *   - The 422 wire format is fixed by Req 2.3 / 9.5: a single localized
 *     string in `fields.captchaToken` regardless of the underlying reason.
 */
import { applyRateLimit, created, fail, internal, parseJson } from "@/lib/api";
import { verifyCaptcha, type CaptchaVerifyResult } from "@/lib/captcha/verify";
import { captchaRejection, isVerifyOk } from "@/lib/captcha/route-helpers";
import { applyCors, decideCors } from "@/lib/cors";
import { db, inquiries, type Inquiry } from "@/db";
import { logSecurityEvent } from "@/lib/log";
import { capture } from "@/lib/posthog";
import { ipFromHeaders } from "@/lib/rate-limit";
import { allocateAndInsert, ReferenceAllocationError } from "@/lib/reference-numbers";
import { contactInquirySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve the structured-log `reason` for a captcha rejection, including
 * the synthetic `hostname_mismatch` reason produced by the route-level
 * hostname check on an otherwise-`ok` provider response (Req 2.7).
 */
function rejectionReason(r: CaptchaVerifyResult): string {
    if (r.ok) return "hostname_mismatch";
    return r.reason;
}

export async function POST(req: Request) {
    // (1) CORS decision — classified up front so every downstream
    //     response (including the 429 / 422 rejections below) can have
    //     the appropriate ACAO / Vary headers applied.
    const corsDecision = decideCors(req);

    // (2) Rate limit. `applyRateLimit` consults per-IP + per-user
    //     buckets, returns a 429 envelope when either denies, or `null`
    //     to admit. Bypass-paths (cron / internal / X-Cron-Secret) are
    //     short-circuited inside the helper.
    const limited = await applyRateLimit(req, "contact");
    if (limited) return applyCors(limited, corsDecision);

    // (3) Zod parse. `captchaToken` is required at the schema level
    //     (Req 2.4 / 10.1) so a request with no token is rejected here
    //     with a generic 422 before reaching the verifier.
    const parsed = await parseJson(req, contactInquirySchema);
    if (!parsed.ok) return applyCors(parsed.response!, corsDecision);
    const input = parsed.data!;

    // (4) Captcha verification. Side-effects below MUST NOT run unless
    //     `isVerifyOk` resolves to `true`.
    const ip = ipFromHeaders(req.headers);
    const verifyResult = await verifyCaptcha(input.captchaToken, {
        remoteIp: ip,
        expectedAction: "contact",
    });
    if (!isVerifyOk(verifyResult)) {
        // Fire-and-forget structured log. Logger swallows its own
        // failures (Req 9.6) so the user-facing rejection always ships.
        // Only the first 8 chars of the token are recorded — the full
        // token is never written to logs.
        void logSecurityEvent("captcha_rejected", {
            route: "/api/contact",
            ip,
            reason: rejectionReason(verifyResult),
            captchaTokenPrefix: input.captchaToken.slice(0, 8),
        });
        return applyCors(captchaRejection(), corsDecision);
    }

    // (5) + (6) Persistence and analytics.
    try {
        const { row: inquiry } = await allocateAndInsert<Inquiry>(
            "INQ",
            {
                table: inquiries,
                referenceColumn: inquiries.referenceNumber,
                createdAtColumn: inquiries.createdAt,
                uniqueConstraintName: "inquiry_reference_number_unique",
            },
            db,
            (referenceNumber) => ({
                referenceNumber,
                name: input.name,
                email: input.email,
                phone: input.phone ?? null,
                subject: input.subject ?? "general",
                message: input.message,
                status: "new",
            })
        );

        // PostHog capture fires only on the success path — Req 9.4.
        capture({
            event: "contact_submitted",
            distinctId: `email:${input.email}`,
            properties: {
                reference_number: inquiry.referenceNumber,
                subject: inquiry.subject,
            },
        });

        return applyCors(
            created({
                inquiry: {
                    id: inquiry.id,
                    referenceNumber: inquiry.referenceNumber,
                    status: inquiry.status,
                    createdAt: inquiry.createdAt,
                },
                message: "Сообщение получено. Мы ответим в ближайшее время.",
            }),
            corsDecision
        );
    } catch (error) {
        if (error instanceof ReferenceAllocationError) {
            return applyCors(
                fail(error.code, "Не удалось выделить номер обращения, попробуйте ещё раз.", {
                    status: 503,
                }),
                corsDecision
            );
        }
        console.error("[/api/contact] failed", error);
        return applyCors(internal(), corsDecision);
    }
}
