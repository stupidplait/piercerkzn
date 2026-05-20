/**
 * GET /api/reservations/[id] — fetch one reservation by id.
 *
 * Authorization:
 *   - The owning customer (matched via session.customerId)
 *   - The studio admin/staff
 *   - A request supplying `?ref=PK-RES-…` matching the row's reference number
 *     (for unauthenticated guests who got an email confirmation link)
 */
import { eq } from "drizzle-orm";

import { forbidden, getOptionalUser, internal, notFound, ok } from "@/lib/api";
import { db, reservationItems, reservations } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const refToken = url.searchParams.get("ref");

    try {
        const [reservation] = await db
            .select()
            .from(reservations)
            .where(eq(reservations.id, id))
            .limit(1);

        if (!reservation) return notFound("Бронь не найдена");

        const sessionUser = await getOptionalUser();
        const isOwner =
            sessionUser?.customerId && reservation.customerId === sessionUser.customerId;
        const isAdmin = sessionUser?.role === "admin" || sessionUser?.role === "staff";
        const isRefHolder = refToken && refToken === reservation.referenceNumber;

        if (!isOwner && !isAdmin && !isRefHolder) {
            return forbidden();
        }

        const items = await db
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, reservation.id));

        return ok({
            reservation: {
                id: reservation.id,
                referenceNumber: reservation.referenceNumber,
                status: reservation.status,
                total: reservation.total,
                currencyCode: reservation.currencyCode,
                expiresAt: reservation.expiresAt,
                customerNotes: reservation.customerNotes,
                createdAt: reservation.createdAt,
                confirmedAt: reservation.confirmedAt,
                pickedUpAt: reservation.pickedUpAt,
                cancelledAt: reservation.cancelledAt,
                expiredAt: reservation.expiredAt,
                customer: {
                    firstName: reservation.customerFirstName,
                    lastName: reservation.customerLastName,
                    email: reservation.customerEmail,
                    phone: reservation.customerPhone,
                },
                items: items.map((i) => ({
                    id: i.id,
                    title: i.title,
                    variantTitle: i.variantTitle,
                    sku: i.sku,
                    thumbnailUrl: i.thumbnailUrl,
                    unitPrice: i.unitPrice,
                    quantity: i.quantity,
                    total: i.total,
                    metadata: i.metadata,
                })),
            },
        });
    } catch (error) {
        console.error("[/api/reservations/[id]] failed", error);
        return internal();
    }
}
