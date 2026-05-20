/**
 * /api/admin/settings
 *
 *   GET   — list settings, optionally filtered by `group`. Flat rows; the
 *           admin UI groups them by `groupName`.
 *   PATCH — cross-group bulk update. Body: `{ settings: { key: value } }`.
 *           Each key's group is discovered from the DB (callers don't need to
 *           know it). Fails atomically if any key is unknown.
 *
 * The per-group bulk PUT lives at `./[group]/route.ts` and remains the
 * canonical path for "save this section" flows. PATCH here is for
 * dashboard-style "save all changes" flows that span multiple sections.
 */
import { asc, eq, inArray } from "drizzle-orm";

import { applyRateLimit, fail, internal, ok, parseJson, parseQuery, requireAdmin } from "@/lib/api";
import { db, settings } from "@/db";
import { invalidateSettingsCache } from "@/lib/settings";
import { listSettingsQuerySchema, settingsCrossGroupPatchSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listSettingsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const baseQuery = db
            .select({
                key: settings.key,
                value: settings.value,
                groupName: settings.groupName,
                description: settings.description,
                updatedAt: settings.updatedAt,
                updatedBy: settings.updatedBy,
            })
            .from(settings);

        const rows = await (
            q.group ? baseQuery.where(eq(settings.groupName, q.group)) : baseQuery
        ).orderBy(asc(settings.groupName), asc(settings.key));

        return ok({ settings: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/settings GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH — cross-group bulk update
// ---------------------------------------------------------------------------
export async function PATCH(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const parsed = await parseJson(req, settingsCrossGroupPatchSchema);
    if (!parsed.ok) return parsed.response!;
    const { settings: updates } = parsed.data!;

    const keys = Object.keys(updates);

    try {
        const result = await db.transaction(async (tx) => {
            const existing = await tx
                .select({ key: settings.key, groupName: settings.groupName })
                .from(settings)
                .where(inArray(settings.key, keys));

            const knownKeys = new Set(existing.map((r) => r.key));
            const unknown = keys.filter((k) => !knownKeys.has(k));
            if (unknown.length > 0) {
                return {
                    error: fail("unknown_keys", `Неизвестные параметры: ${unknown.join(", ")}`, {
                        status: 400,
                    }),
                } as const;
            }

            const now = new Date();
            const updatedRows: { key: string; groupName: string; value: unknown }[] = [];
            for (const [key, value] of Object.entries(updates)) {
                const [updated] = await tx
                    .update(settings)
                    .set({
                        value: value as Record<string, unknown>,
                        updatedAt: now,
                        updatedBy: sess.userId,
                    })
                    .where(eq(settings.key, key))
                    .returning({
                        key: settings.key,
                        groupName: settings.groupName,
                        value: settings.value,
                    });
                updatedRows.push(updated);
            }

            return { updated: updatedRows } as const;
        });

        if (result.error) return result.error;

        await invalidateSettingsCache().catch((err) =>
            console.warn("[/api/admin/settings PATCH] invalidate failed", err)
        );

        return ok({
            updated: result.updated,
            count: result.updated.length,
            // Convenience: surface which groups were touched so the admin UI
            // can refresh just those sections instead of the whole dashboard.
            groupsTouched: Array.from(new Set(result.updated.map((r) => r.groupName))),
        });
    } catch (error) {
        console.error("[/api/admin/settings PATCH] failed", error);
        return internal();
    }
}
