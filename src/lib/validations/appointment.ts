/**
 * Appointment / booking validation. Mirrors `docs/04_BACKEND_ENDPOINTS.md` §§7–11.
 */
import { z } from "zod";
import {
    emailSchema,
    isoDateSchema,
    nameSchema,
    phoneSchema,
    paginationSchema,
    timeSchema,
    uuidSchema,
} from "./common";

// ---------------------------------------------------------------------------
// Services — list / get
// ---------------------------------------------------------------------------
export const serviceCategories = [
    "new_piercing",
    "jewelry_change",
    "consultation",
    "checkup",
    "downsize",
] as const;

export const listServicesQuerySchema = paginationSchema.extend({
    category: z.enum(serviceCategories).optional(),
    subcategory: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[a-z_]+$/u)
        .optional(),
});
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;

// ---------------------------------------------------------------------------
// Piercer — portfolio query
// ---------------------------------------------------------------------------
export const piercerPortfolioQuerySchema = paginationSchema.extend({
    piercingType: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[a-z_]+$/u)
        .optional(),
});
export type PiercerPortfolioQuery = z.infer<typeof piercerPortfolioQuerySchema>;

// ---------------------------------------------------------------------------
// Piercer — reviews query
// ---------------------------------------------------------------------------
export const piercerReviewsSortValues = ["newest", "rating_desc", "rating_asc"] as const;

export const piercerReviewsQuerySchema = paginationSchema.extend({
    sort: z.enum(piercerReviewsSortValues).default("newest"),
});
export type PiercerReviewsQuery = z.infer<typeof piercerReviewsQuerySchema>;

const appointmentJewelrySchema = z.object({
    serviceId: uuidSchema,
    variantId: uuidSchema.optional(),
    fromVisualizerLook: uuidSchema.optional(),
});

export const bookAppointmentSchema = z.object({
    serviceIds: z.array(uuidSchema).min(1).max(5),
    date: isoDateSchema,
    time: timeSchema,
    customer: z.object({
        firstName: nameSchema,
        lastName: nameSchema.optional(),
        email: emailSchema,
        phone: phoneSchema,
        dateOfBirth: isoDateSchema.optional(),
    }),
    selectedJewelry: z.array(appointmentJewelrySchema).max(5).optional(),
    notes: z.string().trim().max(2_000).optional(),
    waiverSigned: z.literal(true, { message: "Необходимо подписать соглашение" }),
    /** Base64-encoded signature image — uploaded to R2 by the action. */
    waiverSignatureData: z.string().min(1).max(2_000_000),
    createAccount: z.boolean().optional(),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const appointmentStatuses = [
    "pending",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const updateAppointmentStatusSchema = z.object({
    status: z.enum(appointmentStatuses),
    notes: z.string().trim().max(2_000).optional(),
    sendAftercareEmail: z.boolean().optional(),
    actualJewelryUsed: z
        .array(
            z.object({
                variantId: uuidSchema,
                piercingPoint: z.string().max(80),
            })
        )
        .optional(),
});
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;

export const availabilityQuerySchema = z.object({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    serviceIds: z.array(uuidSchema).max(5).optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/**
 * URL-friendly variant of `availabilityQuerySchema`. Accepts `serviceIds` as
 * a comma-separated string (`?serviceIds=a,b`) since query params are flat.
 */
export const availabilityRouteQuerySchema = z.object({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    serviceIds: z
        .string()
        .trim()
        .optional()
        .transform((v) =>
            v
                ? v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                : []
        )
        .pipe(z.array(uuidSchema).max(5)),
});
export type AvailabilityRouteQuery = z.infer<typeof availabilityRouteQuerySchema>;

// ---------------------------------------------------------------------------
// Appointment list / reschedule / cancel
// ---------------------------------------------------------------------------
export const listAppointmentsQuerySchema = z.object({
    /** `upcoming` (default) shows pending+confirmed; `past` shows completed/cancelled/no_show. */
    filter: z.enum(["upcoming", "past", "all"]).default("upcoming"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const rescheduleAppointmentSchema = z.object({
    date: isoDateSchema,
    time: timeSchema,
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const completeAppointmentSchema = z.object({
    /** Free-form note recorded on `appointment.completion_notes`. */
    completionNotes: z.string().trim().max(2000).optional(),
    /**
     * Override of the piercing type used to create the `aftercare_tracking`
     * row. If omitted, we derive it from the first service's `subcategory`,
     * falling back to `'general'`.
     */
    piercingType: z.string().trim().min(1).max(50).optional(),
});
export type CompleteAppointmentInput = z.infer<typeof completeAppointmentSchema>;
