/**
 * Typed disjoint-union parser/formatter for Telegram callback_data payloads
 * used by the `/reserve` (`rsv:`) and `/book` (`bk:`) interactive flows.
 *
 * The grammars are defined in design.md §6 (Callback Data Grammar). Both
 * namespaces use `:` as the field separator. Telegram caps `callback_data` at
 * 64 bytes; every formatter in this module produces strings that satisfy that
 * invariant for any input the higher-level flow modules can construct.
 *
 * `parseReserve` / `parseBook` never throw; they return `null` when the input
 * does not match the grammar so callers can safely route on the prefix and
 * ignore unknown payloads (forwards-compatible).
 */
import "server-only";

// ---------------------------------------------------------------------------
// Reserve namespace ── prefix "rsv:"
// ---------------------------------------------------------------------------

export type ReserveCallback =
    | { kind: "category"; categoryId: string } // rsv:cat:<id>
    | { kind: "product"; productId: string; page: number } // rsv:prod:<id>:p:<n>
    | { kind: "productPage"; page: number } // rsv:prodpage:<n>
    | { kind: "variant"; variantId: string } // rsv:var:<id>
    | { kind: "confirm" } // rsv:cnf
    | { kind: "cancel" } // rsv:cancel
    | { kind: "back" } // rsv:back
    | { kind: "start" }; // rsv:start

// ---------------------------------------------------------------------------
// Book namespace ── prefix "bk:"
// ---------------------------------------------------------------------------

export type BookCallback =
    | { kind: "service"; serviceId: string } // bk:svc:<id>
    | { kind: "date"; date: string } // bk:date:<YYYY-MM-DD>
    | { kind: "time"; time: string } // bk:time:<HH:mm>
    | { kind: "timePage"; page: number } // bk:time_page:<n>
    | { kind: "confirm" } // bk:cnf
    | { kind: "cancel" } // bk:cancel
    | { kind: "back" } // bk:back
    | { kind: "start" }; // bk:start

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Compile-time exhaustiveness helper. If a new variant is added to a
 * disjoint union without a matching `case`, TypeScript flags the call site.
 */
function assertNever(value: never): never {
    throw new Error(`Unhandled callback variant: ${JSON.stringify(value)}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_RE = /^\d{2}:\d{2}$/u;

/** Non-negative integer parser: returns null for negatives, NaN, or non-digit input. */
function parseNonNegativeInt(raw: string): number | null {
    if (raw.length === 0) return null;
    // Reject signs, decimals, whitespace — only ASCII digits allowed.
    if (!/^\d+$/u.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** Invariant: byteLength(returned) ≤ 64 (Telegram callback_data limit). */
export function formatReserve(cb: ReserveCallback): string {
    switch (cb.kind) {
        case "category":
            return `rsv:cat:${cb.categoryId}`;
        case "product":
            return `rsv:prod:${cb.productId}:p:${cb.page}`;
        case "productPage":
            return `rsv:prodpage:${cb.page}`;
        case "variant":
            return `rsv:var:${cb.variantId}`;
        case "confirm":
            return "rsv:cnf";
        case "cancel":
            return "rsv:cancel";
        case "back":
            return "rsv:back";
        case "start":
            return "rsv:start";
        default:
            return assertNever(cb);
    }
}

/** Invariant: byteLength(returned) ≤ 64 (Telegram callback_data limit). */
export function formatBook(cb: BookCallback): string {
    switch (cb.kind) {
        case "service":
            return `bk:svc:${cb.serviceId}`;
        case "date":
            return `bk:date:${cb.date}`;
        case "time":
            return `bk:time:${cb.time}`;
        case "timePage":
            return `bk:time_page:${cb.page}`;
        case "confirm":
            return "bk:cnf";
        case "cancel":
            return "bk:cancel";
        case "back":
            return "bk:back";
        case "start":
            return "bk:start";
        default:
            return assertNever(cb);
    }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse a `rsv:`-prefixed callback payload into a typed `ReserveCallback`.
 * Returns `null` for any malformed or unknown input; never throws.
 */
export function parseReserve(raw: string): ReserveCallback | null {
    if (typeof raw !== "string" || raw.length === 0) return null;
    const parts = raw.split(":");
    if (parts.length < 2 || parts[0] !== "rsv") return null;

    const kind = parts[1];
    switch (kind) {
        case "cat": {
            // rsv:cat:<id>  → exactly 3 parts
            if (parts.length !== 3) return null;
            const categoryId = parts[2];
            if (!categoryId) return null;
            return { kind: "category", categoryId };
        }
        case "prod": {
            // rsv:prod:<id>:p:<n>  → exactly 5 parts, parts[3] === "p"
            if (parts.length !== 5) return null;
            const productId = parts[2];
            if (!productId) return null;
            if (parts[3] !== "p") return null;
            const page = parseNonNegativeInt(parts[4]);
            if (page === null) return null;
            return { kind: "product", productId, page };
        }
        case "prodpage": {
            // rsv:prodpage:<n>  → exactly 3 parts
            if (parts.length !== 3) return null;
            const page = parseNonNegativeInt(parts[2]);
            if (page === null) return null;
            return { kind: "productPage", page };
        }
        case "var": {
            // rsv:var:<id>  → exactly 3 parts
            if (parts.length !== 3) return null;
            const variantId = parts[2];
            if (!variantId) return null;
            return { kind: "variant", variantId };
        }
        case "cnf":
            return parts.length === 2 ? { kind: "confirm" } : null;
        case "cancel":
            return parts.length === 2 ? { kind: "cancel" } : null;
        case "back":
            return parts.length === 2 ? { kind: "back" } : null;
        case "start":
            return parts.length === 2 ? { kind: "start" } : null;
        default:
            return null;
    }
}

/**
 * Parse a `bk:`-prefixed callback payload into a typed `BookCallback`.
 * Returns `null` for any malformed or unknown input; never throws.
 */
export function parseBook(raw: string): BookCallback | null {
    if (typeof raw !== "string" || raw.length === 0) return null;
    const parts = raw.split(":");
    if (parts.length < 2 || parts[0] !== "bk") return null;

    const kind = parts[1];
    switch (kind) {
        case "svc": {
            // bk:svc:<id>  → exactly 3 parts
            if (parts.length !== 3) return null;
            const serviceId = parts[2];
            if (!serviceId) return null;
            return { kind: "service", serviceId };
        }
        case "date": {
            // bk:date:<YYYY-MM-DD>  → exactly 3 parts, ISO date shape
            if (parts.length !== 3) return null;
            const date = parts[2];
            if (!date || !DATE_RE.test(date)) return null;
            return { kind: "date", date };
        }
        case "time": {
            // bk:time:<HH:mm>  → split produces 4 parts because of the `:` in HH:mm.
            if (parts.length !== 4) return null;
            const time = `${parts[2]}:${parts[3]}`;
            if (!TIME_RE.test(time)) return null;
            return { kind: "time", time };
        }
        case "time_page": {
            // bk:time_page:<n>  → exactly 3 parts
            if (parts.length !== 3) return null;
            const page = parseNonNegativeInt(parts[2]);
            if (page === null) return null;
            return { kind: "timePage", page };
        }
        case "cnf":
            return parts.length === 2 ? { kind: "confirm" } : null;
        case "cancel":
            return parts.length === 2 ? { kind: "cancel" } : null;
        case "back":
            return parts.length === 2 ? { kind: "back" } : null;
        case "start":
            return parts.length === 2 ? { kind: "start" } : null;
        default:
            return null;
    }
}
