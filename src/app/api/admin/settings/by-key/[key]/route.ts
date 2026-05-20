/**
 * /api/admin/settings/by-key/[key]
 *
 *   GET   — fetch a single setting by its full dotted key (e.g.
 *           `reservation.hold_hours`). Returns 404 for unknown keys.
 *   PATCH — update the value of a single setting. The group is read from the
 *           DB (admins editing one toggle don't need to remember it).
 *
 * Path nesting `by-key/[key]` is deliberate: the canonical bulk-update route
 * `[group]` shares the same depth-1 dynamic segment, so a sibling `[key]`
 * folder would collide. Putting single-key access under `by-key/` keeps both
 * shapes available without forcing the existing PUT consumers to migrate.
 *
 * The key is URL-encoded by the caller because dots are legal in URLs but
 * make path-param parsing surprising; the runtime decodes it back.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, settings } from "@/db";
import { invalidateSettingsCache } from "@/lib/settings";
import { settingPatchSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ key: string }>;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { key: rawKey } = await ctx.params;
    const key = decodeURIComponent(rawKey);

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [row] = await db
            .select({
                key: settings.key,
                value: settings.value,
                groupName: settings.groupName,
                description: settings.description,
                updatedAt: settings.updatedAt,
                updatedBy: settings.updatedBy,
            })
            .from(settings)
            .where(eq(settings.key, key))
            .limit(1);

        if (!row) return notFound("Параметр не найден");
        return ok({ setting: row });
    } catch (error) {
        console.error("[/api/admin/settings/by-key/:key GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { key: rawKey } = await ctx.params;
    const key = decodeURIComponent(rawKey);

    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const parsed = await parseJson(req, settingPatchSchema);
    if (!parsed.ok) return parsed.response!;
    const { value } = parsed.data!;

    try {
        const now = new Date();
        const [updated] = await db
            .update(settings)
            .set({
                value: value as Record<string, unknown>,
                updatedAt: now,
                updatedBy: sess.userId,
            })
            .where(eq(settings.key, key))
            .returning({
                key: settings.key,
                value: settings.value,
                groupName: settings.groupName,
                updatedAt: settings.updatedAt,
            });

        if (!updated) return notFound("Параметр не найден");

        await invalidateSettingsCache().catch((err) =>
            console.warn("[/api/admin/settings/by-key/:key PATCH] invalidate failed", err)
        );

        return ok({ setting: updated });
    } catch (error) {
        console.error("[/api/admin/settings/by-key/:key PATCH] failed", error);
        return internal();
    }
}
