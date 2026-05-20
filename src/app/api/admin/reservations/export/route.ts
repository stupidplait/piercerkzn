/**
 * GET /api/admin/reservations/export — CSV download with the same filters as
 * `/api/admin/reservations`. Capped at 5,000 rows per export.
 */
import { and, asc, between, desc, eq, ilike, or, sql } from "drizzle-orm";

import { internal, parseQuery, requireAdmin } from "@/lib/api";
import { csvResponse, rowsToCsv } from "@/lib/admin/csv";
import { db, reservations } from "@/db";
import { listAdminReservationsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXPORT_ROWS = 5_000;

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAdminReservationsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.status) filters.push(eq(reservations.status, q.status));
        if (q.q) {
            const like = `%${q.q}%`;
            filters.push(
                or(
                    ilike(reservations.referenceNumber, like),
                    ilike(reservations.customerEmail, like),
                    ilike(reservations.customerPhone, like)
                )!
            );
        }
        if (q.from && q.to) {
            filters.push(
                between(reservations.createdAt, new Date(q.from), new Date(`${q.to}T23:59:59Z`))
            );
        } else if (q.from) {
            filters.push(sql`${reservations.createdAt} >= ${new Date(q.from)}`);
        } else if (q.to) {
            filters.push(sql`${reservations.createdAt} <= ${new Date(`${q.to}T23:59:59Z`)}`);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy =
            q.sort === "expiring"
                ? [asc(reservations.expiresAt)]
                : q.sort === "oldest"
                  ? [asc(reservations.createdAt)]
                  : [desc(reservations.createdAt)];

        const baseQuery = db
            .select({
                referenceNumber: reservations.referenceNumber,
                status: reservations.status,
                total: reservations.total,
                customerEmail: reservations.customerEmail,
                customerPhone: reservations.customerPhone,
                customerFirstName: reservations.customerFirstName,
                customerLastName: reservations.customerLastName,
                createdAt: reservations.createdAt,
                expiresAt: reservations.expiresAt,
                pickedUpAt: reservations.pickedUpAt,
                cancelledAt: reservations.cancelledAt,
            })
            .from(reservations);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(MAX_EXPORT_ROWS);

        const csv = rowsToCsv(rows, [
            { header: "reference", value: (r) => r.referenceNumber },
            { header: "status", value: (r) => r.status },
            { header: "total_kopecks", value: (r) => r.total },
            { header: "customer_first_name", value: (r) => r.customerFirstName },
            { header: "customer_last_name", value: (r) => r.customerLastName },
            { header: "customer_email", value: (r) => r.customerEmail },
            { header: "customer_phone", value: (r) => r.customerPhone },
            { header: "created_at", value: (r) => r.createdAt },
            { header: "expires_at", value: (r) => r.expiresAt },
            { header: "picked_up_at", value: (r) => r.pickedUpAt },
            { header: "cancelled_at", value: (r) => r.cancelledAt },
        ]);

        const stamp = new Date().toISOString().slice(0, 10);
        return csvResponse(`reservations-${stamp}.csv`, csv);
    } catch (error) {
        console.error("[/api/admin/reservations/export] failed", error);
        return internal();
    }
}
