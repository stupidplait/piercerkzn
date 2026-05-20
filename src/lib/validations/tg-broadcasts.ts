/**
 * Telegram broadcast authoring + lifecycle validation.
 * Mirrors `.kiro/specs/telegram-broadcasts/design.md` §"Module Map" and the
 * limits called out in Requirements 2.2, 2.4, 2.6, 2.10, 7.1, 7.2.
 */
import { z } from "zod";

const TITLE_MAX = 200;
const BODY_MAX = 4000; // Telegram sendMessage hard limit is 4096; 4000 leaves headroom
const BUTTON_LABEL_MAX = 64;
const BUTTON_URL_MAX = 256;

const httpsUrlRe = /^https?:\/\//u;

const inlineButtonRefinement = (data: {
    inlineButtonLabel?: string | null;
    inlineButtonUrl?: string | null;
}) => {
    const hasLabel = !!data.inlineButtonLabel;
    const hasUrl = !!data.inlineButtonUrl;
    return hasLabel === hasUrl;
};
const inlineButtonRefinementMessage =
    "inlineButtonLabel and inlineButtonUrl must both be set together or both be null";

export const createBroadcastSchema = z
    .object({
        title: z.string().trim().min(1, "Заголовок обязателен").max(TITLE_MAX),
        bodyText: z.string().min(1, "Тело сообщения обязательно").max(BODY_MAX),
        parseMode: z.enum(["HTML", "MarkdownV2"]).optional().default("HTML"),
        inlineButtonLabel: z.string().trim().max(BUTTON_LABEL_MAX).optional().nullable(),
        inlineButtonUrl: z
            .string()
            .trim()
            .max(BUTTON_URL_MAX)
            .regex(httpsUrlRe, "URL должен начинаться с http:// или https://")
            .optional()
            .nullable(),
    })
    .refine(inlineButtonRefinement, { message: inlineButtonRefinementMessage });
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const updateBroadcastSchema = z
    .object({
        title: z.string().trim().min(1).max(TITLE_MAX).optional(),
        bodyText: z.string().min(1).max(BODY_MAX).optional(),
        parseMode: z.enum(["HTML", "MarkdownV2"]).optional(),
        inlineButtonLabel: z.string().trim().max(BUTTON_LABEL_MAX).nullable().optional(),
        inlineButtonUrl: z
            .string()
            .trim()
            .max(BUTTON_URL_MAX)
            .regex(httpsUrlRe)
            .nullable()
            .optional(),
    })
    .refine(inlineButtonRefinement, { message: inlineButtonRefinementMessage });
export type UpdateBroadcastInput = z.infer<typeof updateBroadcastSchema>;

const oneMinuteFromNow = () => new Date(Date.now() + 60_000);

export const scheduleBroadcastSchema = z.object({
    scheduledAt: z
        .string()
        .datetime({ offset: true })
        .or(z.string().datetime())
        .transform((s) => new Date(s))
        .refine((d) => !Number.isNaN(d.getTime()), "Некорректная дата")
        .refine((d) => d.getTime() >= oneMinuteFromNow().getTime(), {
            message: "Дата отправки должна быть как минимум через минуту от текущего времени",
        }),
});
export type ScheduleBroadcastInput = z.infer<typeof scheduleBroadcastSchema>;

export const testSendSchema = z.object({
    // Telegram user IDs are positive 64-bit ints. We accept either a string
    // or a number and parse to a JS number (safe for current Telegram IDs
    // which fit in Number.MAX_SAFE_INTEGER, but if Telegram ever exceeds that
    // we'll need to switch to bigint).
    telegramId: z
        .union([z.string(), z.number()])
        .transform((v) => {
            const n = typeof v === "string" ? Number(v.trim()) : v;
            return n;
        })
        .refine((n) => Number.isInteger(n) && n > 0, {
            message: "telegramId must be a positive integer",
        }),
});
export type TestSendInput = z.infer<typeof testSendSchema>;

export const previewQuerySchema = z.object({}).passthrough();
export type PreviewQueryInput = z.infer<typeof previewQuerySchema>;
