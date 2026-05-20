/**
 * /api/admin/schedule/blocks/[id]
 *
 *   GET    — single time block.
 *   PATCH  — partial update. `endTime > startTime` re-checked on the merged
 *            row.
 *   DELETE — hard delete.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, timeBlocks } from "@/db";
import { updateTimeBlockSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

function timeToMinutes(hms: string): number {
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
        const [row] = await db.select().from(timeBlocks).where(eq(timeBlocks.id, id)).limit(1);
        if (!row) return notFound("Блокировка не найдена");
        return ok({ block: row });
    } catch (error) {
        console.error("[/api/admin/schedule/blocks/:id GET] failed", error);
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

    const parsed = await parseJson(req, updateTimeBlockSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db.select().from(timeBlocks).where(eq(timeBlocks.id, id)).limit(1);
        if (!existing) return notFound("Блокировка не найдена");

        const merged = {
            startTime: input.startTime !== undefined ? input.startTime : existing.startTime,
            endTime: input.endTime !== undefined ? input.endTime : existing.endTime,
        };
        if (timeToMinutes(merged.endTime) <= timeToMinutes(merged.startTime)) {
            return fail("end_before_start", "endTime должен быть позже startTime", {
                status: 400,
            });
        }

        const patch: Partial<typeof timeBlocks.$inferInsert> = {};
        if (input.date !== undefined) patch.date = input.date;
        if (input.startTime !== undefined) patch.startTime = input.startTime;
        if (input.endTime !== undefined) patch.endTime = input.endTime;
        if (input.reason !== undefined) patch.reason = input.reason;

        const [updated] = await db
            .update(timeBlocks)
            .set(patch)
            .where(eq(timeBlocks.id, id))
            .returning();

        return ok({ block: updated });
    } catch (error) {
        console.error("[/api/admin/schedule/blocks/:id PATCH] failed", error);
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
            .select({ id: timeBlocks.id })
            .from(timeBlocks)
            .where(eq(timeBlocks.id, id))
            .limit(1);
        if (!existing) return notFound("Блокировка не найдена");

        await db.delete(timeBlocks).where(eq(timeBlocks.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/schedule/blocks/:id DELETE] failed", error);
        return internal();
    }
}
