/**
 * PUT /api/admin/settings/[group] — bulk-update settings within a single group.
 *
 * Body: { settings: { "<full.key>": { text|number|bool: ... } | <jsonb> } }
 *
 * Rules:
 *   - Every key in the payload must already exist in the DB AND belong to
 *     `[group]`. We do not allow callers to create new settings or to move
 *     a setting between groups.
 *   - `updatedBy` is stamped with the admin's user id.
 *   - All rows update in a single transaction; either every key applies or
 *     none do.
 *
 * Reasoning: settings are a small fixed key-set seeded by the studio; admins
 * tweak values, never invent new keys. Creating a key is a code change.
 */
import { eq, inArray } from "drizzle-orm";

import { fail, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, settings } from "@/db";
import { invalidateSettingsCache } from "@/lib/settings";
import { settingsBulkUpdateSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ group: string }>;
}

export async function PUT(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const { group } = await ctx.params;

    const parsed = await parseJson(req, settingsBulkUpdateSchema);
    if (!parsed.ok) return parsed.response!;
    const { settings: updates } = parsed.data!;

    const keys = Object.keys(updates);

    try {
        return await db
            .transaction(async (tx) => {
                const existing = await tx
                    .select({ key: settings.key, groupName: settings.groupName })
                    .from(settings)
                    .where(inArray(settings.key, keys));

                const byKey = new Map(existing.map((r) => [r.key, r.groupName]));
                const unknown = keys.filter((k) => !byKey.has(k));
                if (unknown.length > 0) {
                    return fail("unknown_keys", `Неизвестные параметры: ${unknown.join(", ")}`, {
                        status: 400,
                    });
                }
                const wrongGroup = keys.filter((k) => byKey.get(k) !== group);
                if (wrongGroup.length > 0) {
                    return fail(
                        "group_mismatch",
                        `Параметры не принадлежат группе ${group}: ${wrongGroup.join(", ")}`,
                        { status: 400 }
                    );
                }

                const now = new Date();
                const updatedRows: { key: string; value: unknown }[] = [];
                for (const [key, value] of Object.entries(updates)) {
                    const [updated] = await tx
                        .update(settings)
                        .set({
                            value: value as Record<string, unknown>,
                            updatedAt: now,
                            updatedBy: sess.userId,
                        })
                        .where(eq(settings.key, key))
                        .returning({ key: settings.key, value: settings.value });
                    updatedRows.push(updated);
                }

                return ok({ group, updated: updatedRows, count: updatedRows.length });
            })
            .then(async (response) => {
                // Bust the settings cache so the next read returns fresh values
                // without waiting for the SWR refresh window.
                await invalidateSettingsCache().catch((err) =>
                    console.warn("[/api/admin/settings/:group PUT] invalidate failed", err)
                );
                return response;
            });
    } catch (error) {
        console.error("[/api/admin/settings/:group PUT] failed", error);
        return internal();
    }
}
