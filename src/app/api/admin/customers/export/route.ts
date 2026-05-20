/**
 * GET /api/admin/customers/export — CSV download. Same filters as the list
 * endpoint. Capped at 10,000 rows per export.
 */
import { and, asc, desc, ilike, isNull, or } from "drizzle-orm";

import { internal, parseQuery, requireAdmin } from "@/lib/api";
import { csvResponse, rowsToCsv } from "@/lib/admin/csv";
import { customers, db } from "@/db";
import { listAdminCustomersQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXPORT_ROWS = 10_000;

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAdminCustomersQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (!q.includeDeleted) filters.push(isNull(customers.deletedAt));
        if (q.q) {
            const like = `%${q.q}%`;
            filters.push(
                or(
                    ilike(customers.email, like),
                    ilike(customers.phone, like),
                    ilike(customers.firstName, like),
                    ilike(customers.lastName, like)
                )!
            );
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy =
            q.sort === "oldest"
                ? [asc(customers.createdAt)]
                : q.sort === "name"
                  ? [asc(customers.firstName), asc(customers.lastName)]
                  : [desc(customers.createdAt)];

        const baseQuery = db
            .select({
                id: customers.id,
                email: customers.email,
                firstName: customers.firstName,
                lastName: customers.lastName,
                phone: customers.phone,
                dateOfBirth: customers.dateOfBirth,
                createdAt: customers.createdAt,
                deletedAt: customers.deletedAt,
                oauthProvider: customers.oauthProvider,
            })
            .from(customers);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(MAX_EXPORT_ROWS);

        const csv = rowsToCsv(rows, [
            { header: "id", value: (r) => r.id },
            { header: "email", value: (r) => r.email },
            { header: "first_name", value: (r) => r.firstName },
            { header: "last_name", value: (r) => r.lastName },
            { header: "phone", value: (r) => r.phone },
            { header: "date_of_birth", value: (r) => r.dateOfBirth },
            { header: "oauth_provider", value: (r) => r.oauthProvider },
            { header: "created_at", value: (r) => r.createdAt },
            { header: "deleted_at", value: (r) => r.deletedAt },
        ]);

        const stamp = new Date().toISOString().slice(0, 10);
        return csvResponse(`customers-${stamp}.csv`, csv);
    } catch (error) {
        console.error("[/api/admin/customers/export] failed", error);
        return internal();
    }
}
