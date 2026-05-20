/**
 * Time helpers for the booking domain.
 *
 * The studio operates exclusively in **Europe/Moscow**. Russia abolished
 * Daylight Saving in 2014, so the offset is a constant `UTC+03:00` — we don't
 * need a full IANA library for the conversion.
 *
 * `appointment.date` (`YYYY-MM-DD`) and `appointment.time_start` (`HH:MM` or
 * `HH:MM:SS`) are stored as wall-clock studio time. Reminder schedulers,
 * cron sweepers, and Telegram pushes all need a real UTC `Date` to compare
 * against `Date.now()`.
 */
import "server-only";

export const STUDIO_TIMEZONE = "Europe/Moscow";
export const STUDIO_UTC_OFFSET = "+03:00";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/u;

/**
 * Parse a studio-local appointment instant into a UTC `Date`. Returns `null`
 * if either input is malformed — callers should treat that as a bug, not a
 * runtime expectation.
 */
export function appointmentStartUtc(date: string, timeStart: string): Date | null {
    if (!DATE_RE.test(date) || !TIME_RE.test(timeStart)) return null;
    const t = timeStart.length === 5 ? `${timeStart}:00` : timeStart;
    const d = new Date(`${date}T${t}${STUDIO_UTC_OFFSET}`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a UTC instant as a Russian-locale date+time string in the studio's
 * timezone. Used in email subjects and Telegram messages.
 *
 *   2026-05-14T07:00:00Z → "14.05.2026, 10:00 МСК"
 */
export function formatStudioDateTime(utc: Date): string {
    const datePart = utc.toLocaleDateString("ru-RU", {
        timeZone: STUDIO_TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
    const timePart = utc.toLocaleTimeString("ru-RU", {
        timeZone: STUDIO_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    return `${datePart}, ${timePart} МСК`;
}

/**
 * Compute the delay (in milliseconds) from `now` to a target `utc` instant.
 * Returns 0 when the target is in the past — callers should typically skip
 * scheduling instead of firing immediately.
 */
export function delayMsUntil(target: Date, now: Date = new Date()): number {
    const ms = target.getTime() - now.getTime();
    return ms > 0 ? ms : 0;
}
