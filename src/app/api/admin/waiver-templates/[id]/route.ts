/**
 * /api/admin/waiver-templates/[id]
 *
 *   GET    — single revision.
 *   PATCH  — partial update. `version` is immutable, so only `content` and
 *            `isActive` are accepted.
 *   DELETE — hard delete. Refused with 409 if any signed waiver still
 *            references this template's version (the `waiver` table stores
 *            `template_version` as a denormalised integer for audit, with no
 *            FK constraint, but the historical record must remain valid).
 *
 * Like the create route, setting `isActive = true` here enforces the
 * "exactly one active template" invariant that the booking flow relies on.
 */
import { eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, waiverTemplates, waivers } from "@/db";
import { updateWaiverTemplateSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// `waiver_template.id` is `serial` — coerce the route param to a positive int
// and 404 immediately if it doesn't parse, instead of letting the DB driver
// raise an `invalid_text_representation` (22P02) error.
const idSchema = z.coerce.number().int().positive();

export async function GET(_req: Request, ctx: RouteContext) {
    const { id: rawId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const idParse = idSchema.safeParse(rawId);
    if (!idParse.success) return notFound("Шаблон не найден");
    const id = idParse.data;

    try {
        const [row] = await db
            .select({
                id: waiverTemplates.id,
                version: waiverTemplates.version,
                content: waiverTemplates.content,
                isActive: waiverTemplates.isActive,
                createdAt: waiverTemplates.createdAt,
                createdBy: waiverTemplates.createdBy,
            })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.id, id))
            .limit(1);
        if (!row) return notFound("Шаблон не найден");

        return ok({ template: row });
    } catch (error) {
        console.error("[/api/admin/waiver-templates/:id GET] failed", error);
        return internal();
    }
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id: rawId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const idParse = idSchema.safeParse(rawId);
    if (!idParse.success) return notFound("Шаблон не найден");
    const id = idParse.data;

    const parsed = await parseJson(req, updateWaiverTemplateSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: waiverTemplates.id })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.id, id))
            .limit(1);
        if (!existing) return notFound("Шаблон не найден");

        const patch: Partial<typeof waiverTemplates.$inferInsert> = {};
        if (input.content !== undefined) patch.content = input.content;
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        const updated = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(waiverTemplates)
                .set(patch)
                .where(eq(waiverTemplates.id, id))
                .returning();

            if (input.isActive === true) {
                await tx
                    .update(waiverTemplates)
                    .set({ isActive: false })
                    .where(ne(waiverTemplates.id, id));
            }

            return row;
        });

        return ok({ template: updated });
    } catch (error) {
        console.error("[/api/admin/waiver-templates/:id PATCH] failed", error);
        return internal();
    }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id: rawId } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const idParse = idSchema.safeParse(rawId);
    if (!idParse.success) return notFound("Шаблон не найден");
    const id = idParse.data;

    try {
        const [existing] = await db
            .select({ id: waiverTemplates.id, version: waiverTemplates.version })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.id, id))
            .limit(1);
        if (!existing) return notFound("Шаблон не найден");

        // `waivers.templateVersion` is a denormalised integer (no FK), so we
        // count manually instead of relying on Postgres to refuse the delete.
        const [{ signedCount }] = await db
            .select({ signedCount: sql<number>`count(*)::int` })
            .from(waivers)
            .where(eq(waivers.templateVersion, existing.version));
        if (signedCount > 0) {
            return fail(
                "template_in_use",
                "К шаблону привязаны подписанные согласия — удаление невозможно",
                { status: 409 }
            );
        }

        await db.delete(waiverTemplates).where(eq(waiverTemplates.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/waiver-templates/:id DELETE] failed", error);
        return internal();
    }
}
