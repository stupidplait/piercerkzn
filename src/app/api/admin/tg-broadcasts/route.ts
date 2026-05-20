/**
 * /api/admin/tg-broadcasts
 *
 *   GET  — list broadcasts with pagination + optional state filter.
 *   POST — create a new broadcast in `draft`.
 *
 * State-machine rejections live on the per-id routes; this collection route
 * is concerned only with creation and listing. Both methods require an
 * authenticated admin session; POST is additionally rate-limited.
 */
import { applyRateLimit, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { createBroadcast, listBroadcasts } from "@/lib/telegram-broadcasts/dispatch";
import type { BroadcastState } from "@/lib/telegram-broadcasts/state";
import { createBroadcastSchema } from "@/lib/validations/tg-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES: readonly BroadcastState[] = [
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
            ? (stateParam as BroadcastState)
            : undefined;

    try {
        const result = await listBroadcasts({ limit, offset, state });
        return ok(result);
    } catch (error) {
        console.error("[/api/admin/tg-broadcasts GET] failed", error);
        return internal();
    }
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createBroadcastSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const row = await createBroadcast({
            ...parsed.data!,
            createdByUserId: guard.ctx.userId,
        });
        return ok({ broadcast: row }, { status: 201 });
    } catch (error) {
        console.error("[/api/admin/tg-broadcasts POST] failed", error);
        return internal();
    }
}
