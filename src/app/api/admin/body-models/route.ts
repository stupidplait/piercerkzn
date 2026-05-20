/**
 * /api/admin/body-models
 *
 *   GET  — list (filterable by area / side, optionally including inactive
 *          models). Admin-only counterpart to `/api/3d/body-models`.
 *   POST — create a new body model. Returns the persisted row.
 *
 * Body models are the foundation of the visualizer; deleting one cascades
 * to its piercing points, so admins should prefer toggling `isActive` to
 * actually destroying records.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { applyRateLimit, internal, ok, parseJson, parseQuery, requireAdmin } from "@/lib/api";
import { bodyModels, db } from "@/db";
import { adminListBodyModelsQuerySchema, createBodyModelSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListBodyModelsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (!q.includeInactive) filters.push(eq(bodyModels.isActive, true));
        if (q.area) filters.push(eq(bodyModels.area, q.area));
        if (q.side) filters.push(eq(bodyModels.side, q.side));
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db.select().from(bodyModels);
        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(asc(bodyModels.area), asc(bodyModels.name))
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(bodyModels);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            bodyModels: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/body-models GET] failed", error);
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

    const parsed = await parseJson(req, createBodyModelSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [created] = await db
            .insert(bodyModels)
            .values({
                name: input.name,
                area: input.area,
                side: input.side ?? null,
                modelUrl: input.modelUrl,
                modelUrlLod1: input.modelUrlLod1 ?? null,
                modelUrlLod2: input.modelUrlLod2 ?? null,
                thumbnailUrl: input.thumbnailUrl ?? null,
                polygonCount: input.polygonCount ?? null,
                fileSizeBytes: input.fileSizeBytes ?? null,
                cameraDefaults: input.cameraDefaults,
                skinTextures: input.skinTextures ?? [],
                version: input.version ?? 1,
                isActive: input.isActive ?? true,
            })
            .returning();

        return ok({ bodyModel: created }, { status: 201 });
    } catch (error) {
        console.error("[/api/admin/body-models POST] failed", error);
        return internal();
    }
}
