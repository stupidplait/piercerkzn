/**
 * POST /api/looks/[handle]/reserve-all
 *
 * Reserves every variant in a curated look in a single atomic transaction
 * via `createReservation()`. The customer is identified either from the
 * authenticated session or from the `customer` payload in the request body
 * (mirrors `POST /api/reservations`).
 *
 * Body (same as plain reservations create, minus `items`):
 *   {
 *     customer: { firstName, lastName?, email, phone, dateOfBirth? },
 *     notes?: string,
 *     createAccount?: boolean
 *   }
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
    applyRateLimit,
    created,
    fail,
    getOptionalUser,
    internal,
    notFound,
    parseJson,
} from "@/lib/api";
import { curatedLooks, db, lookPieces, productVariants } from "@/db";
import { capture } from "@/lib/posthog";
import { createReservation, ReservationError } from "@/lib/reservations";
import { createReservationSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ handle: string }>;
}

// Body schema is the createReservationSchema MINUS `items` — those come
// from the look's pieces. We keep customer, notes, source, createAccount.
const reserveLookBodySchema = createReservationSchema.omit({ items: true, source: true }).extend({
    notes: z.string().trim().max(2_000).optional(),
});

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "reservation");
    if (limited) return limited;

    const { handle } = await ctx.params;

    const parsed = await parseJson(req, reserveLookBodySchema);
    if (!parsed.ok) return parsed.response!;
    const body = parsed.data!;

    const sessionUser = await getOptionalUser();

    try {
        const [look] = await db
            .select({
                id: curatedLooks.id,
                isPublished: curatedLooks.isPublished,
                handle: curatedLooks.handle,
            })
            .from(curatedLooks)
            .where(eq(curatedLooks.handle, handle))
            .limit(1);
        if (!look || !look.isPublished) return notFound("Сет не найден");

        const pieces = await db
            .select({
                variantId: productVariants.id,
                deletedAt: productVariants.deletedAt,
                piercingPointId: lookPieces.piercingPointId,
            })
            .from(lookPieces)
            .innerJoin(productVariants, eq(productVariants.id, lookPieces.variantId))
            .where(and(eq(lookPieces.lookId, look.id)))
            .orderBy(asc(lookPieces.sortOrder));

        if (pieces.length === 0 || pieces.some((p) => p.deletedAt !== null)) {
            return fail("look_unavailable", "Этот сет недоступен для брони", { status: 409 });
        }

        const items = pieces.map((p) => ({
            variantId: p.variantId,
            quantity: 1,
            metadata: {
                lookId: look.id,
                piercingPoint: p.piercingPointId,
            },
        }));

        const result = await createReservation(
            {
                items,
                customer: body.customer,
                notes: body.notes,
                source: "look",
                createAccount: body.createAccount,
            },
            { sessionCustomerId: sessionUser?.customerId }
        );

        capture({
            event: "look_reserved",
            distinctId: result.customer?.id ?? `email:${result.reservation.customerEmail}`,
            properties: {
                reservation_id: result.reservation.id,
                reference_number: result.reservation.referenceNumber,
                look_handle: look.handle,
                piece_count: items.length,
            },
        });

        return created({
            reservation: {
                id: result.reservation.id,
                referenceNumber: result.reservation.referenceNumber,
                status: result.reservation.status,
                total: result.reservation.total,
                expiresAt: result.reservation.expiresAt,
                items: result.items.map((i) => ({
                    id: i.id,
                    title: i.title,
                    variantTitle: i.variantTitle,
                    quantity: i.quantity,
                    total: i.total,
                })),
                customerCreated: result.customerCreated,
            },
            look: { id: look.id, handle: look.handle },
        });
    } catch (error) {
        if (error instanceof ReservationError) {
            const status = error.code === "out_of_stock" ? 409 : 400;
            return fail(error.code, error.message, { status });
        }
        console.error("[/api/looks/:handle/reserve-all] failed", error);
        return internal();
    }
}
