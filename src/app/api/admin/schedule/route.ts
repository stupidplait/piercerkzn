/**
 * /api/admin/schedule
 *
 *   GET — full weekly schedule, normalised to all 7 days. Missing rows are
 *         filled in as `{ isWorking: false }` so the admin UI always renders
 *         a complete week regardless of seed state.
 *   PUT — atomic upsert of one or more weekday rows. Each entry is keyed by
 *         the unique `day_of_week` constraint. Mutations happen inside one
 *         transaction so a partial write can never leave the schedule in a
 *         half-updated state.
 *
 * `dayOfWeek` is 0..6 with `0 = Monday` (matches `piercer_schedule` seed).
 */
import { asc, eq, sql } from "drizzle-orm";

import { applyRateLimit, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, piercerSchedule } from "@/db";
import { replaceWeeklyScheduleSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_LABELS_RU = [
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
    "Воскресенье",
];

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const rows = await db
            .select()
            .from(piercerSchedule)
            .orderBy(asc(piercerSchedule.dayOfWeek));

        const byDay = new Map<number, (typeof rows)[number]>();
        for (const r of rows) byDay.set(r.dayOfWeek, r);

        // Always return a 7-row array so the admin UI doesn't have to
        // synthesise missing weekdays.
        const days = Array.from({ length: 7 }, (_, i) => {
            const r = byDay.get(i);
            return r
                ? {
                      id: r.id,
                      dayOfWeek: r.dayOfWeek,
                      label: DAY_LABELS_RU[i],
                      isWorking: r.isWorking ?? false,
                      startTime: r.startTime,
                      endTime: r.endTime,
                      breaks: r.breaks ?? [],
                  }
                : {
                      id: null,
                      dayOfWeek: i,
                      label: DAY_LABELS_RU[i],
                      isWorking: false,
                      startTime: null,
                      endTime: null,
                      breaks: [],
                  };
        });

        return ok({ days });
    } catch (error) {
        console.error("[/api/admin/schedule GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PUT — atomic upsert
// ---------------------------------------------------------------------------
export async function PUT(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, replaceWeeklyScheduleSchema);
    if (!parsed.ok) return parsed.response!;
    const { days } = parsed.data!;

    try {
        const updated = await db.transaction(async (tx) => {
            const out: (typeof piercerSchedule.$inferSelect)[] = [];
            for (const d of days) {
                const [row] = await tx
                    .insert(piercerSchedule)
                    .values({
                        dayOfWeek: d.dayOfWeek,
                        isWorking: d.isWorking,
                        startTime: d.isWorking ? (d.startTime ?? null) : null,
                        endTime: d.isWorking ? (d.endTime ?? null) : null,
                        breaks: d.breaks ?? [],
                    })
                    .onConflictDoUpdate({
                        target: piercerSchedule.dayOfWeek,
                        set: {
                            isWorking: d.isWorking,
                            startTime: d.isWorking ? (d.startTime ?? null) : null,
                            endTime: d.isWorking ? (d.endTime ?? null) : null,
                            breaks: sql`${JSON.stringify(d.breaks ?? [])}::jsonb`,
                        },
                    })
                    .returning();
                if (row) out.push(row);
            }
            return out;
        });

        return ok({ days: updated, count: updated.length, mode: "upsert" });
    } catch (error) {
        // Catches any uncaught Postgres error (e.g. unique constraint, type cast).
        console.error("[/api/admin/schedule PUT] failed", error);
        return internal();
    }
}
