/**
 * Unit tests for the `/reserve` interactive flow.
 *
 * Mocks every collaborator at the module boundary (DB, FSM, quickReserve)
 * so the tests focus on the dispatcher logic, the FSM transitions, and the
 * acknowledge-before-side-effects ordering invariant.
 *
 * Properties covered:
 *   - Property 4: Acknowledge before side effects — `ctx.answerCallbackQuery`
 *                 fires before any DB write, FSM mutation, or message edit.
 *   - Property 5: Entry-point canonicalisation — `enter`,
 *                 `enterFromDeepLink`, and the `rsv:start` callback all
 *                 land on the documented initial BotState.
 *   - Property 8: ReserveFlow transition table — every (currentStep, action)
 *                 row from design §5.1 lands on the documented next step.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6,
 * 2.8, 13.1
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — collaborators imported by reserve.ts.
// ---------------------------------------------------------------------------
const { fsmState, dbState, fsmMocks, dbModule, quickReserveMock } = vi.hoisted(() => {
    interface FsmState {
        // Map<tgId, BotState | null>
        rows: Map<number, unknown>;
    }
    const fsmState: FsmState = { rows: new Map() };

    interface DbState {
        // Customer link by tgId.
        customerByTg: Map<number, string | null>;
        // Categories returned by the next loadTopCategories.
        categories: Array<{ id: string; name: string }>;
        // Products keyed by categoryId.
        productsByCategory: Map<string, Array<{ id: string; title: string }>>;
        // Variants keyed by productId.
        variantsByProduct: Map<string, Array<{ id: string; title: string; priceRub: number }>>;
        // Variant summary by variantId (for confirm body).
        variantSummary: Map<
            string,
            {
                variantId: string;
                variantTitle: string;
                productTitle: string;
                priceRub: number;
            }
        >;
    }
    const dbState: DbState = {
        customerByTg: new Map(),
        categories: [],
        productsByCategory: new Map(),
        variantsByProduct: new Map(),
        variantSummary: new Map(),
    };

    const fsmMocks = {
        loadBotState: vi.fn(async (tgId: number) => {
            return (fsmState.rows.get(tgId) ?? null) as unknown;
        }),
        saveBotState: vi.fn(async (tgId: number, state: unknown) => {
            fsmState.rows.set(tgId, state);
        }),
        clearBotState: vi.fn(async (tgId: number) => {
            fsmState.rows.set(tgId, null);
        }),
    };

    // Sentinel objects standing in for the schema exports — handlers don't
    // inspect them, only pass them through to the chain mock.
    const telegramBotUsers = {
        __table: "telegramBotUsers",
        customerId: { __col: "customerId" },
        telegramId: { __col: "telegramId" },
    } as const;
    const productCategories = {
        __table: "productCategories",
        id: { __col: "id" },
        name: { __col: "name" },
        sortOrder: { __col: "sortOrder" },
        parentId: { __col: "parentId" },
        isActive: { __col: "isActive" },
    } as const;
    const productsTable = {
        __table: "products",
        id: { __col: "id" },
        title: { __col: "title" },
        categoryId: { __col: "categoryId" },
        status: { __col: "status" },
    } as const;
    const productVariants = {
        __table: "productVariants",
        id: { __col: "id" },
        title: { __col: "title" },
        priceRub: { __col: "priceRub" },
        productId: { __col: "productId" },
    } as const;

    // The reserve.ts module issues four kinds of SELECT queries:
    //   1. Linked customer:  select(customerId).from(telegramBotUsers).where(eq(telegramId,tgId)).limit(1)
    //   2. Top categories:    select(...).from(productCategories).where(...).orderBy(...)
    //   3. Products in cat:   select(...).from(products).where(eq(categoryId,X)).orderBy(...).limit(...)
    //   4. Variants of prod:  select(...).from(productVariants).where(eq(productId,X)).orderBy(...)
    //   5. Variant summary:   select(...).from(productVariants).innerJoin(products,...).where(eq(id,X)).limit(1)
    //
    // We disambiguate (3) vs (5) using a flag toggled inside `innerJoin`.

    type ChainContext = {
        baseTable: string;
        joined: boolean;
        whereCol: string | null;
        whereValue: unknown;
        limit: number | null;
    };

    function resolveResult(ctx: ChainContext): unknown[] {
        const { baseTable, joined, whereCol, whereValue, limit } = ctx;
        if (baseTable === "telegramBotUsers" && whereCol === "telegramId") {
            const tgId = whereValue as number;
            const customerId = dbState.customerByTg.get(tgId) ?? null;
            return customerId === null ? [] : [{ customerId }];
        }
        if (baseTable === "productCategories") {
            return dbState.categories;
        }
        if (baseTable === "products" && !joined) {
            const categoryId = whereValue as string;
            return dbState.productsByCategory.get(categoryId) ?? [];
        }
        if (baseTable === "productVariants" && !joined) {
            const productId = whereValue as string;
            return dbState.variantsByProduct.get(productId) ?? [];
        }
        if (baseTable === "productVariants" && joined) {
            const variantId = whereValue as string;
            const summary = dbState.variantSummary.get(variantId);
            return summary ? [summary] : [];
        }
        // Default — no rows.
        void limit;
        return [];
    }

    function makeChain(baseTable: string) {
        const ctx: ChainContext = {
            baseTable,
            joined: false,
            whereCol: null,
            whereValue: undefined,
            limit: null,
        };
        const result = () => resolveResult(ctx);
        const obj = {
            innerJoin: () => {
                ctx.joined = true;
                return obj;
            },
            where: (cond: { col?: string; value?: unknown } | null) => {
                if (cond && typeof cond === "object") {
                    if ("col" in cond && cond.col) ctx.whereCol = cond.col ?? null;
                    if ("value" in cond) ctx.whereValue = cond.value;
                }
                return obj;
            },
            orderBy: () => obj,
            limit: (n: number) => {
                ctx.limit = n;
                return obj;
            },
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                return Promise.resolve(result()).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve(result()).catch(reject);
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (table: { __table?: string }) => makeChain(table?.__table ?? "unknown"),
            }),
        },
        telegramBotUsers,
        productCategories,
        products: productsTable,
        productVariants,
    };

    const quickReserveMock = vi.fn(async () => ({
        ok: true as const,
        referenceNumber: "RES-123",
        productTitle: "Lab grown сапфир",
    }));

    return { fsmState, dbState, fsmMocks, dbModule, quickReserveMock };
});

vi.mock("@/db", () => dbModule);
vi.mock("../fsm", () => fsmMocks);
vi.mock("../quick-reserve", () => ({ quickReserveForCustomer: quickReserveMock }));

// drizzle-orm helpers — only `eq` carries data we care about (the (col, val)
// pair). `and` returns the first non-null clause so multi-condition queries
// (e.g. `and(eq(categoryId,X), eq(status,'published'))`) still surface the
// id-bearing predicate to our chain mock.
vi.mock("drizzle-orm", () => ({
    eq: (col: { __col?: string }, value: unknown) => ({
        col: col?.__col ?? null,
        value,
    }),
    and: (...conds: unknown[]) => {
        for (const c of conds) {
            if (c && typeof c === "object" && "col" in c) return c;
        }
        return null;
    },
    isNull: (..._a: unknown[]) => null,
    asc: (..._a: unknown[]) => null,
    desc: (..._a: unknown[]) => null,
    notInArray: (..._a: unknown[]) => null,
    ne: (..._a: unknown[]) => null,
    gte: (..._a: unknown[]) => null,
    lte: (..._a: unknown[]) => null,
    or: (..._a: unknown[]) => null,
}));

// ---------------------------------------------------------------------------
// Module under test (after mocks).
// ---------------------------------------------------------------------------
import { enter, enterFromDeepLink, handleCallback } from "./reserve";

// ---------------------------------------------------------------------------
// Mock context factory
// ---------------------------------------------------------------------------
interface CallEntry {
    name: string;
    args?: unknown[];
}

interface MockCtx {
    from: { id: number };
    match?: string;
    callLog: CallEntry[];
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    editMessageReplyMarkup: ReturnType<typeof vi.fn>;
}

function makeCtx(tgId: number = 42): MockCtx {
    const callLog: CallEntry[] = [];
    const answerCallbackQuery = vi.fn(async (...args: unknown[]) => {
        callLog.push({ name: "answerCallbackQuery", args });
    });
    const reply = vi.fn(async (...args: unknown[]) => {
        callLog.push({ name: "reply", args });
    });
    const editMessageText = vi.fn(async (...args: unknown[]) => {
        callLog.push({ name: "editMessageText", args });
    });
    const editMessageReplyMarkup = vi.fn(async (...args: unknown[]) => {
        callLog.push({ name: "editMessageReplyMarkup", args });
    });
    return {
        from: { id: tgId },
        callLog,
        answerCallbackQuery,
        reply,
        editMessageText,
        editMessageReplyMarkup,
    };
}

const TG_ID = 42;
const CUSTOMER_ID = "customer-uuid";

beforeEach(() => {
    fsmState.rows.clear();
    fsmMocks.loadBotState.mockClear();
    fsmMocks.saveBotState.mockClear();
    fsmMocks.clearBotState.mockClear();
    dbState.customerByTg.clear();
    dbState.categories = [];
    dbState.productsByCategory.clear();
    dbState.variantsByProduct.clear();
    dbState.variantSummary.clear();
    quickReserveMock.mockClear();
    quickReserveMock.mockResolvedValue({
        ok: true,
        referenceNumber: "RES-123",
        productTitle: "Lab grown сапфир",
    });

    // Default fixtures — every linked customer + a single category/product/variant.
    dbState.customerByTg.set(TG_ID, CUSTOMER_ID);
    dbState.categories = [
        { id: "cat-1", name: "Серьги" },
        { id: "cat-2", name: "Кольца" },
    ];
    dbState.productsByCategory.set("cat-1", [
        { id: "prod-1", title: "Серьга-кольцо" },
        { id: "prod-2", title: "Серьга-гвоздик" },
    ]);
    dbState.variantsByProduct.set("prod-1", [
        { id: "var-1", title: "Маленькая", priceRub: 5_000_00 },
        { id: "var-2", title: "Большая", priceRub: 7_500_00 },
    ]);
    dbState.variantSummary.set("var-1", {
        variantId: "var-1",
        variantTitle: "Маленькая",
        productTitle: "Серьга-кольцо",
        priceRub: 5_000_00,
    });
});

afterEach(() => {
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Property 5 — Entry-point canonicalisation
// ---------------------------------------------------------------------------
describe("Property 5: Entry-point canonicalisation", () => {
    it("/reserve initialises FSM to { flow:'reserve', step:'browse_category', data:{} }", async () => {
        const ctx = makeCtx();
        await enter(ctx as unknown as Parameters<typeof enter>[0]);

        expect(fsmMocks.saveBotState).toHaveBeenCalledTimes(1);
        const [savedTgId, savedState] = fsmMocks.saveBotState.mock.calls[0]!;
        expect(savedTgId).toEqual(TG_ID);
        expect(savedState).toMatchObject({
            flow: "reserve",
            step: "browse_category",
            data: {},
        });
        // The reply renders the category picker.
        expect(ctx.reply).toHaveBeenCalledTimes(1);
        const replyCall = ctx.reply.mock.calls[0] as unknown as [string, unknown];
        expect(replyCall[0]).toEqual("Выберите категорию");
    });

    it("rsv:start callback initialises FSM to the same state but uses editMessageText", async () => {
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:start");

        expect(fsmMocks.saveBotState).toHaveBeenCalledTimes(1);
        const [, savedState] = fsmMocks.saveBotState.mock.calls[0]!;
        expect(savedState).toMatchObject({
            flow: "reserve",
            step: "browse_category",
            data: {},
        });
        expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
        // No fresh reply — we edit the existing greeting.
        expect(ctx.reply).toHaveBeenCalledTimes(0);
    });

    it("enterFromDeepLink jumps to confirm with { variantId }", async () => {
        const ctx = makeCtx();
        await enterFromDeepLink(ctx as unknown as Parameters<typeof enterFromDeepLink>[0], "var-1");

        expect(fsmMocks.saveBotState).toHaveBeenCalledTimes(1);
        const [, savedState] = fsmMocks.saveBotState.mock.calls[0]!;
        expect(savedState).toMatchObject({
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
        });

        expect(ctx.reply).toHaveBeenCalledTimes(1);
        const [body] = ctx.reply.mock.calls[0] as unknown as [string, unknown];
        expect(body).toContain("Подтверждение брони");
        expect(body).toContain("Серьга-кольцо");
        expect(body).toContain("Маленькая");
    });

    it("enter replies with link prompt when chat is not linked", async () => {
        dbState.customerByTg.set(TG_ID, null);
        const ctx = makeCtx();
        await enter(ctx as unknown as Parameters<typeof enter>[0]);

        expect(ctx.reply).toHaveBeenCalledWith("Привяжите чат к профилю на сайте.");
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });

    it("enterFromDeepLink replies with TXT_VARIANT_UNAVAILABLE when variant is missing", async () => {
        const ctx = makeCtx();
        await enterFromDeepLink(
            ctx as unknown as Parameters<typeof enterFromDeepLink>[0],
            "missing-variant"
        );

        expect(ctx.reply).toHaveBeenCalledWith("Это украшение недоступно.");
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Property 4 — Acknowledge before side effects
// ---------------------------------------------------------------------------
describe("Property 4: Acknowledge before side effects", () => {
    function indexOf(ctx: MockCtx, name: string): number {
        return ctx.callLog.findIndex((e) => e.name === name);
    }

    it("category tap acks before any FSM save / message edit", async () => {
        // Seed FSM — we're at browse_category.
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:cat:cat-1"
        );

        const ackIdx = indexOf(ctx, "answerCallbackQuery");
        expect(ackIdx).toBeGreaterThanOrEqual(0);
        for (const name of ["editMessageText", "editMessageReplyMarkup", "reply"]) {
            const idx = indexOf(ctx, name);
            if (idx >= 0) expect(ackIdx).toBeLessThan(idx);
        }
        // Save fired AFTER ack — assertion on call order via mock.invocationCallOrder.
        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const saveOrder = fsmMocks.saveBotState.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(saveOrder);
    });

    it("product tap acks before save / edit", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:prod:prod-1:p:0"
        );

        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const saveOrder = fsmMocks.saveBotState.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(saveOrder);
    });

    it("variant tap acks before save / edit", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:var:var-1"
        );

        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const saveOrder = fsmMocks.saveBotState.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(saveOrder);
    });

    it("confirm tap acks before quickReserve / clear", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cnf");

        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const reserveOrder = quickReserveMock.mock.invocationCallOrder[0];
        const clearOrder = fsmMocks.clearBotState.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(reserveOrder);
        expect(ackOrder).toBeLessThan(clearOrder);
    });

    it("cancel tap acks before clear / edit", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cancel");

        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const clearOrder = fsmMocks.clearBotState.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(clearOrder);
    });
});

// ---------------------------------------------------------------------------
// Property 8 — ReserveFlow transition table (design §5.1)
// ---------------------------------------------------------------------------
describe("Property 8: ReserveFlow transition table", () => {
    it("browse_category + rsv:cat:<id> → browse_product", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:cat:cat-1"
        );
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
        });
    });

    it("browse_product + rsv:prodpage:<n> → browse_product (page advances)", async () => {
        // Seed enough products to support page 1.
        dbState.productsByCategory.set(
            "cat-1",
            Array.from({ length: 25 }, (_, i) => ({
                id: `p${i}`,
                title: `Product ${i}`,
            }))
        );
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:prodpage:1"
        );
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 1 },
        });
    });

    it("browse_product + rsv:prod:<id>:p:<n> → browse_variant", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:prod:prod-1:p:0"
        );
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1" },
        });
    });

    it("browse_variant + rsv:var:<id> → confirm", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:var:var-1"
        );
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
        });
    });

    it("confirm + rsv:cnf → terminal (state cleared, quickReserve invoked)", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cnf");

        expect(quickReserveMock).toHaveBeenCalledTimes(1);
        expect(quickReserveMock).toHaveBeenCalledWith(CUSTOMER_ID, "var-1");
        expect(fsmMocks.clearBotState).toHaveBeenCalledWith(TG_ID);
    });

    it("any step + rsv:cancel → terminal (state cleared, no save)", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cancel");

        expect(fsmMocks.clearBotState).toHaveBeenCalledWith(TG_ID);
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });

    it("browse_product + rsv:back → browse_category", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:back");
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "browse_category",
            data: {},
        });
    });

    it("browse_variant + rsv:back → browse_product", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:back");
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
        });
    });

    it("confirm + rsv:back → browse_variant when category+product are present", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "confirm",
            data: { categoryId: "cat-1", productId: "prod-1", variantId: "var-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:back");
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1", page: 0 },
        });
    });

    it("confirm + rsv:back is refused when state lacks productId (deep-link path)", async () => {
        // Deep-link confirm has only `variantId` — no back navigation.
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:back");

        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
        // The handler ack'd with a "back not available" toast.
        expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it("unknown payload stays in current state (no save)", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:gibberish"
        );

        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
        expect(fsmMocks.clearBotState).not.toHaveBeenCalled();
        expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Per-action smoke tests
// ---------------------------------------------------------------------------
describe("handleCallback — per-action smoke", () => {
    it("category tap renders the product picker text", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:cat:cat-1"
        );
        const [body] = ctx.editMessageText.mock.calls[0] as unknown as [string, unknown];
        expect(body).toEqual("Выберите украшение");
    });

    it("variant tap renders the confirm body with HTML parse_mode", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_variant",
            data: { categoryId: "cat-1", productId: "prod-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:var:var-1"
        );
        const [body, opts] = ctx.editMessageText.mock.calls[0] as unknown as [
            string,
            { parse_mode?: string },
        ];
        expect(body).toContain("Подтверждение брони");
        expect(opts?.parse_mode).toEqual("HTML");
    });

    it("productPage tap uses editMessageReplyMarkup (in-place pagination)", async () => {
        dbState.productsByCategory.set(
            "cat-1",
            Array.from({ length: 25 }, (_, i) => ({
                id: `p${i}`,
                title: `Product ${i}`,
            }))
        );
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "rsv:prodpage:1"
        );
        expect(ctx.editMessageReplyMarkup).toHaveBeenCalledTimes(1);
        expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it("cancel renders the cancellation message", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cancel");
        // The cancel handler tries to edit the message; on success no reply.
        expect(ctx.editMessageText).toHaveBeenCalledWith("Действие отменено.");
    });

    it("confirm with linked customer + valid variant invokes quickReserveForCustomer with (customerId, variantId)", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cnf");
        expect(quickReserveMock).toHaveBeenCalledWith(CUSTOMER_ID, "var-1");
    });

    it("confirm with no linked customer alerts and clears state", async () => {
        dbState.customerByTg.set(TG_ID, null);
        fsmState.rows.set(TG_ID, {
            flow: "reserve",
            step: "confirm",
            data: { variantId: "var-1" },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "rsv:cnf");
        expect(quickReserveMock).not.toHaveBeenCalled();
        expect(fsmMocks.clearBotState).toHaveBeenCalledWith(TG_ID);
    });
});
