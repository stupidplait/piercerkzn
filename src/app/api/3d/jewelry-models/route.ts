/**
 * GET /api/3d/jewelry-models
 *
 * Returns active 3D jewelry models. Optional `productId` filter restricts to
 * a single product (used by the visualizer when the customer drag-drops one
 * product onto the body model).
 *
 * Pagination is included so admins / dev tools can fetch the full inventory.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { db, jewelry3dModels, products } from "@/db";
import { listJewelryModelsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listJewelryModelsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(jewelry3dModels.status, "active")];
        if (q.productId) filters.push(eq(jewelry3dModels.productId, q.productId));
        const where = and(...filters);

        const rows = await db
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
                createdAt: jewelry3dModels.createdAt,
            })
            .from(jewelry3dModels)
            .leftJoin(products, eq(products.id, jewelry3dModels.productId))
            .where(where)
            .orderBy(asc(products.title))
            .limit(q.limit)
            .offset(q.offset);

        const [{ total }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(jewelry3dModels)
            .where(where);

        return ok({
            jewelryModels: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/3d/jewelry-models] failed", error);
        return internal();
    }
}
