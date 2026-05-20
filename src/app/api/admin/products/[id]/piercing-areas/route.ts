/**
 * /api/admin/products/[id]/piercing-areas
 *
 *   PUT — replace the entire piercing-area set for a product. Sending `[]`
 *         clears all area links. The operation is wrapped in a transaction so
 *         a write failure can't leave the product in an inconsistent state.
 *
 * Areas are also accepted on POST /api/admin/products and PATCH
 * /api/admin/products/[id]; this dedicated endpoint exists for admin UIs that
 * want to mutate area tags without re-sending the whole product payload.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, productPiercingAreas, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { replacePiercingAreasSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PUT(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, replacePiercingAreasSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [product] = await db
            .select({ id: products.id, status: products.status, deletedAt: products.deletedAt })
            .from(products)
            .where(eq(products.id, id))
            .limit(1);
        if (!product) return notFound("Товар не найден");
        if (product.deletedAt) {
            return fail("product_soft_deleted", "Товар удалён", { status: 409 });
        }

        const uniqueAreas = Array.from(new Set(input.areas));

        await db.transaction(async (tx) => {
            await tx.delete(productPiercingAreas).where(eq(productPiercingAreas.productId, id));
            if (uniqueAreas.length > 0) {
                await tx.insert(productPiercingAreas).values(
                    uniqueAreas.map((area) => ({
                        productId: id,
                        piercingArea: area,
                    }))
                );
            }
        });

        if (product.status === "published") {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ productId: id, areas: uniqueAreas });
    } catch (error) {
        console.error("[/api/admin/products/:id/piercing-areas PUT] failed", error);
        return internal();
    }
}
