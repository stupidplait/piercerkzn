/**
 * Newsletter campaign authoring + lifecycle validation.
 * Mirrors `.kiro/specs/newsletter-broadcasts/design.md` §"Module Map" and
 * the limits called out in Requirements 2.1, 2.4, 2.5, 2.10.
 */
import { z } from "zod";

const SUBJECT_MAX = 200;
const PREHEADER_MAX = 200;
const BODY_MAX = 100 * 1024; // 100 KB

export const createCampaignSchema = z.object({
    subject: z.string().trim().min(1, "Тема обязательна").max(SUBJECT_MAX),
    preheader: z.string().trim().max(PREHEADER_MAX).optional().nullable(),
    bodyMarkdown: z.string().min(1, "Тело письма обязательно").max(BODY_MAX),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
    subject: z.string().trim().min(1).max(SUBJECT_MAX).optional(),
    preheader: z.string().trim().max(PREHEADER_MAX).nullable().optional(),
    bodyMarkdown: z.string().min(1).max(BODY_MAX).optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

const oneMinuteFromNow = () => new Date(Date.now() + 60_000);

export const scheduleCampaignSchema = z.object({
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
export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;

export const testSendSchema = z.object({
    to: z.string().email(),
});
export type TestSendInput = z.infer<typeof testSendSchema>;

export const previewQuerySchema = z.object({}).passthrough();
export type PreviewQueryInput = z.infer<typeof previewQuerySchema>;
