/**
 * Typed reader for the key-value `setting` table.
 *
 * Returns sensible defaults that match `src/db/seed.ts` so the app stays
 * functional in development without the seed having been run.
 *
 * Hot-path readers (booking settings) are wrapped with the Redis cache
 * (`@/lib/cache`) — the table is small and almost-never written; admin
 * save paths invalidate via `invalidateSettingsCache()`.
 */
import "server-only";

import { inArray } from "drizzle-orm";

import { cacheKey, delByPattern, getOrSet } from "@/lib/cache";
import { db, settings } from "@/db";

interface SettingValueText {
    text: string;
}
interface SettingValueNumber {
    number: number;
}
interface SettingValueBool {
    bool: boolean;
}
type SettingValue =
    | SettingValueText
    | SettingValueNumber
    | SettingValueBool
    | Record<string, unknown>;

export interface BookingSettings {
    /** Length of one slot on the booking grid, in minutes. */
    slotDurationMinutes: number;
    /** Buffer added between consecutive appointments, in minutes. */
    bufferMinutes: number;
    /** How many days ahead a customer may book. */
    advanceDays: number;
    /** Minimum lead time before an appointment, in hours (gates "today"). */
    minNoticeHours: number;
}

export interface AftercareSettings {
    /** Max offset days for the drip; steps with offset > maxDays are not enqueued. */
    maxDays: number;
    /** Piercing types eligible for the 6-week downsize reminder. */
    downsizePiercingTypes: string[];
}

export interface NewsletterSettings {
    /** SMTP `From` address used by newsletter dispatch; null until configured. */
    fromAddress: string | null;
    /** SMTP `Reply-To` address used by newsletter dispatch; null falls back to `fromAddress`. */
    replyTo: string | null;
    /** Number of recipient jobs grouped into a single chunk for pacing. */
    chunkSize: number;
    /** Delay in milliseconds between consecutive chunks at enqueue time. */
    chunkDelayMs: number;
    /** Threshold in milliseconds after which a `sending` campaign is considered stuck and recovered by the cron sweeper. */
    stuckAfterMs: number;
}

export interface TelegramBroadcastSettings {
    /** Recipients per chunk for the per-recipient producer. */
    chunkSize: number;
    /** Inter-chunk delay (ms) for the per-recipient producer. */
    chunkDelayMs: number;
    /** A broadcast in `sending` for longer than this (ms) is "stuck". */
    stuckAfterMs: number;
    /** Default Telegram parse mode applied to new broadcasts. */
    parseMode: "HTML" | "MarkdownV2";
}

const DEFAULTS: BookingSettings = {
    slotDurationMinutes: 30,
    bufferMinutes: 15,
    advanceDays: 30,
    minNoticeHours: 2,
};

const AFTERCARE_DEFAULTS: AftercareSettings = {
    maxDays: 90,
    downsizePiercingTypes: ["ear", "lip", "nose", "navel", "eyebrow"],
};

const NEWSLETTER_DEFAULTS: NewsletterSettings = {
    fromAddress: null,
    replyTo: null,
    chunkSize: 50,
    chunkDelayMs: 200,
    stuckAfterMs: 30 * 60 * 1000,
};

const TG_BROADCAST_DEFAULTS: TelegramBroadcastSettings = {
    chunkSize: 30,
    chunkDelayMs: 1100,
    stuckAfterMs: 30 * 60 * 1000,
    parseMode: "HTML",
};

const KEYS = [
    "booking.slot_duration_minutes",
    "booking.buffer_minutes",
    "booking.advance_days",
    "booking.min_notice_hours",
] as const;

const AFTERCARE_KEYS = ["aftercare.max_days", "aftercare.downsize_piercing_types"] as const;

const NEWSLETTER_KEYS = [
    "newsletter.from_address",
    "newsletter.reply_to",
    "newsletter.chunk_size",
    "newsletter.chunk_delay_ms",
    "newsletter.stuck_after_ms",
] as const;

const TG_BROADCAST_KEYS = [
    "tg.broadcast.chunk_size",
    "tg.broadcast.chunk_delay_ms",
    "tg.broadcast.stuck_after_ms",
    "tg.broadcast.parse_mode",
] as const;

function asNumber(v: unknown, fallback: number): number {
    if (
        v &&
        typeof v === "object" &&
        "number" in v &&
        typeof (v as SettingValueNumber).number === "number"
    ) {
        return (v as SettingValueNumber).number;
    }
    return fallback;
}

/**
 * Decode a `{ text }` setting value, falling back when the slot is missing
 * or stored under a non-string shape. Mirrors the `asNumber` shape so the
 * three readers (`asNumber`, `asTextOrNull`, `asStringList`) compose the
 * same way against rows produced by the canonical `{ key, value }` schema.
 */
function asTextOrNull(v: unknown, fallback: string | null): string | null {
    if (
        v &&
        typeof v === "object" &&
        "text" in v &&
        typeof (v as SettingValueText).text === "string"
    ) {
        return (v as SettingValueText).text;
    }
    return fallback;
}

/**
 * Decode a `{ text }` setting value into one of an allowed string-literal set.
 * Falls back when the value is missing or doesn't match. The fallback must be
 * one of the allowed values.
 */
function asTextEnum<T extends readonly string[]>(
    v: unknown,
    allowed: T,
    fallback: T[number]
): T[number] {
    if (
        v &&
        typeof v === "object" &&
        "text" in v &&
        typeof (v as SettingValueText).text === "string"
    ) {
        const t = (v as SettingValueText).text;
        if ((allowed as readonly string[]).includes(t)) return t as T[number];
    }
    return fallback;
}

/**
 * Tolerant list decoder.
 *
 * Accepts either the canonical wrapped shape `{ list: ["a", "b"] }` (preferred,
 * matches the `{ number }` / `{ bool }` / `{ text }` convention) or a bare
 * `["a", "b"]` JSON array so admin-authored values can use the simpler shape.
 * Non-string elements are filtered out; unknown / missing keys fall back to
 * the supplied default.
 */
function asStringList(v: unknown, fallback: readonly string[]): string[] {
    let candidate: unknown;
    if (Array.isArray(v)) {
        candidate = v;
    } else if (v && typeof v === "object" && "list" in v) {
        candidate = (v as { list: unknown }).list;
    } else {
        return [...fallback];
    }
    if (!Array.isArray(candidate)) return [...fallback];
    const out = candidate.filter((item): item is string => typeof item === "string");
    return out.length > 0 ? out : [...fallback];
}

async function loadBookingSettingsFromDb(): Promise<BookingSettings> {
    const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...KEYS]));

    const map = new Map<string, SettingValue>(rows.map((r) => [r.key, r.value as SettingValue]));

    return {
        slotDurationMinutes: asNumber(
            map.get("booking.slot_duration_minutes"),
            DEFAULTS.slotDurationMinutes
        ),
        bufferMinutes: asNumber(map.get("booking.buffer_minutes"), DEFAULTS.bufferMinutes),
        advanceDays: asNumber(map.get("booking.advance_days"), DEFAULTS.advanceDays),
        minNoticeHours: asNumber(map.get("booking.min_notice_hours"), DEFAULTS.minNoticeHours),
    };
}

/**
 * Load all booking-related settings in a single query, with defaults applied
 * for any missing keys.
 *
 * Cached for 5 minutes (with ±10% jitter + SWR grace) — settings are admin-
 * authored and rarely change; the admin save path calls
 * `invalidateSettingsCache()` for fresh reads.
 */
export async function getBookingSettings(): Promise<BookingSettings> {
    return getOrSet(cacheKey.bookingSettings(), { ttlSeconds: 300 }, loadBookingSettingsFromDb);
}

async function loadAftercareSettingsFromDb(): Promise<AftercareSettings> {
    const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...AFTERCARE_KEYS]));

    const map = new Map<string, SettingValue>(rows.map((r) => [r.key, r.value as SettingValue]));

    return {
        maxDays: asNumber(map.get("aftercare.max_days"), AFTERCARE_DEFAULTS.maxDays),
        downsizePiercingTypes: asStringList(
            map.get("aftercare.downsize_piercing_types"),
            AFTERCARE_DEFAULTS.downsizePiercingTypes
        ),
    };
}

/**
 * Load all aftercare-related settings in a single query, with defaults
 * applied for any missing keys.
 *
 * Cached for 5 minutes under `settings:aftercare` so `invalidateSettingsCache()`
 * (which globs `settings:*`) drops it alongside the booking cache. The admin
 * save path calls `invalidateSettingsCache()` for fresh reads.
 */
export async function getAftercareSettings(): Promise<AftercareSettings> {
    return getOrSet("settings:aftercare", { ttlSeconds: 300 }, loadAftercareSettingsFromDb);
}

async function loadNewsletterSettingsFromDb(): Promise<NewsletterSettings> {
    const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...NEWSLETTER_KEYS]));

    const map = new Map<string, SettingValue>(rows.map((r) => [r.key, r.value as SettingValue]));

    return {
        fromAddress: asTextOrNull(
            map.get("newsletter.from_address"),
            NEWSLETTER_DEFAULTS.fromAddress
        ),
        replyTo: asTextOrNull(map.get("newsletter.reply_to"), NEWSLETTER_DEFAULTS.replyTo),
        chunkSize: asNumber(map.get("newsletter.chunk_size"), NEWSLETTER_DEFAULTS.chunkSize),
        chunkDelayMs: asNumber(
            map.get("newsletter.chunk_delay_ms"),
            NEWSLETTER_DEFAULTS.chunkDelayMs
        ),
        stuckAfterMs: asNumber(
            map.get("newsletter.stuck_after_ms"),
            NEWSLETTER_DEFAULTS.stuckAfterMs
        ),
    };
}

/**
 * Load all newsletter-related settings in a single query, with defaults
 * applied for any missing keys.
 *
 * Cached for 5 minutes under `settings:newsletter` so `invalidateSettingsCache()`
 * (which globs `settings:*`) drops it alongside the booking and aftercare
 * caches. The admin save path calls `invalidateSettingsCache()` for fresh
 * reads.
 */
export async function getNewsletterSettings(): Promise<NewsletterSettings> {
    return getOrSet("settings:newsletter", { ttlSeconds: 300 }, loadNewsletterSettingsFromDb);
}

async function loadTelegramBroadcastSettingsFromDb(): Promise<TelegramBroadcastSettings> {
    const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...TG_BROADCAST_KEYS]));

    const map = new Map<string, SettingValue>(rows.map((r) => [r.key, r.value as SettingValue]));

    return {
        chunkSize: asNumber(map.get("tg.broadcast.chunk_size"), TG_BROADCAST_DEFAULTS.chunkSize),
        chunkDelayMs: asNumber(
            map.get("tg.broadcast.chunk_delay_ms"),
            TG_BROADCAST_DEFAULTS.chunkDelayMs
        ),
        stuckAfterMs: asNumber(
            map.get("tg.broadcast.stuck_after_ms"),
            TG_BROADCAST_DEFAULTS.stuckAfterMs
        ),
        parseMode: asTextEnum(
            map.get("tg.broadcast.parse_mode"),
            ["HTML", "MarkdownV2"] as const,
            TG_BROADCAST_DEFAULTS.parseMode
        ),
    };
}

/**
 * Load all telegram-broadcast-related settings in a single query, with
 * defaults applied for any missing keys.
 *
 * Cached for 5 minutes under `settings:tg-broadcast` so
 * `invalidateSettingsCache()` (which globs `settings:*`) drops it alongside
 * the booking, aftercare, and newsletter caches. The admin save path calls
 * `invalidateSettingsCache()` for fresh reads.
 */
export async function getTelegramBroadcastSettings(): Promise<TelegramBroadcastSettings> {
    return getOrSet(
        "settings:tg-broadcast",
        { ttlSeconds: 300 },
        loadTelegramBroadcastSettingsFromDb
    );
}

/**
 * Drop every cached settings namespace. Call from admin save paths so the
 * next read returns fresh values without waiting for the SWR window.
 */
export async function invalidateSettingsCache(): Promise<void> {
    await delByPattern("settings:*");
}

export const BOOKING_SETTINGS_DEFAULTS = DEFAULTS;
export const AFTERCARE_SETTINGS_DEFAULTS = AFTERCARE_DEFAULTS;
export const NEWSLETTER_SETTINGS_DEFAULTS = NEWSLETTER_DEFAULTS;
export const TG_BROADCAST_SETTINGS_DEFAULTS = TG_BROADCAST_DEFAULTS;
