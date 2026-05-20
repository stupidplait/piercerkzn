/**
 * /api/admin/body-models/[id]
 *
 *   GET    — full detail incl. anchor count (no anchor list — use ./anchors).
 *   PATCH  — partial update.
 *   DELETE — soft (default: sets isActive=false) or hard with ?hard=true
 *            (cascades to piercing_point via FK).
 */
import { eq, sql } from "drizzle-orm";

import { applyRateLimit, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { bodyModels, db, piercingPoints } from "@/db";
import { updateBodyModelSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [model] = await db.select().from(bodyModels).where(eq(bodyModels.id, id)).limit(1);
        if (!model) return notFound("Модель не найдена");

        const [{ anchorCount }] = await db
            .select({ anchorCount: sql<number>`count(*)::int` })
            .from(piercingPoints)
            .where(eq(piercingPoints.bodyModelId, id));

        return ok({ bodyModel: { ...model, anchorCount } });
    } catch (error) {
        console.error("[/api/admin/body-models/:id GET] failed", error);
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

    const parsed = await parseJson(req, updateBodyModelSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: bodyModels.id })
            .from(bodyModels)
            .where(eq(bodyModels.id, id))
            .limit(1);
        if (!existing) return notFound("Модель не найдена");

        const patch: Partial<typeof bodyModels.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.area !== undefined) patch.area = input.area;
        if (input.side !== undefined) patch.side = input.side;
        if (input.modelUrl !== undefined) patch.modelUrl = input.modelUrl;
        if (input.modelUrlLod1 !== undefined) patch.modelUrlLod1 = input.modelUrlLod1;
        if (input.modelUrlLod2 !== undefined) patch.modelUrlLod2 = input.modelUrlLod2;
        if (input.thumbnailUrl !== undefined) patch.thumbnailUrl = input.thumbnailUrl;
        if (input.polygonCount !== undefined) patch.polygonCount = input.polygonCount;
        if (input.fileSizeBytes !== undefined) patch.fileSizeBytes = input.fileSizeBytes;
        if (input.cameraDefaults !== undefined) patch.cameraDefaults = input.cameraDefaults;
        if (input.skinTextures !== undefined) patch.skinTextures = input.skinTextures;
        if (input.version !== undefined) patch.version = input.version;
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        const [updated] = await db
            .update(bodyModels)
            .set(patch)
            .where(eq(bodyModels.id, id))
            .returning();

        return ok({ bodyModel: updated });
    } catch (error) {
        console.error("[/api/admin/body-models/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "true";

    try {
        const [existing] = await db
            .select({ id: bodyModels.id, isActive: bodyModels.isActive })
            .from(bodyModels)
            .where(eq(bodyModels.id, id))
            .limit(1);
        if (!existing) return notFound("Модель не найдена");

        if (hard) {
            await db.delete(bodyModels).where(eq(bodyModels.id, id));
            return ok({ deleted: true, mode: "hard" });
        }

        if (existing.isActive === false) {
            return ok({ deleted: true, mode: "soft", alreadyInactive: true });
        }

        const [updated] = await db
            .update(bodyModels)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(bodyModels.id, id))
            .returning({ id: bodyModels.id, isActive: bodyModels.isActive });

        return ok({ deleted: true, mode: "soft", bodyModel: updated });
    } catch (error) {
        console.error("[/api/admin/body-models/:id DELETE] failed", error);
        return internal();
    }
}
