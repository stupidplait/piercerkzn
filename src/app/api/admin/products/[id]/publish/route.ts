/**
 * POST /api/admin/products/[id]/publish
 *
 * Admin/staff transitions a product to `status='published'` and triggers
 * the new-arrival fanout. Idempotent:
 *
 *   - First publish: stamps `published_at = NOW()`, enqueues fanout.
 *   - Re-publish on an already-published product: status unchanged, no
 *     fanout (the BullMQ `jobId = new-arrival:<productId>` would dedupe
 *     anyway, but we skip the enqueue to keep the audit trail clean).
 *   - `?replayFanout=true` (or body `{ replayFanout: true }`) forces an
 *     enqueue regardless — useful when a previous run failed midway.
 *
 * Body (optional):
 *   { "replayFanout": false }
 */
import { and, eq, isNull } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, products } from "@/db";
import { capture } from "@/lib/posthog";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { scheduleNewArrivalFanout } from "@/lib/products/new-arrival";
import { productPublishSchema, type ProductPublishInput } from "@/lib/validations";

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

    let input: ProductPublishInput = { replayFanout: false };
    if (req.headers.get("content-length") && req.headers.get("content-type")?.includes("json")) {
        const parsed = await parseJson(req, productPublishSchema);
        if (!parsed.ok) return parsed.response!;
        input = parsed.data!;
    }

    try {
        const [existing] = await db
            .select({
                id: products.id,
                status: products.status,
                publishedAt: products.publishedAt,
                deletedAt: products.deletedAt,
            })
            .from(products)
            .where(and(eq(products.id, id), isNull(products.deletedAt)))
            .limit(1);

        if (!existing) return notFound("Товар не найден");
        if (existing.status === "archived") {
            return fail("invalid_state", "Архивный товар нельзя опубликовать", { status: 409 });
        }

        const now = new Date();
        const wasFreshlyPublished =
            existing.status !== "published" || existing.publishedAt === null;

        const patch: Partial<typeof products.$inferInsert> = { updatedAt: now };
        if (existing.status !== "published") patch.status = "published";
        if (existing.publishedAt === null) patch.publishedAt = now;

        const [updated] = await db
            .update(products)
            .set(patch)
            .where(eq(products.id, id))
            .returning({
                id: products.id,
                status: products.status,
                publishedAt: products.publishedAt,
                handle: products.handle,
                title: products.title,
            });

        // Fanout decision — see route docs above.
        const shouldFanout = wasFreshlyPublished || input.replayFanout;
        if (shouldFanout) {
            void scheduleNewArrivalFanout(id).catch((err) => {
                console.error("[admin.products.publish] fanout enqueue failed", err);
            });
        }

        // Invalidate the public catalog read-models so the next request to
        // /api/products, /api/categories, or /api/products/facets reflects
        // the new published state immediately. Best-effort.
        if (wasFreshlyPublished) {
            void invalidateCatalogCache().catch((err) =>
                console.warn("[admin.products.publish] cache invalidate failed", err)
            );
        }

        capture({
            event: "product_published",
            distinctId: guard.ctx?.userId ?? "system",
            properties: {
                product_id: id,
                handle: updated?.handle,
                fresh_publish: wasFreshlyPublished,
                fanout_scheduled: shouldFanout,
            },
        });

        return ok({
            product: updated,
            freshPublish: wasFreshlyPublished,
            fanoutScheduled: shouldFanout,
        });
    } catch (error) {
        console.error("[/api/admin/products/:id/publish] failed", error);
        return internal();
    }
}
