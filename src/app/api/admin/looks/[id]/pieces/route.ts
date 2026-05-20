/**
 * /api/admin/looks/[id]/pieces
 *
 *   GET  — list pieces in a look (sortOrder ascending).
 *   POST — append one piece. Recomputes the look's totals afterwards.
 *   PUT  — atomic replace of the entire piece set inside one transaction.
 *
 * Variant + piercing-point existence is verified up-front so we get clean
 * 400s instead of FK-violation 23503 noise.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { curatedLooks, db, lookPieces, piercingPoints, productVariants } from "@/db";
import { recalcLookTotals } from "@/lib/looks/recalc";
import { lookPieceSchema, replaceLookPiecesSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

async function ensureLookExists(id: string): Promise<boolean> {
    const [row] = await db
        .select({ id: curatedLooks.id })
        .from(curatedLooks)
        .where(eq(curatedLooks.id, id))
        .limit(1);
    return Boolean(row);
}

/**
 * Verify a list of UUIDs exists in a target table; returns the missing ids
 * (empty array means all good).
 */
async function findMissing(
    ids: readonly string[],
    /* eslint-disable @typescript-eslint/no-explicit-any */
    table: any,
    column: any
    /* eslint-enable @typescript-eslint/no-explicit-any */
): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db
        .select({ id: column })
        .from(table)
        .where(inArray(column, [...new Set(ids)]));
    const found = new Set(rows.map((r: { id: string }) => r.id));
    return ids.filter((id) => !found.has(id));
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        if (!(await ensureLookExists(id))) return notFound("Сет не найден");

        const rows = await db
            .select()
            .from(lookPieces)
            .where(eq(lookPieces.lookId, id))
            .orderBy(asc(lookPieces.sortOrder));

        return ok({ pieces: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/looks/:id/pieces GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — append one piece
// ---------------------------------------------------------------------------
export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, lookPieceSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        if (!(await ensureLookExists(id))) return notFound("Сет не найден");

        const missingPoints = await findMissing(
            [input.piercingPointId],
            piercingPoints,
            piercingPoints.id
        );
        if (missingPoints.length > 0) {
            return fail("piercing_point_not_found", "Точка пирсинга не найдена", { status: 400 });
        }
        const missingVariants = await findMissing(
            [input.variantId],
            productVariants,
            productVariants.id
        );
        if (missingVariants.length > 0) {
            return fail("variant_not_found", "Вариант не найден", { status: 400 });
        }

        const result = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(lookPieces)
                .values({
                    lookId: id,
                    piercingPointId: input.piercingPointId,
                    variantId: input.variantId,
                    sortOrder: input.sortOrder ?? 0,
                })
                .returning();

            const totals = await recalcLookTotals(tx, id);
            return { piece: created, totals };
        });

        return ok(result, { status: 201 });
    } catch (error) {
        console.error("[/api/admin/looks/:id/pieces POST] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PUT — atomic replace
// ---------------------------------------------------------------------------
export async function PUT(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, replaceLookPiecesSchema);
    if (!parsed.ok) return parsed.response!;
    const { pieces } = parsed.data!;

    try {
        if (!(await ensureLookExists(id))) return notFound("Сет не найден");

        if (pieces.length > 0) {
            const pointIds = pieces.map((p) => p.piercingPointId);
            const variantIds = pieces.map((p) => p.variantId);
            const missingPoints = await findMissing(pointIds, piercingPoints, piercingPoints.id);
            if (missingPoints.length > 0) {
                return fail(
                    "piercing_point_not_found",
                    `Не найдены точки: ${missingPoints.join(", ")}`,
                    { status: 400 }
                );
            }
            const missingVariants = await findMissing(
                variantIds,
                productVariants,
                productVariants.id
            );
            if (missingVariants.length > 0) {
                return fail(
                    "variant_not_found",
                    `Не найдены варианты: ${missingVariants.join(", ")}`,
                    { status: 400 }
                );
            }
        }

        const result = await db.transaction(async (tx) => {
            await tx.delete(lookPieces).where(eq(lookPieces.lookId, id));

            const inserted =
                pieces.length === 0
                    ? []
                    : await tx
                          .insert(lookPieces)
                          .values(
                              pieces.map((p, i) => ({
                                  lookId: id,
                                  piercingPointId: p.piercingPointId,
                                  variantId: p.variantId,
                                  sortOrder: p.sortOrder ?? i,
                              }))
                          )
                          .returning();

            const totals = await recalcLookTotals(tx, id);
            return { pieces: inserted, totals };
        });

        return ok({ ...result, count: result.pieces.length, mode: "replace" });
    } catch (error) {
        console.error("[/api/admin/looks/:id/pieces PUT] failed", error);
        return internal();
    }
}
