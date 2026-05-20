/**
 * Aftercare drip timing.
 *
 * The drip is anchored to `aftercare_tracking.piercing_date` (a studio-local
 * `YYYY-MM-DD`). Each step fires at **09:00 МСК** on the configured offset
 * day — early enough to land before clients leave for work, late enough to
 * not wake anyone up the night before.
 *
 * Pure module — DB-free — so it can be unit-tested without a DB harness.
 */
import "server-only";

import { appointmentStartUtc } from "@/lib/booking/time";

export type AftercareStep = "day1" | "day3" | "day7" | "day14" | "day30" | "day60" | "day90";
export const AFTERCARE_STEPS: readonly AftercareStep[] = [
    "day1",
    "day3",
    "day7",
    "day14",
    "day30",
    "day60",
    "day90",
] as const;

/** Days elapsed between the piercing date and each step's fire time. */
export const STEP_OFFSET_DAYS: Record<AftercareStep, number> = {
    day1: 1,
    day3: 3,
    day7: 7,
    day14: 14,
    day30: 30,
    day60: 60,
    day90: 90,
};

/** Studio-local fire time of day (09:00 МСК). */
export const STEP_FIRE_TIME_LOCAL = "09:00";

/**
 * Compute the UTC instant at which a given aftercare step should be sent.
 * Returns `null` for malformed input.
 */
export function aftercareStepFireUtc(piercingDate: string, step: AftercareStep): Date | null {
    // We don't need a heavyweight date library: build the target studio-local
    // date by string-manipulating the ISO date forward, then convert to UTC
    // via the existing `appointmentStartUtc` (studio is permanently +03:00).
    const target = addDaysIso(piercingDate, STEP_OFFSET_DAYS[step]);
    if (!target) return null;
    return appointmentStartUtc(target, STEP_FIRE_TIME_LOCAL);
}

/**
 * Add `days` to an ISO `YYYY-MM-DD` date, returning the resulting ISO date.
 * Uses UTC arithmetic deliberately — the studio's offset is constant so we
 * never cross a DST boundary.
 */
export function addDaysIso(iso: string, days: number): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return null;
    const base = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) return null;
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
}
