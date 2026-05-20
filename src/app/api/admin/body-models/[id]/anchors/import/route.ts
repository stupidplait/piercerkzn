/**
 * POST /api/admin/body-models/[id]/anchors/import
 *
 * Accepts the flat snake-case anchor array produced by `tools/anchor-editor.html`
 * and forwards it to the bulk-replace pipeline. Equivalent to PUT
 * `/api/admin/body-models/[id]/anchors` with a pre-shaped body — kept as a
 * separate endpoint so the editor can POST its export verbatim, without
 * doing key transformation in browser JS.
 *
 * Legacy payload shape (per `tools/anchor-editor.html:1141`):
 *   [
 *     {
 *       name: "helix_upper_1",
 *       display_name: "Helix Upper 1",
 *       body_area: "ear",
 *       position_x: 0.12, position_y: 0.04, position_z: 0.01,
 *       rotation_x: 0, rotation_y: 0, rotation_z: 0,
 *       normal_x: 0.0, normal_y: 1.0, normal_z: 0.0,
 *       compatible_jewelry_types: ["stud"],
 *       compatible_gauges: ["18g","16g"]
 *     }, …
 *   ]
 *
 * Returns the same shape as `PUT /anchors` so the editor can refresh its
 * state from the response.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { bodyModels, db, piercingPoints } from "@/db";
import { anchorEditorPayloadSchema } from "@/lib/validations";

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

    const parsed = await parseJson(req, anchorEditorPayloadSchema);
    if (!parsed.ok) return parsed.response!;
    const payload = parsed.data!;

    try {
        const [model] = await db
            .select({ id: bodyModels.id })
            .from(bodyModels)
            .where(eq(bodyModels.id, id))
            .limit(1);
        if (!model) return notFound("Модель не найдена");

        // De-dup machine names early — friendlier 400 than the unique-index 23505.
        const seen = new Set<string>();
        for (const a of payload) {
            if (seen.has(a.name)) {
                return fail("duplicate_anchor_name", `Дублируется имя якоря: ${a.name}`, {
                    status: 400,
                });
            }
            seen.add(a.name);
        }

        const inserted = await db.transaction(async (tx) => {
            await tx.delete(piercingPoints).where(eq(piercingPoints.bodyModelId, id));

            if (payload.length === 0) return [];

            const rows = await tx
                .insert(piercingPoints)
                .values(
                    payload.map((a, i) => ({
                        bodyModelId: id,
                        name: a.name,
                        // The editor doesn't always send display_name; fall back to
                        // a humanised version of the machine name.
                        displayName:
                            a.display_name ??
                            a.name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
                        positionX: String(a.position_x),
                        positionY: String(a.position_y),
                        positionZ: String(a.position_z),
                        rotationX: String(a.rotation_x ?? 0),
                        rotationY: String(a.rotation_y ?? 0),
                        rotationZ: String(a.rotation_z ?? 0),
                        normalX: String(a.normal_x),
                        normalY: String(a.normal_y),
                        normalZ: String(a.normal_z),
                        compatibleJewelryTypes: a.compatible_jewelry_types,
                        compatibleGauges: a.compatible_gauges ?? null,
                        sortOrder: i,
                        isActive: true,
                    }))
                )
                .returning();

            return rows;
        });

        return ok({
            anchors: inserted,
            count: inserted.length,
            mode: "import",
            source: "anchor-editor",
        });
    } catch (error) {
        console.error("[/api/admin/body-models/:id/anchors/import POST] failed", error);
        return internal();
    }
}
