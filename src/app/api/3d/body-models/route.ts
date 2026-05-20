/**
 * GET /api/3d/body-models — published body models for the visualizer.
 *
 * Filters: `area`, `side`. Returns the GLB URL + LODs + camera defaults +
 * skin texture variants. Anchors / piercing points are NOT included here —
 * fetch them via `/api/3d/anchors?bodyModelId=...` (lazy-load pattern).
 */
import { and, asc, eq } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { bodyModels, db } from "@/db";
import { listBodyModelsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listBodyModelsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(bodyModels.isActive, true)];
        if (q.area) filters.push(eq(bodyModels.area, q.area));
        if (q.side) filters.push(eq(bodyModels.side, q.side));
        const where = and(...filters);

        const rows = await db
            .select()
            .from(bodyModels)
            .where(where)
            .orderBy(asc(bodyModels.area), asc(bodyModels.name));

        return ok({ bodyModels: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/3d/body-models] failed", error);
        return internal();
    }
}
