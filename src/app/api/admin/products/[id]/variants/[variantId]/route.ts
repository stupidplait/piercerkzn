/**
 * /api/admin/products/[id]/variants/[variantId]
 *
 *   GET    — single variant (admin: includes soft-deleted).
 *   PATCH  — partial update.
 *   DELETE — soft delete (default) or hard delete with ?hard=true.
 *
 * The variant must belong to the parent product; mismatches return 404 to
 * avoid leaking the existence of variants under a different product.
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
import { db, products, productVariants } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { updateVariantSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string; variantId: string }>;
}

async function loadVariantOwned(
    productId: string,
    variantId: string
): Promise<typeof productVariants.$inferSelect | null> {
    const [row] = await db
        .select()
        .from(productVariants)
        .where(and(eq(productVariants.productId, productId), eq(productVariants.id, variantId)))
        .limit(1);
    return row ?? null;
}

async function isProductPublished(productId: string): Promise<boolean> {
    const [row] = await db
        .select({ status: products.status })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
    return row?.status === "published";
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id, variantId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const variant = await loadVariantOwned(id, variantId);
        if (!variant) return notFound("Вариант не найден");
        return ok({ variant });
    } catch (error) {
        console.error("[/api/admin/products/:id/variants/:variantId GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id, variantId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateVariantSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const variant = await loadVariantOwned(id, variantId);
        if (!variant) return notFound("Вариант не найден");
        if (variant.deletedAt) {
            return fail("variant_soft_deleted", "Вариант удалён", { status: 409 });
        }

        const patch: Partial<typeof productVariants.$inferInsert> = { updatedAt: new Date() };

        if (input.title !== undefined) patch.title = input.title;
        if (input.sku !== undefined) patch.sku = input.sku;
        if (input.materialFinish !== undefined) patch.materialFinish = input.materialFinish;
        if (input.gauge !== undefined) patch.gauge = input.gauge;
        if (input.lengthMm !== undefined)
            patch.lengthMm = input.lengthMm != null ? String(input.lengthMm) : null;
        if (input.diameterMm !== undefined)
            patch.diameterMm = input.diameterMm != null ? String(input.diameterMm) : null;
        if (input.gemType !== undefined) patch.gemType = input.gemType;
        if (input.gemColor !== undefined) patch.gemColor = input.gemColor;
        if (input.priceRub !== undefined) patch.priceRub = input.priceRub;
        if (input.priceUsd !== undefined) patch.priceUsd = input.priceUsd;
        if (input.originalPriceRub !== undefined) patch.originalPriceRub = input.originalPriceRub;
        if (input.saleStart !== undefined) patch.saleStart = input.saleStart;
        if (input.saleEnd !== undefined) patch.saleEnd = input.saleEnd;
        if (input.manageInventory !== undefined) patch.manageInventory = input.manageInventory;
        if (input.inventoryQuantity !== undefined)
            patch.inventoryQuantity = input.inventoryQuantity;
        if (input.lowStockThreshold !== undefined)
            patch.lowStockThreshold = input.lowStockThreshold;
        if (input.allowBackorder !== undefined) patch.allowBackorder = input.allowBackorder;
        if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl;
        if (input.model3dMaterialKey !== undefined)
            patch.model3dMaterialKey = input.model3dMaterialKey;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

        const [updated] = await db
            .update(productVariants)
            .set(patch)
            .where(eq(productVariants.id, variantId))
            .returning();

        if (await isProductPublished(id)) {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ variant: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("sku_in_use", "SKU уже используется", { status: 409 });
        }
        console.error("[/api/admin/products/:id/variants/:variantId PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — soft (default) or hard
// ---------------------------------------------------------------------------
export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id, variantId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "true";

    try {
        const variant = await loadVariantOwned(id, variantId);
        if (!variant) return notFound("Вариант не найден");

        if (hard) {
            await db.delete(productVariants).where(eq(productVariants.id, variantId));
            if (await isProductPublished(id)) {
                void invalidateCatalogCache().catch(() => {});
            }
            return ok({ deleted: true, mode: "hard" });
        }

        if (variant.deletedAt) {
            return ok({ deleted: true, mode: "soft", alreadyDeleted: true });
        }

        const now = new Date();
        const [softDeleted] = await db
            .update(productVariants)
            .set({ deletedAt: now, updatedAt: now })
            .where(eq(productVariants.id, variantId))
            .returning({ id: productVariants.id, deletedAt: productVariants.deletedAt });

        if (await isProductPublished(id)) {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ deleted: true, mode: "soft", variant: softDeleted });
    } catch (error) {
        console.error("[/api/admin/products/:id/variants/:variantId DELETE] failed", error);
        return internal();
    }
}
