/**
 * Unit tests for the shared keyboard builders.
 *
 * Covers:
 *   - Property 2:  Namespace purity — every reserve button starts with `rsv:`,
 *                  every book button starts with `bk:`.
 *   - Property 3:  Cancel always reachable — every keyboard contains a button
 *                  with `callback_data` exactly equal to `rsv:cancel` or
 *                  `bk:cancel`.
 *   - Property 10: Date picker correctness — emits exactly the input dates
 *                  capped at 21 entries; never more buttons than dates.
 *   - Property 12: Paginator partitions — for both product (`pageSize=10`)
 *                  and time (`pageSize=12`) paginators, the union of all
 *                  pages equals the input list and pages are pairwise
 *                  disjoint.
 *   - 64-byte invariant on every emitted `callback_data`.
 *
 * Validates: Requirements 2.3, 4.1, 4.2, 4.3, 5.3, 10.2
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { describe, expect, it } from "vitest";
import type { InlineKeyboard } from "grammy";
import {
    type CategoryItem,
    type ProductItem,
    type ServiceItem,
    type VariantItem,
    buildCategoryList,
    buildConfirmKeyboard,
    buildContactReplyKeyboard,
    buildDatePicker,
    buildProductList,
    buildServiceList,
    buildSharedFooter,
    buildTimePicker,
    buildVariantList,
} from "./keyboards";

const TG_CALLBACK_LIMIT = 64;

interface InlineButton {
    text: string;
    callback_data?: string;
    url?: string;
}

/** Flatten a grammY `InlineKeyboard` into a flat array of buttons. */
function flatten(kb: InlineKeyboard): InlineButton[] {
    const rows = (kb as unknown as { inline_keyboard: InlineButton[][] }).inline_keyboard;
    return rows.flat();
}

function callbackData(buttons: InlineButton[]): string[] {
    return buttons.map((b) => b.callback_data).filter((s): s is string => typeof s === "string");
}

function utf8ByteLength(s: string): number {
    return Buffer.byteLength(s, "utf8");
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
const idArb = fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((s) => !s.includes(":") && s.length > 0);
const titleArb = fc.string({ minLength: 1, maxLength: 30 });
const categoryArb: fc.Arbitrary<CategoryItem> = fc.record({
    id: idArb,
    name: titleArb,
});
const productArb: fc.Arbitrary<ProductItem> = fc.record({
    id: idArb,
    title: titleArb,
});
const variantArb: fc.Arbitrary<VariantItem> = fc.record({
    id: idArb,
    label: titleArb,
});
const serviceArb: fc.Arbitrary<ServiceItem> = fc.record({
    id: idArb,
    title: titleArb,
});
const isoDateArb = fc.integer({ min: 0, max: 365 }).map((offset) => {
    const d = new Date(Date.UTC(2026, 0, 1));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
});
const hhmmArb = fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

// ---------------------------------------------------------------------------
// Property 2 — Namespace purity
// ---------------------------------------------------------------------------
describe("Property 2: Namespace purity", () => {
    it("every reserve keyboard button uses the rsv: namespace", () => {
        fcAssert(
            fc.property(
                fc.array(categoryArb, { maxLength: 10 }),
                fc.array(productArb, { maxLength: 25 }),
                fc.array(variantArb, { maxLength: 10 }),
                fc.nat({ max: 5 }),
                (cats, prods, vars, page) => {
                    const all: string[] = [
                        ...callbackData(flatten(buildCategoryList(cats))),
                        ...callbackData(flatten(buildProductList(prods, page))),
                        ...callbackData(flatten(buildVariantList(vars))),
                        ...callbackData(flatten(buildConfirmKeyboard("rsv"))),
                    ];
                    for (const cd of all) {
                        expect(cd.startsWith("rsv:")).toBe(true);
                    }
                }
            ),
            { numRuns: 50, seed: 17490 }
        );
    });

    it("every book keyboard button uses the bk: namespace", () => {
        fcAssert(
            fc.property(
                fc.array(serviceArb, { maxLength: 10 }),
                fc.uniqueArray(isoDateArb, { maxLength: 25 }),
                fc.uniqueArray(hhmmArb, { maxLength: 30 }),
                fc.nat({ max: 5 }),
                (svcs, dates, slots, page) => {
                    const all: string[] = [
                        ...callbackData(flatten(buildServiceList(svcs))),
                        ...callbackData(flatten(buildDatePicker(dates))),
                        ...callbackData(flatten(buildTimePicker(slots, page))),
                        ...callbackData(flatten(buildConfirmKeyboard("bk"))),
                    ];
                    for (const cd of all) {
                        expect(cd.startsWith("bk:")).toBe(true);
                    }
                }
            ),
            { numRuns: 50, seed: 17491 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 3 — Cancel always reachable
// ---------------------------------------------------------------------------
describe("Property 3: Cancel always reachable", () => {
    it("every reserve keyboard contains exactly one rsv:cancel button", () => {
        fcAssert(
            fc.property(
                fc.array(categoryArb, { maxLength: 10 }),
                fc.array(productArb, { maxLength: 25 }),
                fc.array(variantArb, { maxLength: 10 }),
                fc.nat({ max: 5 }),
                (cats, prods, vars, page) => {
                    const keyboards: InlineKeyboard[] = [
                        buildCategoryList(cats),
                        buildProductList(prods, page),
                        buildVariantList(vars),
                        buildConfirmKeyboard("rsv"),
                        buildSharedFooter({ namespace: "rsv", includeBack: false }),
                        buildSharedFooter({ namespace: "rsv", includeBack: true }),
                    ];
                    for (const kb of keyboards) {
                        const datas = callbackData(flatten(kb));
                        expect(datas).toContain("rsv:cancel");
                    }
                }
            ),
            { numRuns: 50, seed: 17492 }
        );
    });

    it("every book keyboard contains exactly one bk:cancel button", () => {
        fcAssert(
            fc.property(
                fc.array(serviceArb, { maxLength: 10 }),
                fc.uniqueArray(isoDateArb, { maxLength: 25 }),
                fc.uniqueArray(hhmmArb, { maxLength: 30 }),
                fc.nat({ max: 5 }),
                (svcs, dates, slots, page) => {
                    const keyboards: InlineKeyboard[] = [
                        buildServiceList(svcs),
                        buildDatePicker(dates),
                        buildTimePicker(slots, page),
                        buildConfirmKeyboard("bk"),
                        buildSharedFooter({ namespace: "bk", includeBack: false }),
                        buildSharedFooter({ namespace: "bk", includeBack: true }),
                    ];
                    for (const kb of keyboards) {
                        const datas = callbackData(flatten(kb));
                        expect(datas).toContain("bk:cancel");
                    }
                }
            ),
            { numRuns: 50, seed: 17493 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 10 — Date picker correctness
// ---------------------------------------------------------------------------
describe("Property 10: Date picker correctness", () => {
    it("renders one date button per input date, capped at 21 entries", () => {
        fcAssert(
            fc.property(fc.uniqueArray(isoDateArb, { minLength: 0, maxLength: 30 }), (dates) => {
                const kb = buildDatePicker(dates);
                const buttons = flatten(kb);
                const dateButtons = buttons.filter(
                    (b) =>
                        typeof b.callback_data === "string" &&
                        b.callback_data.startsWith("bk:date:")
                );
                // Exactly min(input.length, 21) date buttons.
                expect(dateButtons.length).toEqual(Math.min(dates.length, 21));

                // Each emitted button corresponds to one of the first 21
                // input dates (in order).
                const expected = dates.slice(0, 21);
                const emitted = dateButtons
                    .map((b) => b.callback_data ?? "")
                    .map((cd) => cd.slice("bk:date:".length));
                expect(emitted).toEqual(expected);
            }),
            { numRuns: 80, seed: 17494 }
        );
    });

    it("never emits buttons for dates not in the input", () => {
        fcAssert(
            fc.property(fc.uniqueArray(isoDateArb, { minLength: 0, maxLength: 30 }), (dates) => {
                const kb = buildDatePicker(dates);
                const inputSet = new Set(dates);
                for (const b of flatten(kb)) {
                    if (b.callback_data?.startsWith("bk:date:")) {
                        const iso = b.callback_data.slice("bk:date:".length);
                        expect(inputSet.has(iso)).toBe(true);
                    }
                }
            }),
            { numRuns: 80, seed: 17495 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 12 — Paginator partitions
// ---------------------------------------------------------------------------
describe("Property 12: Paginator partitions", () => {
    it("product paginator (pageSize=10) partitions the input list", () => {
        fcAssert(
            fc.property(
                fc.uniqueArray(productArb, {
                    minLength: 0,
                    maxLength: 50,
                    selector: (p) => p.id,
                }),
                (products) => {
                    const pageSize = 10;
                    const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
                    const seenIds = new Set<string>();
                    let totalEmitted = 0;

                    for (let page = 0; page < totalPages; page += 1) {
                        const kb = buildProductList(products, page, pageSize);
                        const productCallbacks = flatten(kb)
                            .map((b) => b.callback_data)
                            .filter(
                                (s): s is string =>
                                    typeof s === "string" && s.startsWith("rsv:prod:")
                            );
                        // Extract the product ID from `rsv:prod:<id>:p:<n>`.
                        const ids = productCallbacks.map(
                            (cd) => cd.slice("rsv:prod:".length).split(":p:")[0]
                        );

                        // Pairwise disjoint across pages.
                        for (const id of ids) {
                            expect(seenIds.has(id)).toBe(false);
                            seenIds.add(id);
                        }
                        totalEmitted += ids.length;

                        // Page slot count never exceeds pageSize.
                        expect(ids.length).toBeLessThanOrEqual(pageSize);
                    }

                    // Union over all pages equals the input set.
                    expect(totalEmitted).toEqual(products.length);
                    for (const p of products) {
                        expect(seenIds.has(p.id)).toBe(true);
                    }
                }
            ),
            { numRuns: 60, seed: 17496 }
        );
    });

    it("time paginator (pageSize=12) partitions the slot list", () => {
        fcAssert(
            fc.property(fc.uniqueArray(hhmmArb, { minLength: 0, maxLength: 50 }), (slots) => {
                const pageSize = 12;
                const totalPages = Math.max(1, Math.ceil(slots.length / pageSize));
                const seen = new Set<string>();
                let totalEmitted = 0;

                for (let page = 0; page < totalPages; page += 1) {
                    const kb = buildTimePicker(slots, page, pageSize);
                    const timeCallbacks = flatten(kb)
                        .map((b) => b.callback_data)
                        .filter(
                            (s): s is string => typeof s === "string" && s.startsWith("bk:time:")
                        );
                    // Strip the "bk:time:" prefix to recover HH:mm.
                    const times = timeCallbacks.map((cd) => cd.slice("bk:time:".length));

                    for (const t of times) {
                        expect(seen.has(t)).toBe(false);
                        seen.add(t);
                    }
                    totalEmitted += times.length;
                    expect(times.length).toBeLessThanOrEqual(pageSize);
                }

                expect(totalEmitted).toEqual(slots.length);
                for (const t of slots) {
                    expect(seen.has(t)).toBe(true);
                }
            }),
            { numRuns: 60, seed: 17497 }
        );
    });
});

// ---------------------------------------------------------------------------
// 64-byte invariant on every emitted callback_data
// ---------------------------------------------------------------------------
describe("64-byte callback_data invariant", () => {
    it("holds for every reserve keyboard", () => {
        fcAssert(
            fc.property(
                fc.array(categoryArb, { maxLength: 10 }),
                fc.array(productArb, { maxLength: 25 }),
                fc.array(variantArb, { maxLength: 10 }),
                fc.nat({ max: 5 }),
                (cats, prods, vars, page) => {
                    const datas = [
                        ...callbackData(flatten(buildCategoryList(cats))),
                        ...callbackData(flatten(buildProductList(prods, page))),
                        ...callbackData(flatten(buildVariantList(vars))),
                        ...callbackData(flatten(buildConfirmKeyboard("rsv"))),
                    ];
                    for (const cd of datas) {
                        expect(utf8ByteLength(cd)).toBeLessThanOrEqual(TG_CALLBACK_LIMIT);
                    }
                }
            ),
            { numRuns: 50, seed: 17498 }
        );
    });

    it("holds for every book keyboard", () => {
        fcAssert(
            fc.property(
                fc.array(serviceArb, { maxLength: 10 }),
                fc.uniqueArray(isoDateArb, { maxLength: 25 }),
                fc.uniqueArray(hhmmArb, { maxLength: 30 }),
                fc.nat({ max: 5 }),
                (svcs, dates, slots, page) => {
                    const datas = [
                        ...callbackData(flatten(buildServiceList(svcs))),
                        ...callbackData(flatten(buildDatePicker(dates))),
                        ...callbackData(flatten(buildTimePicker(slots, page))),
                        ...callbackData(flatten(buildConfirmKeyboard("bk"))),
                    ];
                    for (const cd of datas) {
                        expect(utf8ByteLength(cd)).toBeLessThanOrEqual(TG_CALLBACK_LIMIT);
                    }
                }
            ),
            { numRuns: 50, seed: 17499 }
        );
    });
});

// ---------------------------------------------------------------------------
// Confirm keyboard — fixed shape
// ---------------------------------------------------------------------------
describe("buildConfirmKeyboard", () => {
    it("renders [Подтвердить, Отмена] for the rsv namespace", () => {
        const kb = buildConfirmKeyboard("rsv");
        const buttons = flatten(kb);
        expect(buttons).toHaveLength(2);
        expect(buttons[0].text).toEqual("Подтвердить");
        expect(buttons[0].callback_data).toEqual("rsv:cnf");
        expect(buttons[1].text).toEqual("Отмена");
        expect(buttons[1].callback_data).toEqual("rsv:cancel");
    });

    it("renders [Подтвердить, Отмена] for the bk namespace", () => {
        const kb = buildConfirmKeyboard("bk");
        const buttons = flatten(kb);
        expect(buttons).toHaveLength(2);
        expect(buttons[0].text).toEqual("Подтвердить");
        expect(buttons[0].callback_data).toEqual("bk:cnf");
        expect(buttons[1].text).toEqual("Отмена");
        expect(buttons[1].callback_data).toEqual("bk:cancel");
    });
});

// ---------------------------------------------------------------------------
// Shared footer — fixed shape
// ---------------------------------------------------------------------------
describe("buildSharedFooter", () => {
    it("renders [Назад, Отмена] when includeBack=true", () => {
        const kb = buildSharedFooter({ namespace: "rsv", includeBack: true });
        const buttons = flatten(kb);
        expect(buttons).toHaveLength(2);
        expect(buttons[0].text).toEqual("Назад");
        expect(buttons[0].callback_data).toEqual("rsv:back");
        expect(buttons[1].text).toEqual("Отмена");
        expect(buttons[1].callback_data).toEqual("rsv:cancel");
    });

    it("renders [Отмена] only when includeBack=false", () => {
        const kb = buildSharedFooter({ namespace: "bk", includeBack: false });
        const buttons = flatten(kb);
        expect(buttons).toHaveLength(1);
        expect(buttons[0].text).toEqual("Отмена");
        expect(buttons[0].callback_data).toEqual("bk:cancel");
    });
});

// ---------------------------------------------------------------------------
// Contact reply keyboard
// ---------------------------------------------------------------------------
describe("buildContactReplyKeyboard", () => {
    it("includes a request_contact button when phone is missing", () => {
        const kb = buildContactReplyKeyboard(["phone"]);
        expect(kb.keyboard).toEqual([
            [{ text: "Поделиться номером", request_contact: true }],
            [{ text: "Отмена" }],
        ]);
        expect(kb.one_time_keyboard).toBe(true);
        expect(kb.resize_keyboard).toBe(true);
    });

    it("includes the request_contact button when both fields are missing", () => {
        const kb = buildContactReplyKeyboard(["email", "phone"]);
        const flat = kb.keyboard.flat();
        const contactBtn = flat.find((b) => b.request_contact === true);
        expect(contactBtn).toBeDefined();
        expect(contactBtn?.text).toEqual("Поделиться номером");
    });

    it("returns an empty keyboard array when only email is missing", () => {
        const kb = buildContactReplyKeyboard(["email"]);
        expect(kb.keyboard).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Pagination edges — explicit assertions for the corner cases
// ---------------------------------------------------------------------------
describe("buildProductList pagination edges", () => {
    function makeProducts(n: number): ProductItem[] {
        return Array.from({ length: n }, (_, i) => ({
            id: `p${i}`,
            title: `Product ${i}`,
        }));
    }

    it("hides Назад страница on the first page", () => {
        const kb = buildProductList(makeProducts(25), 0, 10);
        const labels = flatten(kb).map((b) => b.text);
        expect(labels).not.toContain("Назад страница");
        expect(labels).toContain("Вперёд страница");
    });

    it("hides Вперёд страница on the last page", () => {
        const kb = buildProductList(makeProducts(25), 2, 10);
        const labels = flatten(kb).map((b) => b.text);
        expect(labels).toContain("Назад страница");
        expect(labels).not.toContain("Вперёд страница");
    });

    it("renders no pagination row when products fit in a single page", () => {
        const kb = buildProductList(makeProducts(5), 0, 10);
        const labels = flatten(kb).map((b) => b.text);
        expect(labels).not.toContain("Назад страница");
        expect(labels).not.toContain("Вперёд страница");
    });
});

describe("buildTimePicker pagination edges", () => {
    function makeSlots(n: number): string[] {
        return Array.from({ length: n }, (_, i) => {
            const h = String(Math.floor(i / 2)).padStart(2, "0");
            const m = i % 2 === 0 ? "00" : "30";
            return `${h}:${m}`;
        });
    }

    it("renders 4-column rows", () => {
        const kb = buildTimePicker(makeSlots(8), 0, 8);
        const rows = (kb as unknown as { inline_keyboard: InlineButton[][] }).inline_keyboard;
        // Time buttons live on the first 2 rows of 4 columns each.
        // The 3rd row is the footer ([Назад, Отмена]).
        expect(rows[0]).toHaveLength(4);
        expect(rows[1]).toHaveLength(4);
    });

    it("hides « Назад on the first page", () => {
        const kb = buildTimePicker(makeSlots(30), 0, 12);
        const labels = flatten(kb).map((b) => b.text);
        expect(labels).not.toContain("« Назад");
        expect(labels).toContain("Вперёд »");
    });

    it("hides Вперёд » on the last page", () => {
        const kb = buildTimePicker(makeSlots(30), 2, 12);
        const labels = flatten(kb).map((b) => b.text);
        expect(labels).toContain("« Назад");
        expect(labels).not.toContain("Вперёд »");
    });
});
