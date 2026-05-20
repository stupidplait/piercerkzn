/**
 * GET /api/admin/inquiries — paginated contact-form inbox.
 *
 * Filters: `status` (new | in_progress | resolved | closed), `q` (search
 * across reference, name, email, phone, subject, message). Default sort is
 * newest-first.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { db, inquiries } from "@/db";
import { listAdminInquiriesQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAdminInquiriesQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.status) filters.push(eq(inquiries.status, q.status));
        if (q.q) {
            const like = `%${q.q}%`;
            filters.push(
                or(
                    ilike(inquiries.referenceNumber, like),
                    ilike(inquiries.name, like),
                    ilike(inquiries.email, like),
                    ilike(inquiries.phone, like),
                    ilike(inquiries.subject, like),
                    ilike(inquiries.message, like)
                )!
            );
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy =
            q.sort === "oldest" ? [asc(inquiries.createdAt)] : [desc(inquiries.createdAt)];

        const baseQuery = db
            .select({
                id: inquiries.id,
                referenceNumber: inquiries.referenceNumber,
                name: inquiries.name,
                email: inquiries.email,
                phone: inquiries.phone,
                subject: inquiries.subject,
                status: inquiries.status,
                createdAt: inquiries.createdAt,
                resolvedAt: inquiries.resolvedAt,
            })
            .from(inquiries);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(inquiries);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            inquiries: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/inquiries GET] failed", error);
        return internal();
    }
}
