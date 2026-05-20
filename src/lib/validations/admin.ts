/**
 * Admin route validation schemas.
 *
 * Kept in a single file because admin endpoints are uniformly small
 * status-transition / notes-update / reply payloads.
 */
import { z } from "zod";
import { paginationSchema } from "./common";
import { reservationStatuses } from "./reservation";

// ---------------------------------------------------------------------------
// Generic notes payload
// ---------------------------------------------------------------------------
export const adminNotesSchema = z.object({
    notes: z.string().trim().max(4_000),
});
export type AdminNotesInput = z.infer<typeof adminNotesSchema>;

// ---------------------------------------------------------------------------
// Reservations admin
// ---------------------------------------------------------------------------
export const listAdminReservationsQuerySchema = paginationSchema.extend({
    status: z.enum(reservationStatuses).optional(),
    q: z.string().trim().max(120).optional(), // search by reference / email / phone
    from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
    to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
    sort: z.enum(["newest", "oldest", "expiring"]).default("newest"),
});
export type ListAdminReservationsQuery = z.infer<typeof listAdminReservationsQuerySchema>;

export const extendReservationSchema = z.object({
    /** Additional hold time in hours; clamped 1..168 (1 week). */
    additionalHours: z.coerce.number().int().min(1).max(168),
});
export type ExtendReservationInput = z.infer<typeof extendReservationSchema>;

// (`cancelReservationSchema` from `./reservation` is reused — same shape.)

// ---------------------------------------------------------------------------
// Customers admin
// ---------------------------------------------------------------------------
export const listAdminCustomersQuerySchema = paginationSchema.extend({
    q: z.string().trim().max(120).optional(),
    sort: z.enum(["newest", "oldest", "name"]).default("newest"),
    includeDeleted: z.coerce.boolean().optional(),
});
export type ListAdminCustomersQuery = z.infer<typeof listAdminCustomersQuerySchema>;

// ---------------------------------------------------------------------------
// Inquiries admin
// ---------------------------------------------------------------------------
export const inquiryStatuses = ["new", "in_progress", "resolved", "closed"] as const;

export const listAdminInquiriesQuerySchema = paginationSchema.extend({
    status: z.enum(inquiryStatuses).optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.enum(["newest", "oldest"]).default("newest"),
});
export type ListAdminInquiriesQuery = z.infer<typeof listAdminInquiriesQuerySchema>;

export const updateInquiryStatusSchema = z.object({
    status: z.enum(inquiryStatuses),
});
export type UpdateInquiryStatusInput = z.infer<typeof updateInquiryStatusSchema>;

export const replyInquirySchema = z.object({
    content: z.string().trim().min(1).max(8_000),
    sentVia: z.enum(["email", "internal_note"]).default("email"),
});
export type ReplyInquiryInput = z.infer<typeof replyInquirySchema>;

// ---------------------------------------------------------------------------
// Reviews admin
// ---------------------------------------------------------------------------
export const reviewModerationStatuses = ["pending", "approved", "rejected"] as const;

export const listAdminReviewsQuerySchema = paginationSchema.extend({
    status: z.enum(reviewModerationStatuses).optional(),
    productId: z.string().uuid().optional(),
    sort: z.enum(["newest", "oldest"]).default("newest"),
});
export type ListAdminReviewsQuery = z.infer<typeof listAdminReviewsQuerySchema>;

export const rejectReviewSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});
export type RejectReviewInput = z.infer<typeof rejectReviewSchema>;

// ---------------------------------------------------------------------------
// Notifications (store inbox + admin log)
// ---------------------------------------------------------------------------
export const notificationChannels = ["email", "sms", "push", "telegram"] as const;

export const listNotificationsQuerySchema = paginationSchema.extend({
    channel: z.enum(notificationChannels).optional(),
    unreadOnly: z.coerce.boolean().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const listAdminNotificationLogQuerySchema = paginationSchema.extend({
    channel: z.enum(notificationChannels).optional(),
    type: z.string().trim().max(50).optional(),
    customerId: z.string().uuid().optional(),
    status: z.enum(["sent", "delivered", "failed", "bounced"]).optional(),
    from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
    to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
});
export type ListAdminNotificationLogQuery = z.infer<typeof listAdminNotificationLogQuerySchema>;

// ---------------------------------------------------------------------------
// Analytics (admin)
// ---------------------------------------------------------------------------
export const analyticsPeriods = ["daily", "weekly", "monthly"] as const;

export const analyticsRangeSchema = z.object({
    from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
    to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
    period: z.enum(analyticsPeriods).default("monthly"),
});
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeSchema>;

// ---------------------------------------------------------------------------
// Settings (admin)
// ---------------------------------------------------------------------------
export const listSettingsQuerySchema = z.object({
    group: z.string().trim().min(1).max(50).optional(),
});
export type ListSettingsQuery = z.infer<typeof listSettingsQuerySchema>;

/**
 * Accepted shapes for a single setting's `value` JSONB column. The first three
 * are the canonical typed wrappers seeded by the studio; the last branch
 * keeps the door open for free-form integration configs (e.g. webhook
 * secrets, channel lists).
 *
 * The catch-all is fenced so it can't silently swallow malformed typed
 * wrappers: an object whose only key is `text` / `number` / `bool` MUST
 * match the typed wrapper's constraints (e.g. 2 000-char cap on text) and
 * cannot fall back to the free-form branch.
 */
const RESERVED_WRAPPER_KEYS = new Set(["text", "number", "bool"]);
export const settingValueSchema = z.union([
    z.object({ text: z.string().max(2_000) }).strict(),
    z.object({ number: z.number() }).strict(),
    z.object({ bool: z.boolean() }).strict(),
    z.record(z.string(), z.unknown()).refine(
        (v) => {
            const keys = Object.keys(v);
            // Single-key object using a reserved discriminator → must go
            // through the typed wrapper above; reject here so we don't
            // bypass the wrapper's validation (e.g. text length cap).
            return !(keys.length === 1 && RESERVED_WRAPPER_KEYS.has(keys[0]));
        },
        {
            message: "Для одиночных значений text/number/bool используйте типизированный wrapper",
        }
    ),
]);

export const settingsBulkUpdateSchema = z.object({
    /**
     * Flat map of { key: value }. Keys must already share the targeted group
     * (validated server-side); the value shape is `{ text | number | bool }`
     * or any JSONB record.
     */
    settings: z
        .record(z.string().min(1).max(120), settingValueSchema)
        .refine((m) => Object.keys(m).length > 0, { message: "Нет параметров для обновления" }),
});
export type SettingsBulkUpdateInput = z.infer<typeof settingsBulkUpdateSchema>;

/**
 * Single-key PATCH body. Used by `PATCH /api/admin/settings/by-key/[key]` so
 * the admin UI doesn't need to know each setting's group when editing one
 * value.
 */
export const settingPatchSchema = z.object({
    value: settingValueSchema,
});
export type SettingPatchInput = z.infer<typeof settingPatchSchema>;

/**
 * Cross-group bulk PATCH body. Same flat shape as the per-group bulk update,
 * but the server discovers each key's group from the DB instead of asserting
 * a single target group. Useful for "Save all changes" flows that span
 * sections.
 */
export const settingsCrossGroupPatchSchema = z.object({
    settings: z
        .record(z.string().min(1).max(120), settingValueSchema)
        .refine((m) => Object.keys(m).length > 0, { message: "Нет параметров для обновления" })
        .refine((m) => Object.keys(m).length <= 100, {
            message: "Слишком много параметров за один запрос (макс 100)",
        }),
});
export type SettingsCrossGroupPatchInput = z.infer<typeof settingsCrossGroupPatchSchema>;
