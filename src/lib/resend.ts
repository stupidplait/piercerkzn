/**
 * Resend email singleton + thin wrapper.
 *
 * The Resend SDK is fetch-based and edge-safe; we still mark this file
 * `server-only` because emails should never be sent from the client.
 *
 * For Auth.js magic-link emails, see `src/lib/auth.config.ts` (it talks to
 * Resend's REST API directly so it can run from edge runtime if Auth.js
 * ever tries to). This module is for application-triggered email — booking
 * confirmations, reservation expiry, aftercare drips.
 */
import "server-only";

import { Resend } from "resend";

declare global {
    var __resend: Resend | undefined;
}

function createResend(): Resend {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error("RESEND_API_KEY is not set. See .env.example.");
    }
    return new Resend(apiKey);
}

/**
 * Lazily resolve the singleton Resend client. The key is read on first
 * call rather than at module load so a build-time `next build` (which
 * crawls every route file to collect page data) does not require
 * `RESEND_API_KEY` to be present in the environment — only the runtime
 * paths that actually send email do.
 */
function getResend(): Resend {
    const cached = globalThis.__resend;
    if (cached) return cached;
    const created = createResend();
    if (process.env.NODE_ENV !== "production") {
        globalThis.__resend = created;
    }
    return created;
}

export const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL ?? "PiercerKZN <noreply@piercerkzn.ru>";

export interface SendEmailParams {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    tags?: { name: string; value: string }[];
}

/**
 * Thin wrapper that returns the Resend message id on success and throws on
 * failure. Callers should treat the return value as an opaque trace token
 * (logged into `notification_log`).
 *
 * Resend's `CreateEmailOptions` is a discriminated union — exactly one of
 * `html` / `text` / `react` / `template` must be present. We build the
 * payload narrowly so TypeScript can pick a branch.
 */
export async function sendEmail(params: SendEmailParams): Promise<string> {
    if (!params.html && !params.text) {
        throw new Error("sendEmail: one of `html` or `text` must be provided");
    }

    const base = {
        from: params.from ?? DEFAULT_FROM,
        to: params.to,
        subject: params.subject,
        replyTo: params.replyTo,
        headers: params.headers,
        tags: params.tags,
    };

    const result = params.html
        ? await getResend().emails.send({ ...base, html: params.html, text: params.text })
        : await getResend().emails.send({ ...base, text: params.text! });

    if (result.error) {
        throw new Error(`Resend send failed: ${result.error.message}`);
    }
    if (!result.data?.id) {
        throw new Error("Resend send succeeded but returned no message id");
    }
    return result.data.id;
}
