/**
 * Pure keyboard builders for the Telegram `/reserve` and `/book` flows.
 *
 * Every function in this module is pure: data in, grammY `InlineKeyboard`
 * (or a plain Telegram reply-keyboard object for `buildContactReplyKeyboard`)
 * out. No DB access, no I/O.
 *
 * The inline keyboards always end with a footer row built via
 * `buildSharedFooter({ namespace, includeBack })` so every flow step carries
 * an «Отмена» button (Requirement 10.2) and, where applicable, a «Назад»
 * button.
 *
 * All `callback_data` strings are produced via `formatReserve` / `formatBook`
 * so the wire-format invariant lives in exactly one place
 * (`./callback-data`). Hand-built callback strings are forbidden in this
 * module.
 *
 * Russian copy is hard-coded; this matches the project's "single language"
 * Telegram surface (Requirement 12).
 *
 * Layout decisions follow design §8 (Keyboard Architecture):
 *   - Categories: 1 button per row.
 *   - Products: 1 button per row, paginated (default `pageSize = 10`).
 *   - Variants: 1 button per row.
 *   - Services: 1 button per row.
 *   - Date picker: 1 button per row, max 21 entries (caller pre-filters).
 *   - Time picker: 4 columns × 3 rows grid (default `pageSize = 12`).
 *   - Confirm: single row `[Подтвердить, Отмена]`.
 */
import "server-only";

import { InlineKeyboard } from "grammy";

import { formatBook, formatReserve } from "./callback-data";

// ---------------------------------------------------------------------------
// Public input shapes
// ---------------------------------------------------------------------------

export interface CategoryItem {
    id: string;
    name: string;
}

export interface ProductItem {
    id: string;
    title: string;
}

export interface VariantItem {
    id: string;
    label: string;
}

export interface ServiceItem {
    id: string;
    title: string;
}

/**
 * Plain Telegram reply-keyboard payload returned by
 * `buildContactReplyKeyboard`. Returned as a structural object (rather than
 * a grammY `Keyboard` instance) so callers can pass it directly to
 * `ctx.reply(text, { reply_markup })` without an extra wrap.
 */
export interface ContactReplyKeyboard {
    keyboard: Array<Array<{ text: string; request_contact?: boolean }>>;
    one_time_keyboard: true;
    resize_keyboard: true;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PRODUCT_PAGE_SIZE = 10;
const DEFAULT_TIME_PAGE_SIZE = 12;
const TIME_COLUMNS = 4;
const MAX_DATE_BUTTONS = 21;

// ---------------------------------------------------------------------------
// Shared footer
// ---------------------------------------------------------------------------

/**
 * Append the standard footer row to an existing `InlineKeyboard` and return
 * the mutated keyboard for chaining.
 *
 * - When `includeBack` is `true`: footer is `[Назад, Отмена]`.
 * - When `includeBack` is `false`: footer is `[Отмена]`.
 *
 * `namespace` selects which callback grammar (`rsv:` vs `bk:`) the buttons
 * emit; payloads are formatted via the canonical formatters so this module
 * never hand-assembles callback strings.
 */
function appendSharedFooter(
    kb: InlineKeyboard,
    opts: { namespace: "rsv" | "bk"; includeBack: boolean }
): InlineKeyboard {
    const backLabel = "Назад";
    const cancelLabel = "Отмена";

    const cancelData =
        opts.namespace === "rsv"
            ? formatReserve({ kind: "cancel" })
            : formatBook({ kind: "cancel" });
    const backData =
        opts.namespace === "rsv" ? formatReserve({ kind: "back" }) : formatBook({ kind: "back" });

    kb.row();
    if (opts.includeBack) {
        kb.text(backLabel, backData).text(cancelLabel, cancelData);
    } else {
        kb.text(cancelLabel, cancelData);
    }
    return kb;
}

/**
 * Public footer builder. Mirrors `appendSharedFooter` but constructs a fresh
 * keyboard so callers that just need the standalone row (e.g. error replies)
 * can use it without composing.
 *
 * Most flow renderers should call the builders below directly; this export
 * is here to satisfy the design §8.4 contract.
 */
export function buildSharedFooter(opts: {
    namespace: "rsv" | "bk";
    includeBack: boolean;
}): InlineKeyboard {
    const kb = new InlineKeyboard();
    const cancelData =
        opts.namespace === "rsv"
            ? formatReserve({ kind: "cancel" })
            : formatBook({ kind: "cancel" });

    if (opts.includeBack) {
        const backData =
            opts.namespace === "rsv"
                ? formatReserve({ kind: "back" })
                : formatBook({ kind: "back" });
        kb.text("Назад", backData).text("Отмена", cancelData);
    } else {
        kb.text("Отмена", cancelData);
    }
    return kb;
}

// ---------------------------------------------------------------------------
// Reserve flow keyboards
// ---------------------------------------------------------------------------

/**
 * Category list — entry step of the reserve flow. One row per category.
 * Footer: `[Отмена]` only (no «Назад» since this is the entry step).
 */
export function buildCategoryList(categories: CategoryItem[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const cat of categories) {
        kb.text(cat.name, formatReserve({ kind: "category", categoryId: cat.id })).row();
    }
    return appendSharedFooter(kb, { namespace: "rsv", includeBack: false });
}

/**
 * Product list — second step of the reserve flow. One row per product.
 * Slices the input list to `[page * pageSize, (page + 1) * pageSize)` and
 * appends a pagination footer when `products.length > pageSize`. Only
 * pagination buttons that exist are rendered (no «Назад страница» on page 0,
 * no «Вперёд страница» on the last page). Final footer: `[Назад, Отмена]`
 * (back to category).
 */
export function buildProductList(
    products: ProductItem[],
    page: number,
    pageSize: number = DEFAULT_PRODUCT_PAGE_SIZE
): InlineKeyboard {
    const kb = new InlineKeyboard();
    const start = page * pageSize;
    const end = start + pageSize;
    const slice = products.slice(start, end);

    for (const product of slice) {
        kb.text(
            product.title,
            formatReserve({ kind: "product", productId: product.id, page })
        ).row();
    }

    if (products.length > pageSize) {
        const hasPrev = page > 0;
        const hasNext = end < products.length;
        if (hasPrev || hasNext) {
            // Pagination row.
            if (hasPrev) {
                kb.text("Назад страница", formatReserve({ kind: "productPage", page: page - 1 }));
            }
            if (hasNext) {
                kb.text("Вперёд страница", formatReserve({ kind: "productPage", page: page + 1 }));
            }
            kb.row();
        }
    }

    return appendSharedFooter(kb, { namespace: "rsv", includeBack: true });
}

/**
 * Variant list — third step of the reserve flow. One row per variant.
 * Footer: `[Назад, Отмена]` (back to product list).
 */
export function buildVariantList(variants: VariantItem[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const v of variants) {
        kb.text(v.label, formatReserve({ kind: "variant", variantId: v.id })).row();
    }
    return appendSharedFooter(kb, { namespace: "rsv", includeBack: true });
}

// ---------------------------------------------------------------------------
// Book flow keyboards
// ---------------------------------------------------------------------------

/**
 * Service list — entry step of the book flow. One row per service.
 * Footer: `[Отмена]` only (entry step, no «Назад»).
 */
export function buildServiceList(services: ServiceItem[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const svc of services) {
        kb.text(svc.title, formatBook({ kind: "service", serviceId: svc.id })).row();
    }
    return appendSharedFooter(kb, { namespace: "bk", includeBack: false });
}

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
});

/**
 * Render a date label like "пн, 16 мая" for the given ISO `YYYY-MM-DD`
 * string. We anchor the parsed Date at noon UTC so every timezone agrees on
 * the calendar date being labelled.
 */
function formatDateLabel(iso: string): string {
    // Anchor at 12:00 UTC to dodge timezone-edge midnight rollovers on the
    // server side. The label is purely cosmetic (the callback_data carries
    // the canonical ISO date), so locale-formatter output is safe.
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return DATE_LABEL_FORMATTER.format(d);
}

/**
 * Date picker — one row per `YYYY-MM-DD` string in `bookableDates`,
 * capped at 21 entries (design §8.1, Requirement 4.1). The caller is
 * expected to have already filtered out zero-slot dates.
 *
 * Footer: `[Назад, Отмена]` (back to service select).
 */
export function buildDatePicker(bookableDates: string[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    const slice = bookableDates.slice(0, MAX_DATE_BUTTONS);
    for (const iso of slice) {
        kb.text(formatDateLabel(iso), formatBook({ kind: "date", date: iso })).row();
    }
    return appendSharedFooter(kb, { namespace: "bk", includeBack: true });
}

/**
 * Time picker — `TIME_COLUMNS` × `pageSize / TIME_COLUMNS` grid of HH:mm
 * buttons. When the total slot count exceeds `pageSize`, a pagination
 * footer `[« Назад, Вперёд »]` is appended; only the buttons that exist
 * (no prev on first page, no next on last page) are rendered.
 *
 * Final footer: `[Назад, Отмена]` (back to date select).
 */
export function buildTimePicker(
    slots: string[],
    page: number,
    pageSize: number = DEFAULT_TIME_PAGE_SIZE
): InlineKeyboard {
    const kb = new InlineKeyboard();
    const start = page * pageSize;
    const end = start + pageSize;
    const slice = slots.slice(start, end);

    for (let i = 0; i < slice.length; i += 1) {
        kb.text(slice[i], formatBook({ kind: "time", time: slice[i] }));
        if ((i + 1) % TIME_COLUMNS === 0 && i !== slice.length - 1) {
            kb.row();
        }
    }
    if (slice.length > 0) kb.row();

    if (slots.length > pageSize) {
        const hasPrev = page > 0;
        const hasNext = end < slots.length;
        if (hasPrev || hasNext) {
            if (hasPrev) {
                kb.text("« Назад", formatBook({ kind: "timePage", page: page - 1 }));
            }
            if (hasNext) {
                kb.text("Вперёд »", formatBook({ kind: "timePage", page: page + 1 }));
            }
            kb.row();
        }
    }

    return appendSharedFooter(kb, { namespace: "bk", includeBack: true });
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/**
 * Confirmation keyboard for both flows: a single row
 * `[Подтвердить, Отмена]`. The namespace selects which callback grammar
 * (`rsv:` vs `bk:`) is used for both buttons.
 */
export function buildConfirmKeyboard(namespace: "rsv" | "bk"): InlineKeyboard {
    const kb = new InlineKeyboard();
    const confirmData =
        namespace === "rsv" ? formatReserve({ kind: "confirm" }) : formatBook({ kind: "confirm" });
    const cancelData =
        namespace === "rsv" ? formatReserve({ kind: "cancel" }) : formatBook({ kind: "cancel" });

    kb.text("Подтвердить", confirmData).text("Отмена", cancelData);
    return kb;
}

// ---------------------------------------------------------------------------
// Reply keyboard for contact collection
// ---------------------------------------------------------------------------

/**
 * Reply keyboard used during the book flow's `collect_contact` step.
 *
 * Behaviour (design §8.5):
 *   - When `missing` includes `"phone"`: the keyboard carries a single
 *     `request_contact: true` button labelled "Поделиться номером" plus a
 *     plain "Отмена" text button on the next row.
 *   - When `missing` is `["email"]` only: there is no useful reply keyboard
 *     — the caller is expected to send a plain text prompt with an inline
 *     cancel button instead. To keep the API total, this builder still
 *     returns a structurally well-formed object, but with `keyboard: []`,
 *     so callers can branch on `missing` themselves and skip attaching it.
 */
export function buildContactReplyKeyboard(missing: Array<"email" | "phone">): ContactReplyKeyboard {
    if (missing.includes("phone")) {
        return {
            keyboard: [
                [{ text: "Поделиться номером", request_contact: true }],
                [{ text: "Отмена" }],
            ],
            one_time_keyboard: true,
            resize_keyboard: true,
        };
    }
    return {
        keyboard: [],
        one_time_keyboard: true,
        resize_keyboard: true,
    };
}
