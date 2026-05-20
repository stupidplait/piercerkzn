/**
 * /api/admin/schedule/exceptions/[id]
 *
 *   GET    — single exception.
 *   PATCH  — partial update. Cross-field rule (`endTime > startTime` when
 *            `isWorking=true`) re-checked after merging the patch.
 *   DELETE — hard delete.
 */
import { eq } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    notFound,
    ok,
    parseJson,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, scheduleExceptions } from "@/db";
import { updateScheduleExceptionSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

function timeToMinutes(hms: string | null): number | null {
    if (!hms) return null;
    const [h, m] = hms.split(":").map(Number);
    return h * 60 + m;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [row] = await db
            .select()
            .from(scheduleExceptions)
            .where(eq(scheduleExceptions.id, id))
            .limit(1);
        if (!row) return notFound("Исключение не найдено");
        return ok({ exception: row });
    } catch (error) {
        console.error("[/api/admin/schedule/exceptions/:id GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateScheduleExceptionSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select()
            .from(scheduleExceptions)
            .where(eq(scheduleExceptions.id, id))
            .limit(1);
        if (!existing) return notFound("Исключение не найдено");

        // Merge incoming patch with existing values for cross-field validation.
        const merged = {
            isWorking: input.isWorking !== undefined ? input.isWorking : existing.isWorking,
            startTime: input.startTime !== undefined ? input.startTime : existing.startTime,
            endTime: input.endTime !== undefined ? input.endTime : existing.endTime,
        };
        if (merged.isWorking) {
            if (!merged.startTime || !merged.endTime) {
                return fail("missing_time", "Рабочее исключение требует startTime и endTime", {
                    status: 400,
                });
            }
            const s = timeToMinutes(merged.startTime)!;
            const e = timeToMinutes(merged.endTime)!;
            if (e <= s) {
                return fail("end_before_start", "endTime должен быть позже startTime", {
                    status: 400,
                });
            }
        }

        const patch: Partial<typeof scheduleExceptions.$inferInsert> = {};
        if (input.date !== undefined) patch.date = input.date;
        if (input.isWorking !== undefined) {
            patch.isWorking = input.isWorking;
            // Clear times on transition to non-working day to avoid stale data.
            if (!input.isWorking) {
                patch.startTime = null;
                patch.endTime = null;
            }
        }
        if (input.startTime !== undefined && merged.isWorking) patch.startTime = input.startTime;
        if (input.endTime !== undefined && merged.isWorking) patch.endTime = input.endTime;
        if (input.reason !== undefined) patch.reason = input.reason;

        const [updated] = await db
            .update(scheduleExceptions)
            .set(patch)
            .where(eq(scheduleExceptions.id, id))
            .returning();

        return ok({ exception: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("exception_exists", "Для этой даты уже есть исключение", {
                status: 409,
            });
        }
        console.error("[/api/admin/schedule/exceptions/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [existing] = await db
            .select({ id: scheduleExceptions.id })
            .from(scheduleExceptions)
            .where(eq(scheduleExceptions.id, id))
            .limit(1);
        if (!existing) return notFound("Исключение не найдено");

        await db.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/schedule/exceptions/:id DELETE] failed", error);
        return internal();
    }
}
