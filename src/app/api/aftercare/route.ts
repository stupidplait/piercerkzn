/**
 * GET /api/aftercare — list of published aftercare guides for the hub page.
 *
 * Optional filter: `piercingType` (e.g. `helix`, `septum`).
 * Detail content lives at `/api/aftercare/[handle]`.
 */
import { and, asc, eq } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { aftercareGuides, db } from "@/db";
import { listAftercareQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listAftercareQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(aftercareGuides.isPublished, true)];
        if (q.piercingType) filters.push(eq(aftercareGuides.piercingType, q.piercingType));

        const rows = await db
            .select({
                id: aftercareGuides.id,
                handle: aftercareGuides.handle,
                title: aftercareGuides.title,
                piercingType: aftercareGuides.piercingType,
                healingMinWeeks: aftercareGuides.healingMinWeeks,
                healingMaxWeeks: aftercareGuides.healingMaxWeeks,
                iconUrl: aftercareGuides.iconUrl,
                version: aftercareGuides.version,
                updatedAt: aftercareGuides.updatedAt,
            })
            .from(aftercareGuides)
            .where(and(...filters))
            .orderBy(asc(aftercareGuides.title));

        return ok({ guides: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/aftercare GET] failed", error);
        return internal();
    }
}
