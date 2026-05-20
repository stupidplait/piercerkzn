/**
 * Admin schemas for the booking surface owned by Phase E5:
 *
 *   - service
 *   - piercer_profile (singleton; PATCH-only)
 *   - piercer_schedule (weekly recurrence, 7-row table)
 *   - schedule_exception (per-date overrides)
 *   - time_block (one-off blocked sub-windows)
 *
 * Time values use Postgres `time` semantics — `HH:MM` or `HH:MM:SS` strings.
 * Cross-field rules (e.g. `endTime > startTime`) live on the schema so route
 * handlers stay thin.
 */
import { z } from "zod";

import { serviceCategories } from "./appointment";
import { paginationSchema, queryBoolean, uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO date `YYYY-MM-DD`. */
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Дата в формате YYYY-MM-DD");

/** Postgres `time` literal: `HH:MM` or `HH:MM:SS`, 24-hour. */
const timeSchema = z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u, "Время в формате HH:MM или HH:MM:SS");

function timeToMinutes(hms: string): number {
    const [h, m] = hms.split(":").map(Number);
    return h * 60 + m;
}

const breakSchema = z
    .object({
        start: timeSchema,
        end: timeSchema,
    })
    .strict()
    .refine((b) => timeToMinutes(b.end) > timeToMinutes(b.start), {
        message: "Конец перерыва должен быть позже начала",
    });

// ---------------------------------------------------------------------------
// Service catalogue (`serviceCategories` enum is shared with the public
// booking schema in `appointment.ts`).
// ---------------------------------------------------------------------------

const serviceHandleSchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: латиница, цифры и дефис");

const serviceSubcategorySchema = z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-z0-9_]+$/u, "Машинное имя: латиница, цифры, подчёркивание");

export const adminListServicesQuerySchema = paginationSchema.extend({
    category: z.enum(serviceCategories).optional(),
    subcategory: serviceSubcategorySchema.optional(),
    isActive: queryBoolean.optional(),
    search: z.string().trim().max(200).optional(),
    sort: z.enum(["sortOrder", "newest", "oldest", "price"]).default("sortOrder"),
});
export type AdminListServicesQuery = z.infer<typeof adminListServicesQuerySchema>;

export const createServiceSchema = z
    .object({
        name: z.string().trim().min(1).max(200),
        handle: serviceHandleSchema,
        category: z.enum(serviceCategories),
        subcategory: serviceSubcategorySchema.nullable().optional(),
        description: z.string().trim().max(4_000).nullable().optional(),
        durationMinutes: z.coerce.number().int().min(5).max(480),
        priceFrom: z.coerce.number().int().min(0),
        priceTo: z.coerce.number().int().min(0).nullable().optional(),
        currencyCode: z.string().trim().toLowerCase().length(3).optional(),
        priceNote: z.string().trim().max(500).nullable().optional(),
        jewelryIncluded: z.boolean().optional(),
        requiresConsultation: z.boolean().optional(),
        minimumAge: z.coerce.number().int().min(0).max(120).optional(),
        healingTimeMinWeeks: z.coerce.number().int().min(0).max(520).nullable().optional(),
        healingTimeMaxWeeks: z.coerce.number().int().min(0).max(520).nullable().optional(),
        compatibleJewelryTypes: z.string().trim().max(500).nullable().optional(),
        imageUrl: z.string().url().max(512).nullable().optional(),
        sortOrder: z.coerce.number().int().optional(),
        isActive: z.boolean().optional(),
    })
    .refine((v) => v.priceTo == null || v.priceTo >= v.priceFrom, {
        message: "priceTo должен быть >= priceFrom",
        path: ["priceTo"],
    })
    .refine(
        (v) =>
            v.healingTimeMinWeeks == null ||
            v.healingTimeMaxWeeks == null ||
            v.healingTimeMaxWeeks >= v.healingTimeMinWeeks,
        {
            message: "healingTimeMaxWeeks должен быть >= healingTimeMinWeeks",
            path: ["healingTimeMaxWeeks"],
        }
    );
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

/**
 * Patch-friendly variant: each field optional, no whole-object refines (the
 * route merges the patch with the existing row before re-validating cross-
 * field rules).
 */
export const updateServiceSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    handle: serviceHandleSchema.optional(),
    category: z.enum(serviceCategories).optional(),
    subcategory: serviceSubcategorySchema.nullable().optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
    priceFrom: z.coerce.number().int().min(0).optional(),
    priceTo: z.coerce.number().int().min(0).nullable().optional(),
    currencyCode: z.string().trim().toLowerCase().length(3).optional(),
    priceNote: z.string().trim().max(500).nullable().optional(),
    jewelryIncluded: z.boolean().optional(),
    requiresConsultation: z.boolean().optional(),
    minimumAge: z.coerce.number().int().min(0).max(120).optional(),
    healingTimeMinWeeks: z.coerce.number().int().min(0).max(520).nullable().optional(),
    healingTimeMaxWeeks: z.coerce.number().int().min(0).max(520).nullable().optional(),
    compatibleJewelryTypes: z.string().trim().max(500).nullable().optional(),
    imageUrl: z.string().url().max(512).nullable().optional(),
    sortOrder: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
});
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

// ---------------------------------------------------------------------------
// Piercer profile (singleton — PATCH only)
// ---------------------------------------------------------------------------
export const updatePiercerProfileSchema = z.object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    title: z.string().trim().max(100).nullable().optional(),
    bio: z.string().trim().max(8_000).nullable().optional(),
    avatarUrl: z.string().url().max(512).nullable().optional(),
    bannerUrl: z.string().url().max(512).nullable().optional(),
    experienceYears: z.coerce.number().int().min(0).max(80).nullable().optional(),
    specializations: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    certifications: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    socialInstagram: z.string().trim().max(255).nullable().optional(),
    socialTiktok: z.string().trim().max(255).nullable().optional(),
    socialTelegram: z.string().trim().max(255).nullable().optional(),
});
export type UpdatePiercerProfileInput = z.infer<typeof updatePiercerProfileSchema>;

// ---------------------------------------------------------------------------
// Weekly schedule (7-row table, unique by day_of_week)
// ---------------------------------------------------------------------------

/** Single weekday entry. When `isWorking=true`, both times are required. */
export const weeklyDayScheduleSchema = z
    .object({
        dayOfWeek: z.coerce.number().int().min(0).max(6),
        isWorking: z.boolean(),
        startTime: timeSchema.nullable().optional(),
        endTime: timeSchema.nullable().optional(),
        breaks: z.array(breakSchema).max(10).optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
        if (!v.isWorking) return;

        if (!v.startTime || !v.endTime) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Рабочий день требует startTime и endTime",
                path: ["startTime"],
            });
            return;
        }

        const ws = timeToMinutes(v.startTime);
        const we = timeToMinutes(v.endTime);
        if (we <= ws) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "endTime должен быть позже startTime",
                path: ["endTime"],
            });
            return;
        }

        // Each break must lie inside [startTime, endTime].
        for (let i = 0; i < (v.breaks?.length ?? 0); i += 1) {
            const b = v.breaks![i];
            const bs = timeToMinutes(b.start);
            const be = timeToMinutes(b.end);
            if (bs < ws || be > we) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Перерыв ${i} выходит за рамки рабочего дня`,
                    path: ["breaks", i],
                });
            }
        }

        // Sorted breaks must not overlap.
        const sorted = [...(v.breaks ?? [])]
            .map((b) => ({ s: timeToMinutes(b.start), e: timeToMinutes(b.end) }))
            .sort((a, b) => a.s - b.s);
        for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i].s < sorted[i - 1].e) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Перерывы пересекаются",
                    path: ["breaks"],
                });
                break;
            }
        }
    });
export type WeeklyDayScheduleInput = z.infer<typeof weeklyDayScheduleSchema>;

export const replaceWeeklyScheduleSchema = z
    .object({
        days: z.array(weeklyDayScheduleSchema).min(1).max(7),
    })
    .refine(
        (v) => {
            const set = new Set(v.days.map((d) => d.dayOfWeek));
            return set.size === v.days.length;
        },
        { message: "Дублирующиеся dayOfWeek", path: ["days"] }
    );
export type ReplaceWeeklyScheduleInput = z.infer<typeof replaceWeeklyScheduleSchema>;

// ---------------------------------------------------------------------------
// Schedule exceptions (per-date overrides)
// ---------------------------------------------------------------------------
export const adminListScheduleExceptionsQuerySchema = paginationSchema.extend({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    isWorking: queryBoolean.optional(),
});
export type AdminListScheduleExceptionsQuery = z.infer<
    typeof adminListScheduleExceptionsQuerySchema
>;

export const createScheduleExceptionSchema = z
    .object({
        date: isoDateSchema,
        isWorking: z.boolean(),
        startTime: timeSchema.nullable().optional(),
        endTime: timeSchema.nullable().optional(),
        reason: z.string().trim().max(255).nullable().optional(),
    })
    .superRefine((v, ctx) => {
        if (!v.isWorking) return;
        if (!v.startTime || !v.endTime) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Рабочее исключение требует startTime и endTime",
                path: ["startTime"],
            });
            return;
        }
        if (timeToMinutes(v.endTime) <= timeToMinutes(v.startTime)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "endTime должен быть позже startTime",
                path: ["endTime"],
            });
        }
    });
export type CreateScheduleExceptionInput = z.infer<typeof createScheduleExceptionSchema>;

/** PATCH: each field optional; cross-field re-validated after merge. */
export const updateScheduleExceptionSchema = z.object({
    date: isoDateSchema.optional(),
    isWorking: z.boolean().optional(),
    startTime: timeSchema.nullable().optional(),
    endTime: timeSchema.nullable().optional(),
    reason: z.string().trim().max(255).nullable().optional(),
});
export type UpdateScheduleExceptionInput = z.infer<typeof updateScheduleExceptionSchema>;

// ---------------------------------------------------------------------------
// Time blocks (one-off blocked sub-windows on a date)
// ---------------------------------------------------------------------------
export const adminListTimeBlocksQuerySchema = paginationSchema.extend({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    /** Filter by exact date, ignored if from/to is set. */
    date: isoDateSchema.optional(),
});
export type AdminListTimeBlocksQuery = z.infer<typeof adminListTimeBlocksQuerySchema>;

export const createTimeBlockSchema = z
    .object({
        date: isoDateSchema,
        startTime: timeSchema,
        endTime: timeSchema,
        reason: z.string().trim().max(255).nullable().optional(),
    })
    .refine((v) => timeToMinutes(v.endTime) > timeToMinutes(v.startTime), {
        message: "endTime должен быть позже startTime",
        path: ["endTime"],
    });
export type CreateTimeBlockInput = z.infer<typeof createTimeBlockSchema>;

export const updateTimeBlockSchema = z.object({
    date: isoDateSchema.optional(),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    reason: z.string().trim().max(255).nullable().optional(),
});
export type UpdateTimeBlockInput = z.infer<typeof updateTimeBlockSchema>;

// Re-export for parity with other modules.
export { uuidSchema };
