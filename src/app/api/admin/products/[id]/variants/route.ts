/**
 * /api/admin/products/[id]/variants
 *
 *   GET  — list every variant for a product (incl. soft-deleted with ?includeDeleted=true).
 *   POST — create a new variant. SKU is optional; if supplied it must be globally unique.
 *
 * Variant-level RUD (per-variant routes) live at `./[variantId]/route.ts`.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

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
import { createVariantSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

async function ensureProductExists(
    id: string
): Promise<{ status: string | null; deletedAt: Date | null } | null> {
    const [row] = await db
        .select({ status: products.status, deletedAt: products.deletedAt })
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
    return row ?? null;
}

// ---------------------------------------------------------------------------
// GET — list variants
// ---------------------------------------------------------------------------
export async function GET(req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const includeDeleted = new URL(req.url).searchParams.get("includeDeleted") === "true";

    try {
        const product = await ensureProductExists(id);
        if (!product) return notFound("Товар не найден");

        const filters = [eq(productVariants.productId, id)];
        if (!includeDeleted) filters.push(isNull(productVariants.deletedAt));

        const rows = await db
            .select()
            .from(productVariants)
            .where(and(...filters))
            .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));

        return ok({ variants: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/products/:id/variants GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — create variant
// ---------------------------------------------------------------------------
export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createVariantSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const product = await ensureProductExists(id);
        if (!product) return notFound("Товар не найден");
        if (product.deletedAt) {
            return fail("product_soft_deleted", "Товар удалён", { status: 409 });
        }

        const [created] = await db
            .insert(productVariants)
            .values({
                productId: id,
                title: input.title,
                sku: input.sku ?? null,
                materialFinish: input.materialFinish ?? null,
                gauge: input.gauge ?? null,
                // numeric(5,1) is stored as string by drizzle-postgres.
                lengthMm: input.lengthMm != null ? String(input.lengthMm) : null,
                diameterMm: input.diameterMm != null ? String(input.diameterMm) : null,
                gemType: input.gemType ?? null,
                gemColor: input.gemColor ?? null,
                priceRub: input.priceRub,
                priceUsd: input.priceUsd ?? null,
                originalPriceRub: input.originalPriceRub ?? null,
                saleStart: input.saleStart ?? null,
                saleEnd: input.saleEnd ?? null,
                manageInventory: input.manageInventory,
                inventoryQuantity: input.inventoryQuantity,
                lowStockThreshold: input.lowStockThreshold,
                allowBackorder: input.allowBackorder,
                imageUrl: input.imageUrl ?? null,
                model3dMaterialKey: input.model3dMaterialKey ?? null,
                sortOrder: input.sortOrder,
            })
            .returning();

        // Public list aggregates min_price across variants — adding a variant
        // can change the displayed price even for an already-published product.
        if (product.status === "published") {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ variant: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("sku_in_use", "SKU уже используется", { status: 409 });
        }
        console.error("[/api/admin/products/:id/variants POST] failed", error);
        return internal();
    }
}
