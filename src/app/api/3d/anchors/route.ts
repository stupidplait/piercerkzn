/**
 * GET /api/3d/anchors?bodyModelId=...
 *
 * Returns every active piercing point (anchor) for a single body model.
 * Anchors carry the world-space position, rotation, normal, and the
 * compatibility constraints the visualizer uses to gate jewelry placement.
 */
import { and, asc, eq } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { bodyModels, db, piercingPoints } from "@/db";
import { listAnchorsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listAnchorsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const [model] = await db
            .select({ id: bodyModels.id, isActive: bodyModels.isActive })
            .from(bodyModels)
            .where(eq(bodyModels.id, q.bodyModelId))
            .limit(1);
        if (!model || !model.isActive) {
            return ok({ anchors: [], count: 0 });
        }

        const rows = await db
            .select({
                id: piercingPoints.id,
                bodyModelId: piercingPoints.bodyModelId,
                name: piercingPoints.name,
                displayName: piercingPoints.displayName,
                position: {
                    x: piercingPoints.positionX,
                    y: piercingPoints.positionY,
                    z: piercingPoints.positionZ,
                },
                rotation: {
                    x: piercingPoints.rotationX,
                    y: piercingPoints.rotationY,
                    z: piercingPoints.rotationZ,
                },
                normal: {
                    x: piercingPoints.normalX,
                    y: piercingPoints.normalY,
                    z: piercingPoints.normalZ,
                },
                compatibleJewelryTypes: piercingPoints.compatibleJewelryTypes,
                compatibleGauges: piercingPoints.compatibleGauges,
                maxJewelryDiameterMm: piercingPoints.maxJewelryDiameterMm,
                serviceId: piercingPoints.serviceId,
                sortOrder: piercingPoints.sortOrder,
            })
            .from(piercingPoints)
            .where(
                and(
                    eq(piercingPoints.bodyModelId, q.bodyModelId),
                    eq(piercingPoints.isActive, true)
                )
            )
            .orderBy(asc(piercingPoints.sortOrder), asc(piercingPoints.name));

        return ok({ anchors: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/3d/anchors] failed", error);
        return internal();
    }
}
