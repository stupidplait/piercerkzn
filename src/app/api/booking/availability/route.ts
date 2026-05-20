/**
 * GET /api/booking/availability
 *
 * Returns bookable start times per calendar day in `[startDate, endDate]` for
 * the given service combination, computed against:
 *   - the recurring weekly schedule (`piercer_schedule`)
 *   - per-day overrides (`schedule_exception`)
 *   - one-off blocks (`time_block`)
 *   - existing non-cancelled appointments
 *   - studio settings (`booking.slot_duration_minutes`, `booking.buffer_minutes`,
 *     `booking.advance_days`, `booking.min_notice_hours`)
 *
 * Query params:
 *   - `startDate`  ISO date `YYYY-MM-DD`
 *   - `endDate`    ISO date `YYYY-MM-DD` (≤ 60 days range; clamped to
 *                  `today + advance_days`)
 *   - `serviceIds` optional, comma-separated UUIDs (max 5). When omitted the
 *                  required duration falls back to one slot.
 *
 * All wall-clock arithmetic is done in **Europe/Moscow** (Kazan studio time),
 * which is UTC+3 year-round.
 */
import { and, eq, gte, inArray, lte, ne, notInArray } from "drizzle-orm";

import { fail, internal, ok, parseQuery } from "@/lib/api";
import {
    appointments,
    db,
    piercerSchedule,
    scheduleExceptions,
    services as servicesTable,
    timeBlocks,
} from "@/db";
import {
    computeSlotsForDay,
    dayOfWeekForDate,
    eachDateInRange,
    minutesToHm,
    parseHmsToMinutes,
    type AvailabilityDay,
    type TimeRange,
} from "@/lib/booking/availability";
import { getBookingSettings } from "@/lib/settings";
import { availabilityRouteQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDIO_TZ = "Europe/Moscow";
const MAX_RANGE_DAYS = 60;

interface MoscowNow {
    /** `YYYY-MM-DD` in studio-local time. */
    date: string;
    /** Minutes from midnight, studio-local. */
    minutes: number;
}

function studioNow(): MoscowNow {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: STUDIO_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date());

    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const date = `${parts.find((p) => p.type === "year")?.value}-${
        parts.find((p) => p.type === "month")?.value
    }-${parts.find((p) => p.type === "day")?.value}`;
    const minutes = get("hour") * 60 + get("minute");
    return { date, minutes };
}

/** Returns -1 / 0 / +1 ordering of two `YYYY-MM-DD` dates (string-sortable). */
function cmpDate(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function addDays(dateIso: string, days: number): string {
    const d = new Date(`${dateIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

interface BreakDef {
    start: string;
    end: string;
}

function parseBreaks(raw: unknown): TimeRange[] {
    if (!Array.isArray(raw)) return [];
    const out: TimeRange[] = [];
    for (const b of raw) {
        if (!b || typeof b !== "object") continue;
        const def = b as Partial<BreakDef>;
        const s = parseHmsToMinutes(def.start ?? null);
        const e = parseHmsToMinutes(def.end ?? null);
        if (s !== null && e !== null && e > s) out.push({ start: s, end: e });
    }
    return out;
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, availabilityRouteQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    if (cmpDate(q.endDate, q.startDate) < 0) {
        return fail("invalid_range", "endDate должен быть не раньше startDate", { status: 400 });
    }

    try {
        const settings = await getBookingSettings();
        const now = studioNow();

        // Clamp the range: never look at the past, never beyond advance_days.
        const advanceCutoff = addDays(now.date, settings.advanceDays);
        const effectiveStart = cmpDate(q.startDate, now.date) < 0 ? now.date : q.startDate;
        const effectiveEnd = cmpDate(q.endDate, advanceCutoff) > 0 ? advanceCutoff : q.endDate;

        if (cmpDate(effectiveEnd, effectiveStart) < 0) {
            return ok({
                startDate: q.startDate,
                endDate: q.endDate,
                effectiveStartDate: effectiveStart,
                effectiveEndDate: effectiveEnd,
                requiredDurationMin: 0,
                slotStepMin: settings.slotDurationMinutes,
                days: [],
            });
        }

        const dates = eachDateInRange(effectiveStart, effectiveEnd);
        if (dates.length > MAX_RANGE_DAYS) {
            return fail("range_too_large", `Запрашивайте не более ${MAX_RANGE_DAYS} дней за раз`, {
                status: 400,
            });
        }

        // -----------------------------------------------------------------
        // Compute required duration from selected services + booking buffer.
        // -----------------------------------------------------------------
        let serviceDuration = 0;
        if (q.serviceIds.length > 0) {
            const rows = await db
                .select({
                    id: servicesTable.id,
                    duration: servicesTable.durationMinutes,
                })
                .from(servicesTable)
                .where(
                    and(inArray(servicesTable.id, q.serviceIds), eq(servicesTable.isActive, true))
                );

            if (rows.length !== q.serviceIds.length) {
                return fail("service_not_found", "Одна или несколько выбранных услуг недоступны", {
                    status: 400,
                });
            }
            serviceDuration = rows.reduce((acc, r) => acc + (r.duration ?? 0), 0);
        }

        const requiredDurationMin =
            (serviceDuration > 0 ? serviceDuration : settings.slotDurationMinutes) +
            settings.bufferMinutes;

        // -----------------------------------------------------------------
        // Bulk-load all schedule data for the range in parallel.
        // -----------------------------------------------------------------
        const [weeklyRows, exceptionRows, blockRows, appointmentRows] = await Promise.all([
            db.select().from(piercerSchedule),
            db
                .select()
                .from(scheduleExceptions)
                .where(
                    and(
                        gte(scheduleExceptions.date, effectiveStart),
                        lte(scheduleExceptions.date, effectiveEnd)
                    )
                ),
            db
                .select()
                .from(timeBlocks)
                .where(
                    and(gte(timeBlocks.date, effectiveStart), lte(timeBlocks.date, effectiveEnd))
                ),
            db
                .select({
                    date: appointments.date,
                    timeStart: appointments.timeStart,
                    timeEnd: appointments.timeEnd,
                    status: appointments.status,
                })
                .from(appointments)
                .where(
                    and(
                        gte(appointments.date, effectiveStart),
                        lte(appointments.date, effectiveEnd),
                        // Both representations exist in spec — support either.
                        notInArray(appointments.status, ["cancelled", "no_show"]),
                        ne(appointments.status, "rescheduled")
                    )
                ),
        ]);

        // Index by day-of-week (0=Mon..6=Sun) and by date string.
        const weeklyByDay = new Map<number, (typeof weeklyRows)[number]>();
        for (const w of weeklyRows) weeklyByDay.set(w.dayOfWeek, w);

        const exceptionByDate = new Map<string, (typeof exceptionRows)[number]>();
        for (const e of exceptionRows) exceptionByDate.set(e.date, e);

        const blocksByDate = new Map<string, TimeRange[]>();
        for (const b of blockRows) {
            const s = parseHmsToMinutes(b.startTime);
            const e = parseHmsToMinutes(b.endTime);
            if (s === null || e === null || e <= s) continue;
            const list = blocksByDate.get(b.date) ?? [];
            list.push({ start: s, end: e });
            blocksByDate.set(b.date, list);
        }

        const appointmentsByDate = new Map<string, TimeRange[]>();
        for (const a of appointmentRows) {
            const s = parseHmsToMinutes(a.timeStart);
            const e = parseHmsToMinutes(a.timeEnd);
            if (s === null || e === null || e <= s) continue;
            const list = appointmentsByDate.get(a.date) ?? [];
            list.push({ start: s, end: e });
            appointmentsByDate.set(a.date, list);
        }

        // -----------------------------------------------------------------
        // Compute slots day-by-day.
        // -----------------------------------------------------------------
        const earliestStartMinForToday = now.minutes + settings.minNoticeHours * 60;

        const days: AvailabilityDay[] = dates.map((date) => {
            // Resolve working window: exception > weekly schedule.
            let workingWindow: TimeRange | null = null;
            let breaks: TimeRange[] = [];

            const exception = exceptionByDate.get(date);
            if (exception) {
                if (exception.isWorking) {
                    const s = parseHmsToMinutes(exception.startTime);
                    const e = parseHmsToMinutes(exception.endTime);
                    if (s !== null && e !== null && e > s) {
                        workingWindow = { start: s, end: e };
                    }
                }
                // Exceptions don't carry breaks — they replace the day wholesale.
            } else {
                const dow = dayOfWeekForDate(date);
                const weekly = dow !== null ? weeklyByDay.get(dow) : undefined;
                if (weekly && weekly.isWorking) {
                    const s = parseHmsToMinutes(weekly.startTime);
                    const e = parseHmsToMinutes(weekly.endTime);
                    if (s !== null && e !== null && e > s) {
                        workingWindow = { start: s, end: e };
                        breaks = parseBreaks(weekly.breaks);
                    }
                }
            }

            const earliestStartMin = date === now.date ? earliestStartMinForToday : 0;

            return computeSlotsForDay({
                date,
                workingWindow,
                breaks,
                blocks: blocksByDate.get(date) ?? [],
                appointments: appointmentsByDate.get(date) ?? [],
                earliestStartMin,
                requiredDurationMin,
                slotStepMin: settings.slotDurationMinutes,
            });
        });

        return ok({
            startDate: q.startDate,
            endDate: q.endDate,
            effectiveStartDate: effectiveStart,
            effectiveEndDate: effectiveEnd,
            requiredDurationMin,
            slotStepMin: settings.slotDurationMinutes,
            currentTime: {
                date: now.date,
                time: minutesToHm(now.minutes),
                tz: STUDIO_TZ,
            },
            days,
        });
    } catch (error) {
        console.error("[/api/booking/availability] failed", error);
        return internal();
    }
}

// `MAX_RANGE_DAYS` is intentionally NOT exported from this route file —
// Next.js 16's route-handler type validator rejects any export beyond
// the HTTP method handlers + the allow-listed metadata names. The
// constant is only used inside this module.
