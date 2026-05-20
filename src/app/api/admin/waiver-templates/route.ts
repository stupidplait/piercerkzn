/**
 * /api/admin/waiver-templates — admin waiver template management.
 *
 *   GET  — list every revision (active and inactive), version DESC.
 *   POST — create a new revision. `version` is unique and immutable per row.
 *
 * Active-singleton invariant: when a template is created (or patched) with
 * `isActive = true`, every other row is deactivated in the same transaction.
 * The booking flow at `/api/booking/waivers/template` selects
 * `isActive = true` ordered by `desc(version)` and limits to 1, so we keep
 * the data layer honest by enforcing "exactly one active" on writes.
 */
import { desc, eq, ne } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    ok,
    parseJson,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, waiverTemplates } from "@/db";
import { createWaiverTemplateSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const rows = await db
            .select({
                id: waiverTemplates.id,
                version: waiverTemplates.version,
                content: waiverTemplates.content,
                isActive: waiverTemplates.isActive,
                createdAt: waiverTemplates.createdAt,
                createdBy: waiverTemplates.createdBy,
            })
            .from(waiverTemplates)
            .orderBy(desc(waiverTemplates.version));

        return ok({ templates: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/waiver-templates GET] failed", error);
        return internal();
    }
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createWaiverTemplateSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    // The DB column defaults `is_active` to `true`; we mirror that here so the
    // active-singleton enforcement below has a concrete value to branch on.
    const willBeActive = input.isActive ?? true;

    try {
        const created = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(waiverTemplates)
                .values({
                    version: input.version,
                    content: input.content,
                    isActive: willBeActive,
                    createdBy: guard.ctx.userId,
                })
                .returning();

            if (willBeActive) {
                await tx
                    .update(waiverTemplates)
                    .set({ isActive: false })
                    .where(ne(waiverTemplates.id, row.id));
            }

            return row;
        });

        return ok({ template: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("version_in_use", "Версия шаблона уже существует", { status: 409 });
        }
        console.error("[/api/admin/waiver-templates POST] failed", error);
        return internal();
    }
}
