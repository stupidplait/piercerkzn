/**
 * Availability — pure scheduling logic.
 *
 * Composes the piercer's recurring weekly schedule, per-day exceptions, one-off
 * time blocks, and existing appointments into a list of bookable start times
 * for a given calendar day, given the total duration of the requested service
 * combination plus the configured buffer.
 *
 * Everything in this module operates in **studio-local time**. Conversion from
 * JS `Date` to "Europe/Moscow" wall-clock minutes-from-midnight is done in the
 * route handler before calling these helpers.
 *
 * Day-of-week convention matches `piercer_schedule.day_of_week` (seeded in
 * `src/db/seed.ts`): **0 = Monday … 6 = Sunday**.
 *
 * Times are minutes from midnight (0..1440). `time` columns from Postgres
 * arrive as `HH:MM:SS` strings; use `parseHmsToMinutes()` to convert.
 */

export interface TimeRange {
    start: number; // minutes from midnight, inclusive
    end: number; // minutes from midnight, exclusive
}

export interface AvailabilityDayInput {
    /** ISO date `YYYY-MM-DD`. */
    date: string;
    /** Working window for the day, or `null` if the studio is closed. */
    workingWindow: TimeRange | null;
    /** Recurring breaks (e.g. lunch). */
    breaks: TimeRange[];
    /** One-off blocked intervals on this date. */
    blocks: TimeRange[];
    /** Existing non-cancelled appointments on this date. */
    appointments: TimeRange[];
    /**
     * Earliest acceptable start time on this date, in minutes from midnight.
     * Used to enforce `booking.min_notice_hours` for "today".
     * Set to `0` when the date is in the future.
     */
    earliestStartMin: number;
    /** Total duration of the requested service combo + booking buffer. */
    requiredDurationMin: number;
    /** Slot grid step (typically `booking.slot_duration_minutes`). */
    slotStepMin: number;
}

export interface AvailabilityDay {
    date: string;
    isWorkingDay: boolean;
    /** Available start times as `HH:MM` strings. */
    slots: string[];
}

/** Convert `HH:MM:SS` (or `HH:MM`) to minutes from midnight. */
export function parseHmsToMinutes(hms: string | null | undefined): number | null {
    if (!hms) return null;
    const m = /^(\d{2}):(\d{2})(?::\d{2})?$/u.exec(hms);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 24 || min < 0 || min > 59) return null;
    const total = h * 60 + min;
    if (total < 0 || total > 24 * 60) return null;
    return total;
}

/** Render minutes from midnight as `HH:MM`. */
export function minutesToHm(total: number): string {
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Subtract a list of busy intervals from a single base interval, returning
 * the remaining free intervals. Inputs need NOT be sorted; output is sorted
 * ascending and never overlapping.
 */
export function subtractIntervals(base: TimeRange, busy: TimeRange[]): TimeRange[] {
    if (base.end <= base.start) return [];

    // Merge the busy list (sort + coalesce overlapping/adjacent ranges).
    const sorted = busy
        .filter((b) => b.end > b.start)
        .map((b) => ({ start: Math.max(b.start, base.start), end: Math.min(b.end, base.end) }))
        .filter((b) => b.end > b.start)
        .sort((a, b) => a.start - b.start);

    const merged: TimeRange[] = [];
    for (const r of sorted) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end) {
            last.end = Math.max(last.end, r.end);
        } else {
            merged.push({ start: r.start, end: r.end });
        }
    }

    // Walk the base interval, emitting the gaps between busy ranges.
    const out: TimeRange[] = [];
    let cursor = base.start;
    for (const r of merged) {
        if (r.start > cursor) out.push({ start: cursor, end: r.start });
        cursor = Math.max(cursor, r.end);
    }
    if (cursor < base.end) out.push({ start: cursor, end: base.end });
    return out;
}

/**
 * Compute the list of bookable start times for one day.
 *
 * Slots are stepped by `slotStepMin` **from `workingWindow.start`** (so the
 * grid is anchored to the start of the working day, not to the start of
 * each free sub-interval), and a slot is only emitted when the full
 * `requiredDurationMin` window fits inside the same free sub-interval AND
 * lies above the `earliestStartMin` floor.
 *
 * Anchoring to `workingWindow.start` (rather than `interval.start`) means
 * every emitted slot satisfies the predicate
 *   `(start - workingWindow.start) % slotStepMin === 0`
 * regardless of how breaks / blocks / appointments carve up the day. This
 * is the contract Phase 3 PBT Property 6 verifies and that the customer-
 * facing UI relies on for clean grid times like 09:00 / 09:30 / 10:00 (it
 * never surfaces a slot at an off-grid minute that just happens to sit
 * after a busy interval).
 */
export function computeSlotsForDay(input: AvailabilityDayInput): AvailabilityDay {
    const {
        date,
        workingWindow,
        breaks,
        blocks,
        appointments,
        earliestStartMin,
        requiredDurationMin,
        slotStepMin,
    } = input;

    if (!workingWindow || workingWindow.end <= workingWindow.start) {
        return { date, isWorkingDay: false, slots: [] };
    }
    if (requiredDurationMin <= 0 || slotStepMin <= 0) {
        return { date, isWorkingDay: true, slots: [] };
    }

    const free = subtractIntervals(workingWindow, [...breaks, ...blocks, ...appointments]);

    const slots: string[] = [];
    for (const interval of free) {
        // Align the first candidate to the slot grid relative to
        // `workingWindow.start` (NOT `interval.start`), and respect the
        // earliest-start floor. This anchoring is what guarantees clean
        // grid times like 09:00 / 09:30 even when the preceding sub-
        // interval ended at an arbitrary minute (e.g. an appointment
        // running until 09:01).
        const floor = Math.max(interval.start, earliestStartMin);
        const offset = (floor - workingWindow.start) % slotStepMin;
        let cursor = offset === 0 ? floor : floor + (slotStepMin - offset);

        while (cursor + requiredDurationMin <= interval.end) {
            slots.push(minutesToHm(cursor));
            cursor += slotStepMin;
        }
    }

    return { date, isWorkingDay: true, slots };
}

/** Iterate ISO `YYYY-MM-DD` dates from `start` to `end` inclusive. */
export function eachDateInRange(start: string, end: string): string[] {
    const out: string[] = [];
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return out;
    const cursor = new Date(s);
    while (cursor <= e) {
        out.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
}

/**
 * Convert a JS `Date` to the day-of-week index used by `piercer_schedule`
 * (0 = Monday, 6 = Sunday) **for the given ISO date string**. The argument
 * itself is unused — we derive day-of-week purely from the date string so
 * the result is timezone-invariant.
 */
export function dayOfWeekForDate(dateIso: string): number | null {
    const d = new Date(`${dateIso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const jsDay = d.getUTCDay(); // 0 = Sun
    return (jsDay + 6) % 7; // shift so 0 = Mon
}
