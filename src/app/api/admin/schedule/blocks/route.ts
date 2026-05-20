/**
 * /api/admin/schedule/blocks
 *
 *   GET  — list one-off time blocks (filterable by exact date or date range).
 *   POST — create. Multiple blocks per date are allowed; overlap detection
 *          is intentionally NOT enforced here — the availability route
 *          unions blocks anyway, so two overlapping blocks are merely a
 *          no-op for the booking math.
 */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import { applyRateLimit, internal, ok, parseJson, parseQuery, requireAdmin } from "@/lib/api";
import { db, timeBlocks } from "@/db";
import { adminListTimeBlocksQuerySchema, createTimeBlockSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListTimeBlocksQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.from) filters.push(gte(timeBlocks.date, q.from));
        if (q.to) filters.push(lte(timeBlocks.date, q.to));
        // `date` only takes effect when the range form is absent (matches the
        // schema comment).
        if (!q.from && !q.to && q.date) filters.push(eq(timeBlocks.date, q.date));
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db.select().from(timeBlocks);
        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(asc(timeBlocks.date), asc(timeBlocks.startTime))
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(timeBlocks);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            blocks: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/schedule/blocks GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createTimeBlockSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [created] = await db
            .insert(timeBlocks)
            .values({
                date: input.date,
                startTime: input.startTime,
                endTime: input.endTime,
                reason: input.reason ?? null,
            })
            .returning();

        return ok({ block: created }, { status: 201 });
    } catch (error) {
        console.error("[/api/admin/schedule/blocks POST] failed", error);
        return internal();
    }
}
