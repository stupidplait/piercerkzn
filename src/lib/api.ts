/**
 * Shared HTTP helpers for Route Handlers under `/api/*`.
 *
 * Standardises:
 *   - JSON success responses
 *   - JSON error envelopes  `{ error: { code, message, details? } }`
 *   - Zod parse → 422 conversion
 *   - Auth helpers wrapping `auth()` from Auth.js v5
 *   - Rate limit shortcut tied to `@/lib/rate-limit`
 */
import "server-only";

import { NextResponse } from "next/server";
import { ZodError, type ZodIssue, type ZodSchema } from "zod";

import { auth } from "./auth";
import { logSecurityEvent } from "./log";
import {
    check,
    ipFromHeaders,
    isBypassPath,
    PER_USER_KIND,
    type LimiterKind,
    type RateLimitResult,
} from "./rate-limit";

// ---------------------------------------------------------------------------
// Error codes — kept short and stable; clients pattern-match on these.
// ---------------------------------------------------------------------------
export const ErrorCode = {
    Unauthorized: "unauthorized",
    Forbidden: "forbidden",
    NotFound: "not_found",
    Validation: "validation_error",
    RateLimited: "rate_limited",
    Conflict: "conflict",
    Internal: "internal_error",
    BadRequest: "bad_request",
} as const;
export type ErrorCodeT = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
    return NextResponse.json(data, init);
}

export function created<T>(data: T): NextResponse<T> {
    return NextResponse.json(data, { status: 201 });
}

export function noContent(): NextResponse {
    return new NextResponse(null, { status: 204 });
}

interface ErrorBody {
    error: {
        code: ErrorCodeT | string;
        message: string;
        details?: unknown;
    };
}

export function fail(
    code: ErrorCodeT | string,
    message: string,
    init: { status?: number; details?: unknown; headers?: HeadersInit } = {}
): NextResponse<ErrorBody> {
    const body: ErrorBody = { error: { code, message } };
    if (init.details !== undefined) body.error.details = init.details;
    return NextResponse.json(body, { status: init.status ?? 400, headers: init.headers });
}

export function notFound(message = "Не найдено"): NextResponse<ErrorBody> {
    return fail(ErrorCode.NotFound, message, { status: 404 });
}

export function unauthorized(message = "Требуется авторизация"): NextResponse<ErrorBody> {
    return fail(ErrorCode.Unauthorized, message, { status: 401 });
}

export function forbidden(message = "Доступ запрещён"): NextResponse<ErrorBody> {
    return fail(ErrorCode.Forbidden, message, { status: 403 });
}

export function validationFailed(
    issues: ZodIssue[],
    message = "Проверьте корректность введённых данных"
): NextResponse<ErrorBody> {
    return fail(ErrorCode.Validation, message, {
        status: 422,
        details: issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
    });
}

export function rateLimited(retryAfterSeconds: number): NextResponse<ErrorBody> {
    return fail(ErrorCode.RateLimited, "Слишком много запросов, попробуйте позже", {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    });
}

export function internal(message = "Ошибка сервера"): NextResponse<ErrorBody> {
    return fail(ErrorCode.Internal, message, { status: 500 });
}

// ---------------------------------------------------------------------------
// Postgres error helper
// ---------------------------------------------------------------------------
//
// The `postgres` driver throws a `PostgresError` whose `code` is the SQLSTATE
// (e.g. "23505" for unique_violation, "23503" for foreign_key_violation).
// Drizzle wraps that in a `DrizzleQueryError` whose `cause` is the raw
// `PostgresError`. Code that does `(err as { code }).code` on the outer
// wrapper silently misses the code in production. This helper walks the
// `cause` chain so route handlers don't have to.
//
// Usage:
//   } catch (error) {
//       if (pgErrorCode(error) === "23505") { ... }
//   }
export function pgErrorCode(err: unknown): string | undefined {
    let cur: unknown = err;
    // Two hops is enough for Drizzle's wrapping; we cap at five to be safe
    // against any future re-wraps without risking infinite loops on cycles.
    for (let i = 0; i < 5 && cur; i++) {
        if (typeof cur === "object" && cur !== null && "code" in cur) {
            const code = (cur as { code?: unknown }).code;
            if (typeof code === "string") return code;
        }
        cur =
            typeof cur === "object" && cur !== null && "cause" in cur
                ? (cur as { cause?: unknown }).cause
                : undefined;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Zod parsing
// ---------------------------------------------------------------------------
export interface ParseResult<T> {
    ok: boolean;
    data?: T;
    response?: NextResponse<ErrorBody>;
}

export async function parseJson<T>(req: Request, schema: ZodSchema<T>): Promise<ParseResult<T>> {
    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        return {
            ok: false,
            response: fail(ErrorCode.BadRequest, "Некорректный JSON", { status: 400 }),
        };
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
        return { ok: false, response: validationFailed((result.error as ZodError).issues) };
    }
    return { ok: true, data: result.data };
}

export function parseQuery<T>(url: URL, schema: ZodSchema<T>): ParseResult<T> {
    const obj: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
        obj[k] = v;
    });
    const result = schema.safeParse(obj);
    if (!result.success) {
        return { ok: false, response: validationFailed((result.error as ZodError).issues) };
    }
    return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
export interface AuthedRequestContext {
    userId: string;
    customerId?: string;
    role: "customer" | "admin" | "staff";
}

export async function getOptionalUser(): Promise<AuthedRequestContext | null> {
    const session = await auth();
    if (!session?.user?.id) return null;
    return {
        userId: session.user.id,
        customerId: session.user.customerId,
        role: session.user.role,
    };
}

export async function requireUser(): Promise<
    { ctx: AuthedRequestContext; response: null } | { ctx: null; response: NextResponse<ErrorBody> }
> {
    const ctx = await getOptionalUser();
    if (!ctx) return { ctx: null, response: unauthorized() };
    return { ctx, response: null };
}

export async function requireAdmin(): Promise<
    { ctx: AuthedRequestContext; response: null } | { ctx: null; response: NextResponse<ErrorBody> }
> {
    const ctx = await getOptionalUser();
    if (!ctx) return { ctx: null, response: unauthorized() };
    if (ctx.role !== "admin" && ctx.role !== "staff") {
        return { ctx: null, response: forbidden() };
    }
    return { ctx, response: null };
}

// ---------------------------------------------------------------------------
// Rate limiting shortcut
// ---------------------------------------------------------------------------
/**
 * Options for `applyRateLimit`.
 *
 *   - `skipPerUser`: skip the per-user bucket consultation even when the
 *     caller is authenticated and `kind` has a per-user counterpart in
 *     {@link PER_USER_KIND}. Use sparingly, with an inline comment
 *     explaining why per-user is intentionally skipped (Req 4.7).
 *   - `skipPerIp`: skip the per-IP bucket consultation. Mostly useful
 *     for tests that want to exercise per-user gating in isolation.
 *   - `explicitIp`: override the IP resolved from request headers.
 *     Defaults to `ipFromHeaders(req.headers)`.
 */
export interface ApplyRateLimitOptions {
    skipPerUser?: boolean;
    skipPerIp?: boolean;
    explicitIp?: string;
}

/**
 * Apply rate limits to a request.
 *
 * Consults the per-IP bucket and, when the request resolves to an
 * authenticated user via {@link getOptionalUser} AND the given `kind` has
 * a per-user counterpart in {@link PER_USER_KIND}, ALSO consults the
 * per-user bucket. Both checks run in parallel via `Promise.all`. The
 * request is admitted only when EVERY consulted bucket admits it
 * (Req 4.3 / 4.4).
 *
 * Returns:
 *   - `null` to admit the request, OR
 *   - a 429 `NextResponse` (with a `Retry-After` header derived from the
 *     earliest failing bucket reset) to deny it.
 *
 * Bypass: when `isBypassPath(req)` returns `true` the helper short-circuits
 * with `null` without consulting any bucket (Req 4.6).
 *
 * Logging: any denial emits a single `rate_limit_denied` structured log
 * line via `logSecurityEvent`. The logger swallows its own errors
 * (Req 9.6) so a misbehaving observability pipeline cannot block the
 * 429 response from reaching the client.
 *
 * Identifier prefixes are disjoint by construction (Req 4.8):
 *   - per-IP key:   `"ip:<ip>"`
 *   - per-user key: `"u:<userId>"`
 */
export async function applyRateLimit(
    req: Request,
    kind: LimiterKind,
    options: ApplyRateLimitOptions = {}
): Promise<NextResponse<ErrorBody> | null> {
    if (isBypassPath(req)) return null;

    const ip = options.explicitIp ?? ipFromHeaders(req.headers);
    const ctx = await getOptionalUser();
    const userKind = PER_USER_KIND[kind];

    const checks: Promise<RateLimitResult>[] = [];
    const labels: string[] = [];

    if (!options.skipPerIp) {
        checks.push(check(kind, `ip:${ip}`));
        labels.push(`ip:${kind}`);
    }
    if (!options.skipPerUser && ctx?.userId && userKind) {
        checks.push(check(userKind, `u:${ctx.userId}`));
        labels.push(`user:${userKind}`);
    }

    if (checks.length === 0) return null;

    const results = await Promise.all(checks);
    const failingIdx: number[] = [];
    for (let i = 0; i < results.length; i++) {
        if (!results[i].success) failingIdx.push(i);
    }
    if (failingIdx.length === 0) return null;

    // Compute Retry-After from the earliest failing bucket reset only.
    let minReset = Number.POSITIVE_INFINITY;
    for (const i of failingIdx) {
        if (results[i].reset < minReset) minReset = results[i].reset;
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((minReset - Date.now()) / 1000));

    const reason = failingIdx.map((i) => labels[i]).join(",");
    // Fire-and-forget: `logSecurityEvent` swallows its own failures (Req 9.6).
    void logSecurityEvent("rate_limit_denied", {
        route: new URL(req.url).pathname,
        ip,
        userId: ctx?.userId,
        reason,
        retryAfterMs: retryAfterSeconds * 1000,
    });

    return rateLimited(retryAfterSeconds);
}
