/**
 * POST /api/admin/products/[id]/media/reorder
 *
 * Bulk-reorder media for a product. Accepts an `ordering: [mediaId]` array
 * representing the desired display order (sortOrder = 0 first). Any media
 * row belonging to the product but absent from the array is appended after
 * the explicitly-ordered ones, preserving its previous relative order.
 *
 * Atomicity: the whole reorder is wrapped in a single transaction so a
 * partial write can't reshuffle just half the gallery.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, productMedia, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { reorderProductMediaSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, reorderProductMediaSchema);
    if (!parsed.ok) return parsed.response!;
    const { ordering } = parsed.data!;

    try {
        const [product] = await db
            .select({ id: products.id, status: products.status })
            .from(products)
            .where(eq(products.id, id))
            .limit(1);
        if (!product) return notFound("Товар не найден");

        // Verify every supplied id belongs to this product.
        const owned = await db
            .select({ id: productMedia.id, sortOrder: productMedia.sortOrder })
            .from(productMedia)
            .where(eq(productMedia.productId, id));

        const ownedSet = new Set(owned.map((r) => r.id));
        const stranger = ordering.find((mid) => !ownedSet.has(mid));
        if (stranger) {
            return fail("media_not_owned", `Файл ${stranger} не принадлежит товару`, {
                status: 400,
            });
        }

        // Trailing block: media not mentioned in `ordering`, ordered by their
        // current sortOrder so the relative arrangement of "the rest" survives.
        const orderedSet = new Set(ordering);
        const trailing = owned
            .filter((r) => !orderedSet.has(r.id))
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((r) => r.id);

        const finalOrder = [...ordering, ...trailing];

        await db.transaction(async (tx) => {
            const now = new Date();
            // Per-row UPDATE keeps the migration trivial. For very large
            // galleries we'd batch into a single CASE expression instead.
            for (let i = 0; i < finalOrder.length; i++) {
                await tx
                    .update(productMedia)
                    .set({ sortOrder: i, updatedAt: now })
                    .where(eq(productMedia.id, finalOrder[i]));
            }
        });

        if (product.status === "published") {
            void invalidateCatalogCache().catch(() => {});
        }

        return ok({ ordering: finalOrder, count: finalOrder.length });
    } catch (error) {
        console.error("[/api/admin/products/:id/media/reorder POST] failed", error);
        return internal();
    }
}
