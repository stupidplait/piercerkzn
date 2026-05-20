/**
 * GET /api/booking/appointments/[id]
 *
 * Returns a single appointment with its services + jewelry attached. The
 * caller must either own the appointment (matching `customerId`) or be an
 * admin/staff session.
 */
import { eq } from "drizzle-orm";

import { forbidden, internal, notFound, ok, requireUser } from "@/lib/api";
import {
    appointments,
    appointmentJewelry,
    appointmentServices,
    db,
    productVariants,
    services as servicesTable,
} from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    try {
        const [row] = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
        if (!row) return notFound("Запись не найдена");

        const isOwner = !!sess.customerId && row.customerId === sess.customerId;
        const isAdmin = sess.role === "admin" || sess.role === "staff";
        if (!isOwner && !isAdmin) return forbidden("Это не ваша запись");

        const [serviceRows, jewelryRows] = await Promise.all([
            db
                .select({
                    id: appointmentServices.id,
                    serviceId: appointmentServices.serviceId,
                    name: servicesTable.name,
                    price: appointmentServices.price,
                    durationMinutes: appointmentServices.durationMinutes,
                })
                .from(appointmentServices)
                .innerJoin(servicesTable, eq(servicesTable.id, appointmentServices.serviceId))
                .where(eq(appointmentServices.appointmentId, row.id)),
            db
                .select({
                    id: appointmentJewelry.id,
                    variantId: appointmentJewelry.variantId,
                    sku: productVariants.sku,
                    title: productVariants.title,
                    piercingPoint: appointmentJewelry.piercingPoint,
                    source: appointmentJewelry.source,
                    price: appointmentJewelry.price,
                })
                .from(appointmentJewelry)
                .leftJoin(productVariants, eq(productVariants.id, appointmentJewelry.variantId))
                .where(eq(appointmentJewelry.appointmentId, row.id)),
        ]);

        return ok({
            appointment: {
                id: row.id,
                referenceNumber: row.referenceNumber,
                status: row.status,
                date: row.date,
                timeStart: row.timeStart,
                timeEnd: row.timeEnd,
                totalDurationMin: row.totalDurationMin,
                estimatedTotal: row.estimatedTotal,
                customer: {
                    id: row.customerId,
                    firstName: row.customerFirstName,
                    lastName: row.customerLastName,
                    email: row.customerEmail,
                    phone: row.customerPhone,
                    dateOfBirth: row.customerDob,
                },
                customerNotes: row.customerNotes,
                // Internal notes are admin-only — strip for owners.
                internalNotes: isAdmin ? row.internalNotes : null,
                completionNotes: row.completionNotes,
                services: serviceRows,
                jewelry: jewelryRows,
                waiverId: row.waiverId,
                reservationId: row.reservationId,
                metadata: row.metadata,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                cancelledAt: row.cancelledAt,
                completedAt: row.completedAt,
            },
        });
    } catch (error) {
        console.error("[/api/booking/appointments/:id GET] failed", error);
        return internal();
    }
}
