/**
 * /api/admin/schedule/exceptions
 *
 *   GET  — list per-date schedule overrides (filterable by date range and
 *          isWorking flag).
 *   POST — create. The DB enforces `date` uniqueness; we pre-flight that
 *          and fall back to a clean 409 on the 23505 race.
 */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    ok,
    parseJson,
    parseQuery,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, scheduleExceptions } from "@/db";
import {
    adminListScheduleExceptionsQuerySchema,
    createScheduleExceptionSchema,
} from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListScheduleExceptionsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.from) filters.push(gte(scheduleExceptions.date, q.from));
        if (q.to) filters.push(lte(scheduleExceptions.date, q.to));
        if (q.isWorking !== undefined) filters.push(eq(scheduleExceptions.isWorking, q.isWorking));
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db.select().from(scheduleExceptions);
        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(asc(scheduleExceptions.date))
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db
            .select({ total: sql<number>`count(*)::int` })
            .from(scheduleExceptions);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            exceptions: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/schedule/exceptions GET] failed", error);
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

    const parsed = await parseJson(req, createScheduleExceptionSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: scheduleExceptions.id })
            .from(scheduleExceptions)
            .where(eq(scheduleExceptions.date, input.date))
            .limit(1);
        if (existing) {
            return fail("exception_exists", "Для этой даты уже есть исключение — обновите его", {
                status: 409,
            });
        }

        const [created] = await db
            .insert(scheduleExceptions)
            .values({
                date: input.date,
                isWorking: input.isWorking,
                startTime: input.isWorking ? (input.startTime ?? null) : null,
                endTime: input.isWorking ? (input.endTime ?? null) : null,
                reason: input.reason ?? null,
            })
            .returning();

        return ok({ exception: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("exception_exists", "Для этой даты уже есть исключение", {
                status: 409,
            });
        }
        console.error("[/api/admin/schedule/exceptions POST] failed", error);
        return internal();
    }
}
