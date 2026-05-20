/**
 * GET /api/admin/customers — paginated customer list with search and sort.
 *
 * Search (`q`) is a case-insensitive prefix-anywhere match across email, phone,
 * first name, and last name. Soft-deleted customers are hidden by default;
 * pass `includeDeleted=1` to surface them.
 */
import { and, asc, desc, ilike, isNull, or, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { customers, db } from "@/db";
import { listAdminCustomersQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
                createdAt: customers.createdAt,
                deletedAt: customers.deletedAt,
                oauthProvider: customers.oauthProvider,
            })
            .from(customers);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(customers);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            customers: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/customers GET] failed", error);
        return internal();
    }
}
