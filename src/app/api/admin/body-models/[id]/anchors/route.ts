/**
 * /api/admin/body-models/[id]/anchors
 *
 *   GET  — list every anchor for the model (incl. inactive).
 *   POST — append one anchor.
 *   PUT  — atomic bulk replace. The entire anchor set is wiped and
 *          re-inserted inside a single transaction. Use this from the
 *          anchor-editor save flow ("Save all").
 *
 * Legacy anchor-editor.html JSON import lives at `./import/route.ts` and
 * delegates to this same transaction.
 */
import { and, asc, eq } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    notFound,
    ok,
    parseJson,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { bodyModels, db, piercingPoints } from "@/db";
import { anchorSchema, replaceAnchorsSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

async function ensureBodyModelExists(id: string): Promise<boolean> {
    const [row] = await db
        .select({ id: bodyModels.id })
        .from(bodyModels)
        .where(eq(bodyModels.id, id))
        .limit(1);
    return Boolean(row);
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "true";

    try {
        if (!(await ensureBodyModelExists(id))) {
            return notFound("Модель не найдена");
        }

        const filters = [eq(piercingPoints.bodyModelId, id)];
        if (!includeInactive) filters.push(eq(piercingPoints.isActive, true));

        const rows = await db
            .select()
            .from(piercingPoints)
            .where(and(...filters))
            .orderBy(asc(piercingPoints.sortOrder), asc(piercingPoints.name));

        return ok({ anchors: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/body-models/:id/anchors GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — append one
// ---------------------------------------------------------------------------
export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    // Reuse anchorSchema but drop the optional `id` field; we always create
    // a fresh row here. Updates go through PATCH on the [anchorId] route.
    const parsed = await parseJson(req, anchorSchema.omit({ id: true }));
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        if (!(await ensureBodyModelExists(id))) {
            return notFound("Модель не найдена");
        }

        const [created] = await db
            .insert(piercingPoints)
            .values({
                bodyModelId: id,
                name: input.name,
                displayName: input.displayName,
                positionX: String(input.position.x),
                positionY: String(input.position.y),
                positionZ: String(input.position.z),
                rotationX: input.rotation ? String(input.rotation.x) : "0",
                rotationY: input.rotation ? String(input.rotation.y) : "0",
                rotationZ: input.rotation ? String(input.rotation.z) : "0",
                normalX: String(input.normal.x),
                normalY: String(input.normal.y),
                normalZ: String(input.normal.z),
                compatibleJewelryTypes: input.compatibleJewelryTypes,
                compatibleGauges: input.compatibleGauges ?? null,
                maxJewelryDiameterMm:
                    input.maxJewelryDiameterMm != null ? String(input.maxJewelryDiameterMm) : null,
                serviceId: input.serviceId ?? null,
                sortOrder: input.sortOrder ?? 0,
                isActive: input.isActive ?? true,
            })
            .returning();

        return ok({ anchor: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("anchor_name_in_use", "Имя якоря уже используется в этой модели", {
                status: 409,
            });
        }
        console.error("[/api/admin/body-models/:id/anchors POST] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PUT — bulk replace
// ---------------------------------------------------------------------------
export async function PUT(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, replaceAnchorsSchema);
    if (!parsed.ok) return parsed.response!;
    const { anchors } = parsed.data!;

    try {
        if (!(await ensureBodyModelExists(id))) {
            return notFound("Модель не найдена");
        }

        // Refuse duplicate machine names up-front; the DB unique constraint
        // would catch it, but a friendlier 400 is nicer for the editor UX.
        const seen = new Set<string>();
        for (const a of anchors) {
            if (seen.has(a.name)) {
                return fail("duplicate_anchor_name", `Дублируется имя якоря: ${a.name}`, {
                    status: 400,
                });
            }
            seen.add(a.name);
        }

        const inserted = await db.transaction(async (tx) => {
            await tx.delete(piercingPoints).where(eq(piercingPoints.bodyModelId, id));

            if (anchors.length === 0) return [];

            const rows = await tx
                .insert(piercingPoints)
                .values(
                    anchors.map((a, i) => ({
                        bodyModelId: id,
                        name: a.name,
                        displayName: a.displayName,
                        positionX: String(a.position.x),
                        positionY: String(a.position.y),
                        positionZ: String(a.position.z),
                        rotationX: a.rotation ? String(a.rotation.x) : "0",
                        rotationY: a.rotation ? String(a.rotation.y) : "0",
                        rotationZ: a.rotation ? String(a.rotation.z) : "0",
                        normalX: String(a.normal.x),
                        normalY: String(a.normal.y),
                        normalZ: String(a.normal.z),
                        compatibleJewelryTypes: a.compatibleJewelryTypes,
                        compatibleGauges: a.compatibleGauges ?? null,
                        maxJewelryDiameterMm:
                            a.maxJewelryDiameterMm != null ? String(a.maxJewelryDiameterMm) : null,
                        serviceId: a.serviceId ?? null,
                        sortOrder: a.sortOrder ?? i,
                        isActive: a.isActive ?? true,
                    }))
                )
                .returning();

            return rows;
        });

        return ok({ anchors: inserted, count: inserted.length, mode: "replace" });
    } catch (error) {
        console.error("[/api/admin/body-models/:id/anchors PUT] failed", error);
        return internal();
    }
}
