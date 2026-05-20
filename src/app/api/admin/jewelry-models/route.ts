/**
 * /api/admin/jewelry-models
 *
 *   GET  — list with filters (product, status, isValidated). Admin-only:
 *          surfaces processing/inactive rows that the public route hides.
 *   POST — attach a new 3D model to an existing product.
 *
 * `product_id` is a hard FK; trying to attach to a missing product returns
 * a friendly 400 rather than the raw 23503.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    ok,
    parseJson,
    parseQuery,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, jewelry3dModels, products } from "@/db";
import { adminListJewelryModelsQuerySchema, createJewelryModelSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListJewelryModelsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.productId) filters.push(eq(jewelry3dModels.productId, q.productId));
        if (q.status) filters.push(eq(jewelry3dModels.status, q.status));
        if (q.isValidated !== undefined)
            filters.push(eq(jewelry3dModels.isValidated, q.isValidated));
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db
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
            .leftJoin(products, eq(products.id, jewelry3dModels.productId));

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(asc(products.title))
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(jewelry3dModels);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            jewelryModels: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/jewelry-models GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createJewelryModelSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [created] = await db
            .insert(jewelry3dModels)
            .values({
                productId: input.productId,
                modelUrl: input.modelUrl,
                thumbnailUrl: input.thumbnailUrl ?? null,
                polygonCount: input.polygonCount ?? null,
                fileSizeBytes: input.fileSizeBytes ?? null,
                materialMapping: input.materialMapping ?? {},
                jewelryType: input.jewelryType,
                defaultAttachment: input.defaultAttachment ?? null,
                isValidated: input.isValidated ?? false,
                validationErrors: input.validationErrors ?? null,
                status: input.status ?? "active",
            })
            .returning();

        return ok({ jewelryModel: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23503") {
            return fail("product_not_found", "Товар не найден", { status: 400 });
        }
        console.error("[/api/admin/jewelry-models POST] failed", error);
        return internal();
    }
}
