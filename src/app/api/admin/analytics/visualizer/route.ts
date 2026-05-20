/**
 * GET /api/admin/analytics/visualizer
 *
 * Aggregates 3D-visualizer engagement counters from PostHog. Unlike the
 * other analytics endpoints (which run SQL on our own Postgres), the
 * visualizer events fire from the browser via `posthog-js` and are stored
 * in PostHog itself. We query them back via PostHog's HogQL API.
 *
 * Required env vars:
 *   - `POSTHOG_PROJECT_ID`         numeric, e.g. "12345"
 *   - `POSTHOG_PERSONAL_API_KEY`   personal key with read access on the project
 *   - `NEXT_PUBLIC_POSTHOG_HOST`   e.g. "https://eu.posthog.com"
 *
 * If any are missing the endpoint returns `503 not_configured` with the
 * expected event schema so the admin UI can render a setup hint instead of
 * a generic error.
 *
 * Documented events the storefront client must emit for these counters to
 * work (see `app/visualizer` page when implemented):
 *   - `visualizer_opened`
 *   - `visualizer_jewelry_placed`     props: { product_id, piercing_point }
 *   - `visualizer_look_saved`         props: { piece_count, look_id? }
 *   - `visualizer_reservation_started` props: { piece_count }
 */
import { fail, ok, parseQuery, requireAdmin } from "@/lib/api";
import { resolveAnalyticsRange } from "@/lib/admin/analytics";
import { analyticsRangeSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISUALIZER_EVENTS = [
    "visualizer_opened",
    "visualizer_jewelry_placed",
    "visualizer_look_saved",
    "visualizer_reservation_started",
] as const;

interface PostHogConfig {
    projectId: string;
    apiKey: string;
    host: string;
}

function loadPostHogConfig(): PostHogConfig | null {
    const projectId = process.env.POSTHOG_PROJECT_ID;
    const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com";
    if (!projectId || !apiKey) return null;
    return { projectId, apiKey, host: host.replace(/\/$/, "") };
}

interface HogQLResponse {
    results: Array<Array<string | number | null>>;
    columns?: string[];
}

async function runHogQL(cfg: PostHogConfig, sql: string): Promise<HogQLResponse> {
    const res = await fetch(`${cfg.host}/api/projects/${cfg.projectId}/query`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
        // 8s budget — admin dashboards can wait, but we shouldn't tie up a
        // serverless function indefinitely if PostHog is degraded.
        signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`PostHog query failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as HogQLResponse;
}

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, analyticsRangeSchema);
    if (!parsed.ok) return parsed.response!;
    const range = resolveAnalyticsRange(parsed.data!);

    const cfg = loadPostHogConfig();
    if (!cfg) {
        return fail(
            "not_configured",
            "Аналитика визуализатора недоступна — настройте POSTHOG_PROJECT_ID и POSTHOG_PERSONAL_API_KEY",
            {
                status: 503,
                details: { expectedEvents: VISUALIZER_EVENTS },
            }
        );
    }

    const fromIso = range.from.toISOString();
    const toIso = range.to.toISOString();

    // Single HogQL query — counts per event + unique-distinct counts.
    // Note: HogQL is forgiving about quoting; we still parameterize the
    // event filter list inline because PostHog doesn't accept bind vars.
    const eventList = VISUALIZER_EVENTS.map((e) => `'${e}'`).join(", ");
    const sql = `
        SELECT
            event,
            count() AS total,
            count(DISTINCT distinct_id) AS uniques
        FROM events
        WHERE event IN (${eventList})
          AND timestamp >= toDateTime('${fromIso}')
          AND timestamp <= toDateTime('${toIso}')
        GROUP BY event
    `.trim();

    try {
        const result = await runHogQL(cfg, sql);
        const byEvent = new Map<string, { total: number; uniques: number }>();
        for (const row of result.results) {
            const [event, total, uniques] = row;
            if (typeof event !== "string") continue;
            byEvent.set(event, {
                total: Number(total ?? 0),
                uniques: Number(uniques ?? 0),
            });
        }

        const counters = VISUALIZER_EVENTS.reduce<
            Record<(typeof VISUALIZER_EVENTS)[number], { total: number; uniques: number }>
        >(
            (acc, name) => {
                acc[name] = byEvent.get(name) ?? { total: 0, uniques: 0 };
                return acc;
            },
            {} as Record<(typeof VISUALIZER_EVENTS)[number], { total: number; uniques: number }>
        );

        const opens = counters.visualizer_opened.total;
        const placedTotal = counters.visualizer_jewelry_placed.total;
        const reservationStarted = counters.visualizer_reservation_started.total;
        const looksSaved = counters.visualizer_look_saved.total;

        return ok({
            visualizer: {
                period: range.period,
                from: fromIso,
                to: toIso,
                events: counters,
                summary: {
                    sessions: opens,
                    uniqueUsers: counters.visualizer_opened.uniques,
                    averagePiecesPerSession:
                        opens > 0 ? Number((placedTotal / opens).toFixed(2)) : 0,
                    looksSaved,
                    reservationStarted,
                    /**
                     * Crude conversion rate — share of sessions that triggered
                     * `visualizer_reservation_started`. The funnel can be made
                     * more precise once the storefront emits a per-session id.
                     */
                    reservationStartRate:
                        opens > 0 ? Number(((reservationStarted / opens) * 100).toFixed(1)) : 0,
                },
            },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/visualizer] PostHog failed", error);
        return fail("upstream_error", "Не удалось получить данные из PostHog", { status: 502 });
    }
}
