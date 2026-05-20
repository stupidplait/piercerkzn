/**
 * Review helpers — small, route-handler-friendly primitives.
 *
 * `isVerifiedStudioClient(customerId)` resolves whether a customer has
 * actually visited the studio (has at least one `picked_up` reservation OR
 * one `completed` appointment). Used to:
 *
 *   1. Gate `POST /api/products/:handle/reviews` (only verified clients may
 *      submit; admin moderation still applies before public visibility).
 *   2. Set `review.is_verified_client` so the storefront can render a
 *      "Подтверждённый клиент" badge.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { appointments, db, reservations } from "@/db";

export async function isVerifiedStudioClient(customerId: string): Promise<boolean> {
    const [pickedUp] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.customerId, customerId), eq(reservations.status, "picked_up")))
        .limit(1);
    if (pickedUp) return true;

    const [completed] = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.customerId, customerId), eq(appointments.status, "completed")))
        .limit(1);
    return Boolean(completed);
}
