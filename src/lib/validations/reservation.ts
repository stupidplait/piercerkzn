/**
 * Reservation API validation. Mirrors `docs/04_BACKEND_ENDPOINTS.md` §5.
 *
 * Reservations are jewelry holds (no payment). The cart lives client-side
 * (Zustand + localStorage); only confirmed reservations hit the server.
 */
import { z } from "zod";
import { emailSchema, nameSchema, phoneSchema, uuidSchema } from "./common";

const reservationItemSchema = z.object({
    variantId: uuidSchema,
    quantity: z.number().int().min(1).max(10).default(1),
    metadata: z
        .object({
            fromVisualizer: z.boolean().optional(),
            lookId: uuidSchema.optional(),
            piercingPoint: z.string().max(80).optional(),
        })
        .optional(),
});
export type ReservationItemInput = z.infer<typeof reservationItemSchema>;

export const createReservationSchema = z.object({
    items: z.array(reservationItemSchema).min(1, "Выберите хотя бы одно украшение").max(20),
    customer: z.object({
        firstName: nameSchema,
        lastName: nameSchema.optional(),
        email: emailSchema,
        phone: phoneSchema,
    }),
    notes: z.string().trim().max(2_000).optional(),
    /** If true and the requester isn't authenticated, server creates a customer record. */
    createAccount: z.boolean().optional(),
    /** Optional source tag for analytics/funnel attribution. */
    source: z.enum(["catalog", "visualizer", "look", "telegram"]).optional(),
    /** hCaptcha / Turnstile token; verified server-side. Required per Req 2.4 / 10.1. */
    captchaToken: z.string().min(20).max(2_000),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

/** Status of a reservation, mirrors the DB enum. */
export const reservationStatuses = [
    "pending",
    "confirmed",
    "picked_up",
    "cancelled",
    "expired",
] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];

export const cancelReservationSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});
export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;
