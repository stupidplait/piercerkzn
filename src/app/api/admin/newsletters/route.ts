/**
 * /api/admin/newsletters
 *
 *   GET  — list campaigns with pagination + optional state filter.
 *   POST — create a new campaign in `draft`.
 *
 * State-machine rejections live on the per-id routes; this collection route
 * is concerned only with creation and listing. Both methods require an
 * authenticated admin session; POST is additionally rate-limited.
 */
import { applyRateLimit, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { createCampaign, listCampaigns } from "@/lib/newsletters/dispatch";
import type { CampaignState } from "@/lib/newsletters/state";
import { createCampaignSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES: readonly CampaignState[] = [
    "draft",
    "scheduled",
    "sending",
    "sent",
    "cancelled",
];

function parsePositiveInt(raw: string | null, fallback: number, max?: number): number {
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return fallback;
    const floored = Math.floor(n);
    return max === undefined ? floored : Math.min(floored, max);
}

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
    const offset = parsePositiveInt(url.searchParams.get("offset"), 0);
    const stateParam = url.searchParams.get("state");
    const state =
        stateParam && (VALID_STATES as readonly string[]).includes(stateParam)
            ? (stateParam as CampaignState)
            : undefined;

    try {
        const result = await listCampaigns({ limit, offset, state });
        return ok(result);
    } catch (error) {
        console.error("[/api/admin/newsletters GET] failed", error);
        return internal();
    }
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createCampaignSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const row = await createCampaign({
            ...parsed.data!,
            createdByUserId: guard.ctx.userId,
        });
        return ok({ campaign: row }, { status: 201 });
    } catch (error) {
        console.error("[/api/admin/newsletters POST] failed", error);
        return internal();
    }
}
