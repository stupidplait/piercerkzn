/**
 * Telegram broadcast renderer.
 *
 * Pure function: takes a TelegramBroadcast row and produces the second-
 * argument shape of `bot.api.sendMessage`. Validates `parseMode` and inline
 * button URL scheme. Used by both the dispatcher (per-recipient send) and
 * the `/preview` admin route (no DB writes there).
 */
import "server-only";

import type { TelegramBroadcast } from "@/db";

export interface BroadcastPayload {
    text: string;
    parse_mode: "HTML" | "MarkdownV2";
    reply_markup?: {
        inline_keyboard: [[{ text: string; url: string }]];
    };
}

const HTTP_URL_RE = /^https?:\/\//u;
const PARSE_MODES = new Set(["HTML", "MarkdownV2"]);

export function renderBroadcastPayload(b: TelegramBroadcast): BroadcastPayload {
    if (!PARSE_MODES.has(b.parseMode)) {
        throw new Error(`invalid parse_mode: ${b.parseMode}`);
    }

    const payload: BroadcastPayload = {
        text: b.bodyText,
        parse_mode: b.parseMode as "HTML" | "MarkdownV2",
    };

    const hasLabel = !!b.inlineButtonLabel;
    const hasUrl = !!b.inlineButtonUrl;
    if (hasLabel && hasUrl) {
        const url = b.inlineButtonUrl!;
        if (!HTTP_URL_RE.test(url)) {
            throw new Error(`invalid inline button URL scheme: ${url}`);
        }
        payload.reply_markup = {
            inline_keyboard: [[{ text: b.inlineButtonLabel!, url }]],
        };
    }
    // If only one of label/url is set, omit reply_markup silently — the API
    // boundary's zod refinement should already prevent this state.

    return payload;
}
