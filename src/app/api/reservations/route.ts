/**
 * /api/reservations
 *   POST — create a new reservation (public; gated by CORS, rate limit,
 *          and a server-side captcha verification).
 *   GET  — list the authenticated customer's reservations.
 *
 * POST request lifecycle (mirrors `/api/contact`, design §8):
 *   1. `decideCors(req)` — classify the Origin once; reused on every
 *      branch so even rejection responses carry the correct CORS posture.
 *   2. `applyRateLimit(req, "reservation")` — per-IP + (when authenticated)
 *      per-user buckets; bypass paths short-circuit.
 *   3. `parseJson(req, createReservationSchema)` — Zod parse, including
 *      the now-required `captchaToken` field.
 *   4. `verifyCaptcha(token, { remoteIp, expectedAction: "reservation" })`
 *      — `isVerifyOk` folds in the optional dev-bypass and
 *      `CAPTCHA_EXPECTED_HOSTNAME` cross-check; non-ok outcomes log
 *      `captcha_rejected` and return the canonical 422 envelope.
 *   5. `createReservation(...)` — domain logic + DB transaction.
 *   6. Best-effort side effects (BullMQ expiry enqueue, Telegram notify,
 *      confirmation email) keep their existing `void` / `.catch(...)`
 *      semantics so a side-effect failure NEVER rolls back the
 *      reservation. PostHog `capture` only fires on the success path
 *      (Req 9.4) — no analytics events for rejections.
 *   7. Every response (rejections, 429, success) flows through
 *      `applyCors(res, corsDecision)` so allowed origins receive
 *      `Access-Control-Allow-Origin` + `Vary: Origin` and denied origins
 *      do not (default-deny posture).
 */
import { desc, eq } from "drizzle-orm";

import {
    applyRateLimit,
    created,
    fail,
    getOptionalUser,
    internal,
    ok,
    parseJson,
    requireUser,
} from "@/lib/api";
import { db, reservations } from "@/db";
import { verifyCaptcha } from "@/lib/captcha/verify";
import { captchaRejection, isVerifyOk } from "@/lib/captcha/route-helpers";
import { applyCors, decideCors } from "@/lib/cors";
import { logSecurityEvent } from "@/lib/log";
import { ipFromHeaders } from "@/lib/rate-limit";
import { enqueueReservationExpiry } from "@/lib/queue";
import { capture } from "@/lib/posthog";
import { ReferenceAllocationError } from "@/lib/reference-numbers";
import { createReservation, ReservationError } from "@/lib/reservations";
import { notifyReservationCreated } from "@/lib/telegram/notifications";
import { sendReservationConfirmationEmail } from "@/emails/dispatch";
import { createReservationSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    // Step 0: classify the request's Origin once. Every branch below
    // funnels its response through `applyCors(res, corsDecision)` so the
    // CORS contract is uniform across the success / rejection / 429 /
    // 500 paths.
    const corsDecision = decideCors(req);

    // Step 1: rate-limit (per-IP + per-user via applyRateLimit).
    const limited = await applyRateLimit(req, "reservation");
    if (limited) return applyCors(limited, corsDecision);

    // Step 2: Zod parse — `captchaToken` is required at the schema level
    // so a missing/short token short-circuits with a 422 here, BEFORE we
    // burn a captcha provider call.
    const parsed = await parseJson(req, createReservationSchema);
    if (!parsed.ok) return applyCors(parsed.response!, corsDecision);
    const input = parsed.data!;

    // Step 3: server-side captcha verification. The verifier itself never
    // throws; `isVerifyOk` folds in the dev-bypass + hostname check.
    const ip = ipFromHeaders(req.headers);
    const verifyResult = await verifyCaptcha(input.captchaToken, {
        remoteIp: ip,
        expectedAction: "reservation",
    });
    if (!isVerifyOk(verifyResult)) {
        // Reason for the structured log: precise verifier reason on
        // `ok:false`; on `ok:true` the only way `isVerifyOk` returns
        // false is the hostname mismatch path (Req 2.7).
        const reason = verifyResult.ok ? "hostname_mismatch" : verifyResult.reason;
        // Fire-and-forget: the logger swallows its own failures (Req 9.6).
        void logSecurityEvent("captcha_rejected", {
            route: "/api/reservations",
            ip,
            // Never log the full token — only the 8-char prefix per Req 2.6.
            captchaTokenPrefix: input.captchaToken.slice(0, 8),
            reason,
        });
        return applyCors(captchaRejection(), corsDecision);
    }

    // Step 4: business logic + DB transaction.
    const sessionUser = await getOptionalUser();

    let result;
    try {
        result = await createReservation(input, {
            sessionCustomerId: sessionUser?.customerId,
        });
    } catch (error) {
        if (error instanceof ReservationError) {
            const status = error.code === "out_of_stock" ? 409 : 400;
            return applyCors(fail(error.code, error.message, { status }), corsDecision);
        }
        if (error instanceof ReferenceAllocationError) {
            return applyCors(
                fail(error.code, "Не удалось выделить номер бронирования, попробуйте ещё раз.", {
                    status: 503,
                }),
                corsDecision
            );
        }
        console.error("[/api/reservations POST] failed", error);
        return applyCors(internal(), corsDecision);
    }

    // -----------------------------------------------------------------
    // Step 5: best-effort side effects — never roll back the reservation
    // -----------------------------------------------------------------
    const expiryDelayMs = result.reservation.expiresAt.getTime() - Date.now();
    void enqueueReservationExpiry(result.reservation.id, expiryDelayMs).catch((err) => {
        console.error("[reservation] enqueue expiry failed", err);
    });

    void notifyReservationCreated(result.reservation, {
        itemTitles: result.items.map((i) => i.title),
    }).catch((err) => {
        console.error("[reservation] telegram notify failed", err);
    });

    void sendReservationConfirmationEmail({
        to: result.reservation.customerEmail,
        customerId: result.reservation.customerId,
        referenceNumber: result.reservation.referenceNumber,
        customerFirstName: result.reservation.customerFirstName,
        items: result.items.map((i) => ({
            title: i.title,
            variantTitle: i.variantTitle,
            quantity: i.quantity,
            total: i.total,
        })),
        totalKopecks: result.reservation.total,
        expiresAt: result.reservation.expiresAt,
    }).catch((err) => {
        console.error("[reservation] email send failed", err);
    });

    // PostHog `capture` is only invoked on the success path (Req 9.4).
    capture({
        event: "reservation_submitted",
        distinctId: result.customer?.id ?? `email:${result.reservation.customerEmail}`,
        properties: {
            reservation_id: result.reservation.id,
            reference_number: result.reservation.referenceNumber,
            item_count: result.items.length,
            total: result.reservation.total,
            source: (result.reservation.metadata as { source?: string } | null)?.source,
            customer_created: result.customerCreated,
        },
    });

    return applyCors(
        created({
            reservation: {
                id: result.reservation.id,
                referenceNumber: result.reservation.referenceNumber,
                status: result.reservation.status,
                total: result.reservation.total,
                currencyCode: result.reservation.currencyCode,
                expiresAt: result.reservation.expiresAt,
                customerNotes: result.reservation.customerNotes,
                createdAt: result.reservation.createdAt,
                items: result.items.map((i) => ({
                    id: i.id,
                    title: i.title,
                    variantTitle: i.variantTitle,
                    sku: i.sku,
                    thumbnailUrl: i.thumbnailUrl,
                    unitPrice: i.unitPrice,
                    quantity: i.quantity,
                    total: i.total,
                    metadata: i.metadata,
                })),
                customer: result.customer
                    ? {
                          id: result.customer.id,
                          email: result.customer.email,
                          firstName: result.customer.firstName,
                          lastName: result.customer.lastName,
                      }
                    : null,
                customerCreated: result.customerCreated,
            },
        }),
        corsDecision
    );
}

// ---------------------------------------------------------------------------
// GET — list current user's reservations
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    // GET is authenticated and same-origin in practice, but we still
    // run the response through the CORS gate so a future Mini App fetch
    // from an allowlisted origin gets the correct headers.
    const corsDecision = decideCors(req);

    const guard = await requireUser();
    if (guard.response) return applyCors(guard.response, corsDecision);
    const ctx = guard.ctx!;

    if (!ctx.customerId) {
        return applyCors(ok({ reservations: [] }), corsDecision);
    }

    const rows = await db
        .select({
            id: reservations.id,
            referenceNumber: reservations.referenceNumber,
            status: reservations.status,
            total: reservations.total,
            expiresAt: reservations.expiresAt,
            createdAt: reservations.createdAt,
        })
        .from(reservations)
        .where(eq(reservations.customerId, ctx.customerId))
        .orderBy(desc(reservations.createdAt));

    return applyCors(ok({ reservations: rows }), corsDecision);
}
