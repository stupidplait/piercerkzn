/**
 * /api/admin/body-models/[id]/anchors/[anchorId]
 *
 *   GET    — single anchor by id.
 *   PATCH  — partial update.
 *   DELETE — hard delete. Anchors are cheap to recreate from the editor, and
 *            historical references in appointments/looks don't FK-reference
 *            them, so soft-delete adds no value here.
 *
 * Mismatched parent-child pairs (anchor exists but belongs to a different
 * body model) return 404 so we don't leak existence across models.
 */
import { and, eq } from "drizzle-orm";

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
import { db, piercingPoints } from "@/db";
import { updateAnchorSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string; anchorId: string }>;
}

async function loadAnchorOwned(
    bodyModelId: string,
    anchorId: string
): Promise<typeof piercingPoints.$inferSelect | null> {
    const [row] = await db
        .select()
        .from(piercingPoints)
        .where(and(eq(piercingPoints.bodyModelId, bodyModelId), eq(piercingPoints.id, anchorId)))
        .limit(1);
    return row ?? null;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id, anchorId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const anchor = await loadAnchorOwned(id, anchorId);
        if (!anchor) return notFound("Якорь не найден");
        return ok({ anchor });
    } catch (error) {
        console.error("[/api/admin/body-models/:id/anchors/:anchorId GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id, anchorId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateAnchorSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const existing = await loadAnchorOwned(id, anchorId);
        if (!existing) return notFound("Якорь не найден");

        const patch: Partial<typeof piercingPoints.$inferInsert> = {
            updatedAt: new Date(),
        };

        if (input.name !== undefined) patch.name = input.name;
        if (input.displayName !== undefined) patch.displayName = input.displayName;
        if (input.position !== undefined) {
            patch.positionX = String(input.position.x);
            patch.positionY = String(input.position.y);
            patch.positionZ = String(input.position.z);
        }
        if (input.rotation !== undefined) {
            patch.rotationX = String(input.rotation.x);
            patch.rotationY = String(input.rotation.y);
            patch.rotationZ = String(input.rotation.z);
        }
        if (input.normal !== undefined) {
            patch.normalX = String(input.normal.x);
            patch.normalY = String(input.normal.y);
            patch.normalZ = String(input.normal.z);
        }
        if (input.compatibleJewelryTypes !== undefined)
            patch.compatibleJewelryTypes = input.compatibleJewelryTypes;
        if (input.compatibleGauges !== undefined) patch.compatibleGauges = input.compatibleGauges;
        if (input.maxJewelryDiameterMm !== undefined) {
            patch.maxJewelryDiameterMm =
                input.maxJewelryDiameterMm != null ? String(input.maxJewelryDiameterMm) : null;
        }
        if (input.serviceId !== undefined) patch.serviceId = input.serviceId;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        const [updated] = await db
            .update(piercingPoints)
            .set(patch)
            .where(eq(piercingPoints.id, anchorId))
            .returning();

        return ok({ anchor: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("anchor_name_in_use", "Имя якоря уже используется в этой модели", {
                status: 409,
            });
        }
        console.error("[/api/admin/body-models/:id/anchors/:anchorId PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id, anchorId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const existing = await loadAnchorOwned(id, anchorId);
        if (!existing) return notFound("Якорь не найден");

        await db.delete(piercingPoints).where(eq(piercingPoints.id, anchorId));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/body-models/:id/anchors/:anchorId DELETE] failed", error);
        return internal();
    }
}
