/**
 * Centralised, Zod-validated environment loader for the public-form abuse
 * hardening surface (captcha, rate-limit, CORS, cron).
 *
 * Edge-runtime safe: this module is imported by `lib/cors.ts`, which runs
 * inside `src/middleware.ts`. As a result it MUST NOT:
 *   - import `server-only`,
 *   - reach for any Node-only API (`fs`, `path`, `process.cwd()` side
 *     effects, etc.); only `process.env` reads are safe at the edge,
 *   - throw at import time except on the strict production-misconfig path
 *     described below.
 *
 * Behaviour summary:
 *   1. In production (`NODE_ENV === "production"`) a parse failure throws
 *      a descriptive `Error` so the process fails to start.
 *   2. In every other environment a parse failure logs a `console.warn`
 *      and falls back to the schema-defined defaults so local dev keeps
 *      working without a fully populated `.env`.
 *   3. `CAPTCHA_SECRET_KEY` and `CORS_ALLOWED_ORIGINS` are required in
 *      production via `requiredInProd(...)` — every other field is
 *      optional with sane defaults baked into the schema or applied by
 *      the consuming module.
 */
import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

/**
 * Build a string field that is "optional in dev/test, required in prod".
 *
 * We attach the production check via `superRefine` so a missing value in
 * a non-production build leaves `value === undefined`, while the same
 * shape in production fails the parse with a descriptive issue.
 */
const requiredInProd = (label: string) =>
    z
        .string()
        .min(1)
        .optional()
        .superRefine((v, ctx) => {
            if (isProd && (!v || v.trim().length === 0)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${label} is required in production`,
                });
            }
        });

/**
 * Rate-limit window strings as understood by `@upstash/ratelimit`:
 * `<positive integer><whitespace><unit>`, where unit is `s`, `m`, `h`, or `d`.
 * Examples: `"30 s"`, `"5 m"`, `"1 h"`, `"7 d"`.
 */
export const windowSchema = z
    .string()
    .regex(/^\d+\s+[smhd]$/, "expected `<n> s|m|h|d`")
    .optional();

/**
 * Numeric env override: accept a digits-only string and coerce to `number`.
 * Anything else (empty, negative sign, decimals) fails the parse.
 */
export const intLikeSchema = z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .optional();

export const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // ----- Captcha -----------------------------------------------------------
    CAPTCHA_PROVIDER: z.enum(["hcaptcha", "turnstile", "disabled"]).default("disabled"),
    CAPTCHA_SECRET_KEY: requiredInProd("CAPTCHA_SECRET_KEY"),
    CAPTCHA_SITE_KEY: z.string().optional(),
    CAPTCHA_EXPECTED_HOSTNAME: z.string().optional(),
    CAPTCHA_VERIFY_TIMEOUT_MS: intLikeSchema,
    CAPTCHA_DEV_BYPASS: z.enum(["0", "1"]).default("0"),

    // ----- Rate limits — all optional, fall back to in-code DEFS -----------
    CONTACT_RL_LIMIT: intLikeSchema,
    CONTACT_RL_WINDOW: windowSchema,
    CONTACT_USER_RL_LIMIT: intLikeSchema,
    CONTACT_USER_RL_WINDOW: windowSchema,
    RESERVATION_RL_LIMIT: intLikeSchema,
    RESERVATION_RL_WINDOW: windowSchema,
    RESERVATION_USER_RL_LIMIT: intLikeSchema,
    RESERVATION_USER_RL_WINDOW: windowSchema,

    // ----- CORS --------------------------------------------------------------
    CORS_ALLOWED_ORIGINS: requiredInProd("CORS_ALLOWED_ORIGINS"),

    // ----- Cron / internal-bypass detection ---------------------------------
    CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success && isProd) {
    // Production: surface every issue and abort the process. The error
    // message lists each issue separated by `; ` so the operator sees the
    // full set in a single line of stderr.
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`[env] invalid configuration: ${issues}`);
}

if (!parsed.success) {
    // Non-production: log and fall back to defaults. We re-parse an empty
    // object so we get the schema's defaults (`NODE_ENV`, `CAPTCHA_PROVIDER`,
    // `CAPTCHA_DEV_BYPASS`); every other field stays `undefined`. This keeps
    // local dev runnable without a fully populated `.env.local`.
    const issues = parsed.error.issues.map((i) => i.message).join("; ");

    console.warn(`[env] using defaults — invalid configuration: ${issues}`);
}

export const env: Env = parsed.success ? parsed.data : envSchema.parse({});
