/**
 * /api/admin/jewelry-models/[id]
 *
 *   GET    — full detail with product handle/title joined.
 *   PATCH  — partial update.
 *   DELETE — hard delete. (Soft-delete isn't useful here because the storefront
 *            uses `status === 'active'` as the visibility gate; flip status
 *            via PATCH if you only want to hide the model.)
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
import { db, jewelry3dModels, products } from "@/db";
import { updateJewelryModelSchema } from "@/lib/validations";

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
        const [row] = await db
            .select({
                id: jewelry3dModels.id,
                productId: jewelry3dModels.productId,
                productHandle: products.handle,
                productTitle: products.title,
                modelUrl: jewelry3dModels.modelUrl,
                thumbnailUrl: jewelry3dModels.thumbnailUrl,
                polygonCount: jewelry3dModels.polygonCount,
                fileSizeBytes: jewelry3dModels.fileSizeBytes,
                materialMapping: jewelry3dModels.materialMapping,
                jewelryType: jewelry3dModels.jewelryType,
                defaultAttachment: jewelry3dModels.defaultAttachment,
                isValidated: jewelry3dModels.isValidated,
                validationErrors: jewelry3dModels.validationErrors,
                status: jewelry3dModels.status,
                createdAt: jewelry3dModels.createdAt,
                updatedAt: jewelry3dModels.updatedAt,
            })
            .from(jewelry3dModels)
            .leftJoin(products, eq(products.id, jewelry3dModels.productId))
            .where(eq(jewelry3dModels.id, id))
            .limit(1);

        if (!row) return notFound("Модель не найдена");
        return ok({ jewelryModel: row });
    } catch (error) {
        console.error("[/api/admin/jewelry-models/:id GET] failed", error);
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

    const parsed = await parseJson(req, updateJewelryModelSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: jewelry3dModels.id })
            .from(jewelry3dModels)
            .where(eq(jewelry3dModels.id, id))
            .limit(1);
        if (!existing) return notFound("Модель не найдена");

        const patch: Partial<typeof jewelry3dModels.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (input.productId !== undefined) patch.productId = input.productId;
        if (input.modelUrl !== undefined) patch.modelUrl = input.modelUrl;
        if (input.thumbnailUrl !== undefined) patch.thumbnailUrl = input.thumbnailUrl;
        if (input.polygonCount !== undefined) patch.polygonCount = input.polygonCount;
        if (input.fileSizeBytes !== undefined) patch.fileSizeBytes = input.fileSizeBytes;
        if (input.materialMapping !== undefined) patch.materialMapping = input.materialMapping;
        if (input.jewelryType !== undefined) patch.jewelryType = input.jewelryType;
        if (input.defaultAttachment !== undefined)
            patch.defaultAttachment = input.defaultAttachment;
        if (input.isValidated !== undefined) patch.isValidated = input.isValidated;
        if (input.validationErrors !== undefined) patch.validationErrors = input.validationErrors;
        if (input.status !== undefined) patch.status = input.status;

        const [updated] = await db
            .update(jewelry3dModels)
            .set(patch)
            .where(eq(jewelry3dModels.id, id))
            .returning();

        return ok({ jewelryModel: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23503") {
            return fail("product_not_found", "Товар не найден", { status: 400 });
        }
        console.error("[/api/admin/jewelry-models/:id PATCH] failed", error);
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
            .select({ id: jewelry3dModels.id })
            .from(jewelry3dModels)
            .where(eq(jewelry3dModels.id, id))
            .limit(1);
        if (!existing) return notFound("Модель не найдена");

        await db.delete(jewelry3dModels).where(eq(jewelry3dModels.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/jewelry-models/:id DELETE] failed", error);
        return internal();
    }
}
