/**
 * GET /api/aftercare/[handle] — single published aftercare guide.
 *
 * The structured `content` field is returned as-is — the storefront knows
 * its shape (overview / timeline / daily_routine / dos / donts / warning_signs
 * / downsizing — see docs/06_DATABASE_SCHEMA.md §5.2).
 */
import { and, eq } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { aftercareGuides, db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ handle: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { handle } = await ctx.params;
    if (!handle || handle.length > 100) return notFound("Гайд не найден");

    try {
        const [row] = await db
            .select()
            .from(aftercareGuides)
            .where(and(eq(aftercareGuides.handle, handle), eq(aftercareGuides.isPublished, true)))
            .limit(1);
        if (!row) return notFound("Гайд не найден");

        return ok({ guide: row });
    } catch (error) {
        console.error("[/api/aftercare/:handle] failed", error);
        return internal();
    }
}
