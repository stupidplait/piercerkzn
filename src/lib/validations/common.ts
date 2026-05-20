/**
 * Shared primitives used across the other validation modules.
 */
import { z } from "zod";

/** Russian mobile number — accepts +7XXXXXXXXXX or 8XXXXXXXXXX. */
export const phoneSchema = z
    .string()
    .trim()
    .regex(/^(\+7|8)\d{10}$/u, "Введите корректный номер телефона");

/** Email — trimmed, lowercased on parse. */
export const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .email("Введите корректный email")
    .max(255);

/** Free-text name field — single line, trimmed, sane length cap. */
export const nameSchema = z.string().trim().min(1, "Поле обязательно").max(100);

/** ISO 8601 date (YYYY-MM-DD) used by booking endpoints. */
export const isoDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "Дата должна быть в формате YYYY-MM-DD");

/** HH:MM (24h) — used by booking time slots. */
export const timeSchema = z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "Время должно быть в формате HH:MM");

/** UUID v4 — domain ids are UUIDs (per Drizzle schema). */
export const uuidSchema = z.string().uuid();

/** Pagination parameters. */
export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

/**
 * Strict string-to-boolean coercion for query-string booleans.
 *
 * `z.coerce.boolean()` is dangerous for query params because it calls
 * `Boolean(value)` — any non-empty string (including `"false"`) becomes
 * `true`. This helper explicitly recognises `"true"` and `"false"` only;
 * any other string fails validation rather than silently coercing.
 *
 * Use this anywhere a query-string flag is parsed by Zod. Existing routes
 * that still call `z.coerce.boolean()` should be migrated when touched.
 */
export const queryBoolean = z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
    return v; // let z.boolean() reject anything else
}, z.boolean());
