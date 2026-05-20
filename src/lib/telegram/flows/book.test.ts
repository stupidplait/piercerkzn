/**
 * Unit tests for the `/book` interactive flow.
 *
 * Mocks every collaborator at the module boundary (DB, FSM, settings,
 * availability, createAppointment) so the tests focus on the dispatcher,
 * the contact-step branching matrix, the waiver payload shape, and the
 * slot-conflict recovery path.
 *
 * Properties covered:
 *   - Property 9:  BookFlow transition table including contact branching
 *   - Property 13: Contact persistence regardless of channel
 *                  (contact event vs typed text, phone & email)
 *   - Property 14: Waiver payload shape — `tg-consent:<tgId>:<ISO>`
 *   - Property 15: Slot-conflict recovery — `slot_unavailable` rewinds
 *                  the FSM to `select_time` and re-renders the picker
 *                  rather than clearing state.
 *
 * Validates: Requirements 3.4, 4.4, 5.4, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2,
 * 7.3, 13.2, 13.3
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — the module under test imports many collaborators.
// ---------------------------------------------------------------------------
const {
    fsmState,
    dbState,
    fsmMocks,
    dbModule,
    createAppointmentMock,
    AppointmentError,
    getBookingSettingsMock,
    availabilityMocks,
} = vi.hoisted(() => {
    interface FsmState {
        rows: Map<number, unknown>;
    }
    const fsmState: FsmState = { rows: new Map() };

    interface DbState {
        customerByTg: Map<number, string | null>;
        customers: Map<
            string,
            {
                id: string;
                firstName: string;
                lastName: string | null;
                email: string | null;
                phone: string | null;
                dateOfBirth: string | null;
            }
        >;
        services: Map<
            string,
            {
                id: string;
                title: string;
                durationMinutes: number;
                isActive: boolean | null;
            }
        >;
        // Weekly piercer schedule rows. Default seed is "all 7 days open
        // 10:00 — 19:00, no breaks" so the bookable-dates computation
        // returns a non-empty list.
        weeklySchedule: Array<{
            dayOfWeek: number;
            isWorking: boolean;
            startTime: string;
            endTime: string;
            breaks: unknown;
        }>;
        // Captures of update() calls.
        customerUpdates: Array<{
            customerId: string;
            patch: { phone?: string; email?: string };
        }>;
    }
    const dbState: DbState = {
        customerByTg: new Map(),
        customers: new Map(),
        services: new Map(),
        weeklySchedule: [],
        customerUpdates: [],
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

    // Schema sentinels.
    const telegramBotUsers = {
        __table: "telegramBotUsers",
        customerId: { __col: "customerId" },
        telegramId: { __col: "telegramId" },
    } as const;
    const customers = {
        __table: "customers",
        id: { __col: "id" },
        firstName: { __col: "firstName" },
        lastName: { __col: "lastName" },
        email: { __col: "email" },
        phone: { __col: "phone" },
        dateOfBirth: { __col: "dateOfBirth" },
    } as const;
    const services = {
        __table: "services",
        id: { __col: "id" },
        name: { __col: "name" },
        durationMinutes: { __col: "durationMinutes" },
        isActive: { __col: "isActive" },
        sortOrder: { __col: "sortOrder" },
    } as const;
    const appointments = { __table: "appointments" } as const;
    const piercerSchedule = { __table: "piercerSchedule" } as const;
    const scheduleExceptions = { __table: "scheduleExceptions" } as const;
    const timeBlocks = { __table: "timeBlocks" } as const;

    type ChainContext = {
        baseTable: string;
        whereCol: string | null;
        whereValue: unknown;
    };

    function resolveResult(ctx: ChainContext): unknown[] {
        const { baseTable, whereCol, whereValue } = ctx;
        if (baseTable === "telegramBotUsers" && whereCol === "telegramId") {
            const tgId = whereValue as number;
            const customerId = dbState.customerByTg.get(tgId) ?? null;
            return customerId === null ? [] : [{ customerId }];
        }
        if (baseTable === "customers" && whereCol === "id") {
            const id = whereValue as string;
            const c = dbState.customers.get(id);
            return c ? [c] : [];
        }
        if (baseTable === "services" && whereCol === "id") {
            const id = whereValue as string;
            const s = dbState.services.get(id);
            return s ? [s] : [];
        }
        if (baseTable === "services") {
            // Bare list — return all active services.
            return Array.from(dbState.services.values()).filter((s) => s.isActive !== false);
        }
        // Schedule tables — empty rows are fine; the availability layer is
        // mocked separately so book.ts never actually consumes them.
        if (
            baseTable === "appointments" ||
            baseTable === "scheduleExceptions" ||
            baseTable === "timeBlocks"
        ) {
            return [];
        }
        if (baseTable === "piercerSchedule") {
            return dbState.weeklySchedule;
        }
        return [];
    }

    function makeChain(baseTable: string) {
        const ctx: ChainContext = {
            baseTable,
            whereCol: null,
            whereValue: undefined,
        };
        const result = () => resolveResult(ctx);
        const obj = {
            innerJoin: () => obj,
            where: (cond: { col?: string; value?: unknown } | null) => {
                if (cond && typeof cond === "object") {
                    if ("col" in cond && cond.col) ctx.whereCol = cond.col ?? null;
                    if ("value" in cond) ctx.whereValue = cond.value;
                }
                return obj;
            },
            orderBy: () => obj,
            limit: () => obj,
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                return Promise.resolve(result()).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve(result()).catch(reject);
            },
        };
        return obj;
    }

    function makeUpdateChain(table: { __table?: string }) {
        let pendingPatch: Record<string, unknown> = {};
        const obj = {
            set(values: Record<string, unknown>) {
                pendingPatch = values;
                return obj;
            },
            where(cond: { col?: string; value?: unknown } | null) {
                if (
                    table?.__table === "customers" &&
                    cond?.col === "id" &&
                    typeof cond.value === "string"
                ) {
                    const customerId = cond.value;
                    const patch: { phone?: string; email?: string } = {};
                    if (typeof pendingPatch.phone === "string") {
                        patch.phone = pendingPatch.phone;
                    }
                    if (typeof pendingPatch.email === "string") {
                        patch.email = pendingPatch.email;
                    }
                    dbState.customerUpdates.push({ customerId, patch });
                    const existing = dbState.customers.get(customerId);
                    if (existing) {
                        if (patch.phone) existing.phone = patch.phone;
                        if (patch.email) existing.email = patch.email;
                    }
                }
                return Promise.resolve(undefined);
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (table: { __table?: string }) => makeChain(table?.__table ?? "unknown"),
            }),
            update: (table: { __table?: string }) => makeUpdateChain(table),
        },
        telegramBotUsers,
        customers,
        services,
        appointments,
        piercerSchedule,
        scheduleExceptions,
        timeBlocks,
    };

    // AppointmentError stub — must extend Error so `instanceof` checks pass.
    class AppointmentError extends Error {
        readonly code: string;
        constructor(code: string, message?: string) {
            super(message ?? code);
            this.code = code;
            this.name = "AppointmentError";
        }
    }

    const createAppointmentMock = vi.fn(async () => ({
        appointment: {
            id: "appt-uuid",
            referenceNumber: "APT-001",
        },
        customer: null,
        customerCreated: false,
        temporaryPassword: null,
        serviceTitles: ["Прокол уха"],
    }));

    const getBookingSettingsMock = vi.fn(async () => ({
        slotDurationMinutes: 30,
        bufferMinutes: 15,
        advanceDays: 14,
        minNoticeHours: 2,
    }));

    // We mock `lib/booking/availability` so book.ts gets predictable slot
    // lists without needing to hit the schedule tables.
    const availabilityMocks = {
        computeSlotsForDay: vi.fn(() => ({
            date: "2026-05-20",
            isWorkingDay: true,
            slots: ["10:00", "10:30", "11:00", "11:30"],
        })),
        dayOfWeekForDate: vi.fn(() => 1),
        parseHmsToMinutes: vi.fn((hms: string | null | undefined) => {
            if (!hms) return null;
            const m = /^(\d{2}):(\d{2})/u.exec(hms);
            return m ? Number(m[1]) * 60 + Number(m[2]) : null;
        }),
    };

    return {
        fsmState,
        dbState,
        fsmMocks,
        dbModule,
        createAppointmentMock,
        AppointmentError,
        getBookingSettingsMock,
        availabilityMocks,
    };
});

vi.mock("@/db", () => dbModule);
vi.mock("../fsm", () => fsmMocks);

vi.mock("@/lib/booking/appointments", () => ({
    AppointmentError,
    createAppointment: createAppointmentMock,
}));

vi.mock("@/lib/booking/availability", () => ({
    ...availabilityMocks,
}));

vi.mock("@/lib/settings", () => ({
    getBookingSettings: getBookingSettingsMock,
}));

vi.mock("@/lib/aftercare/time", () => ({
    addDaysIso: (iso: string, days: number) => {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return null;
        const base = new Date(`${iso}T00:00:00Z`);
        if (Number.isNaN(base.getTime())) return null;
        base.setUTCDate(base.getUTCDate() + days);
        return base.toISOString().slice(0, 10);
    },
}));

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
    asc: (..._a: unknown[]) => null,
    desc: (..._a: unknown[]) => null,
    isNull: (..._a: unknown[]) => null,
    notInArray: (..._a: unknown[]) => null,
    ne: (..._a: unknown[]) => null,
    gte: (..._a: unknown[]) => null,
    lte: (..._a: unknown[]) => null,
    or: (..._a: unknown[]) => null,
}));

// ---------------------------------------------------------------------------
// Module under test (after mocks).
// ---------------------------------------------------------------------------
import { enter, handleCallback, handleContactMessage, handleTextMessage } from "./book";

// ---------------------------------------------------------------------------
// Mock context factory
// ---------------------------------------------------------------------------
interface MockCtx {
    from: { id: number };
    message?: {
        text?: string;
        contact?: { phone_number?: string };
    };
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    editMessageReplyMarkup: ReturnType<typeof vi.fn>;
}

function makeCtx(
    opts: {
        tgId?: number;
        text?: string;
        contactPhone?: string;
    } = {}
): MockCtx {
    const tgId = opts.tgId ?? 42;
    const message: MockCtx["message"] = {};
    if (opts.text !== undefined) message.text = opts.text;
    if (opts.contactPhone !== undefined) {
        message.contact = { phone_number: opts.contactPhone };
    }
    return {
        from: { id: tgId },
        message: Object.keys(message).length > 0 ? message : undefined,
        answerCallbackQuery: vi.fn(async () => undefined),
        reply: vi.fn(async () => undefined),
        editMessageText: vi.fn(async () => undefined),
        editMessageReplyMarkup: vi.fn(async () => undefined),
    };
}

const TG_ID = 42;
const CUSTOMER_ID = "customer-uuid";
const SERVICE_ID = "svc-1";

beforeEach(() => {
    fsmState.rows.clear();
    fsmMocks.loadBotState.mockClear();
    fsmMocks.saveBotState.mockClear();
    fsmMocks.clearBotState.mockClear();
    dbState.customerByTg.clear();
    dbState.customers.clear();
    dbState.services.clear();
    dbState.weeklySchedule.length = 0;
    dbState.customerUpdates.length = 0;
    createAppointmentMock.mockClear();
    createAppointmentMock.mockResolvedValue({
        appointment: { id: "appt-uuid", referenceNumber: "APT-001" },
        customer: null,
        customerCreated: false,
        temporaryPassword: null,
        serviceTitles: ["Прокол уха"],
    });
    getBookingSettingsMock.mockClear();
    getBookingSettingsMock.mockResolvedValue({
        slotDurationMinutes: 30,
        bufferMinutes: 15,
        advanceDays: 14,
        minNoticeHours: 2,
    });
    availabilityMocks.computeSlotsForDay.mockClear();
    availabilityMocks.computeSlotsForDay.mockReturnValue({
        date: "2026-05-20",
        isWorkingDay: true,
        slots: ["10:00", "10:30", "11:00", "11:30"],
    });

    dbState.customerByTg.set(TG_ID, CUSTOMER_ID);
    // Seed every weekday open 10:00 — 19:00, no breaks. Combined with the
    // mocked `computeSlotsForDay` (which returns four slots regardless),
    // this ensures the bookable-dates window is non-empty.
    for (let dow = 0; dow < 7; dow += 1) {
        dbState.weeklySchedule.push({
            dayOfWeek: dow,
            isWorking: true,
            startTime: "10:00",
            endTime: "19:00",
            breaks: [],
        });
    }
    dbState.customers.set(CUSTOMER_ID, {
        id: CUSTOMER_ID,
        firstName: "Алина",
        lastName: "Иванова",
        email: "alina@example.com",
        phone: "+79991234567",
        dateOfBirth: null,
    });
    dbState.services.set(SERVICE_ID, {
        id: SERVICE_ID,
        title: "Прокол уха",
        durationMinutes: 30,
        isActive: true,
    });
});

afterEach(() => {
    vi.useRealTimers();
});

// Helper: build a `select_time` state ready for `bk:time:` taps.
function seedSelectTime(opts: { tgId?: number; date?: string; time?: string } = {}): void {
    fsmState.rows.set(opts.tgId ?? TG_ID, {
        flow: "book",
        step: "select_time",
        data: {
            serviceId: SERVICE_ID,
            durationMin: 30,
            date: opts.date ?? "2026-05-20",
            dates: [opts.date ?? "2026-05-20"],
            page: 0,
        },
        updatedAt: "2026-05-16T12:00:00.000Z",
    });
}

function seedConfirm(opts: { tgId?: number; date?: string; time?: string } = {}): void {
    fsmState.rows.set(opts.tgId ?? TG_ID, {
        flow: "book",
        step: "confirm",
        data: {
            serviceId: SERVICE_ID,
            durationMin: 30,
            date: opts.date ?? "2026-05-20",
            time: opts.time ?? "10:30",
            dates: [opts.date ?? "2026-05-20"],
        },
        updatedAt: "2026-05-16T12:00:00.000Z",
    });
}

// ---------------------------------------------------------------------------
// Property 9 — BookFlow transition table including contact branching
// ---------------------------------------------------------------------------
describe("Property 9: BookFlow contact branching matrix at select_time", () => {
    // 4-case matrix: (email present, phone present) → confirm landing.
    //                 anything-missing → collect_contact landing.
    const cases: Array<{
        email: string | null;
        phone: string | null;
        expectedStep: "confirm" | "collect_contact";
        expectedMissing: Array<"email" | "phone">;
    }> = [
        {
            email: "alina@example.com",
            phone: "+79991234567",
            expectedStep: "confirm",
            expectedMissing: [],
        },
        {
            email: "alina@example.com",
            phone: null,
            expectedStep: "collect_contact",
            expectedMissing: ["phone"],
        },
        {
            email: null,
            phone: "+79991234567",
            expectedStep: "collect_contact",
            expectedMissing: ["email"],
        },
        {
            email: null,
            phone: null,
            expectedStep: "collect_contact",
            expectedMissing: ["email", "phone"],
        },
    ];

    for (const tc of cases) {
        it(`(email=${tc.email !== null}, phone=${tc.phone !== null}) → ${tc.expectedStep}`, async () => {
            // Seed customer with the (email, phone) presence.
            const c = dbState.customers.get(CUSTOMER_ID)!;
            c.email = tc.email;
            c.phone = tc.phone;

            seedSelectTime();
            const ctx = makeCtx();
            await handleCallback(
                ctx as unknown as Parameters<typeof handleCallback>[0],
                "bk:time:10:30"
            );

            const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
            const persisted = saved as { step: string; data: { missing?: string[] } };
            expect(persisted.step).toEqual(tc.expectedStep);

            if (tc.expectedStep === "collect_contact") {
                expect(persisted.data.missing).toEqual(tc.expectedMissing);
            }
        });
    }
});

describe("Property 9: BookFlow transition table — main path", () => {
    it("/book initialises FSM to { flow:'book', step:'select_service', data:{} }", async () => {
        const ctx = makeCtx();
        await enter(ctx as unknown as Parameters<typeof enter>[0]);

        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "book",
            step: "select_service",
            data: {},
        });
    });

    it("select_service + bk:svc:<id> → select_date", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "book",
            step: "select_service",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            `bk:svc:${SERVICE_ID}`
        );
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "book",
            step: "select_date",
            data: { serviceId: SERVICE_ID, durationMin: 30 },
        });
    });

    it("select_date + bk:date:<iso> → select_time", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "book",
            step: "select_date",
            data: {
                serviceId: SERVICE_ID,
                durationMin: 30,
                dates: ["2026-05-20"],
            },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "bk:date:2026-05-20"
        );
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "book",
            step: "select_time",
            data: {
                serviceId: SERVICE_ID,
                durationMin: 30,
                date: "2026-05-20",
                page: 0,
            },
        });
    });

    it("any step + bk:cancel → state cleared, no save", async () => {
        seedSelectTime();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:cancel");
        expect(fsmMocks.clearBotState).toHaveBeenCalledWith(TG_ID);
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });

    it("select_time + bk:back → select_date (cached dates reused)", async () => {
        seedSelectTime();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:back");
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        expect(saved).toMatchObject({
            flow: "book",
            step: "select_date",
            data: { serviceId: SERVICE_ID, dates: ["2026-05-20"] },
        });
    });

    it("unknown payload stays in current state (no save)", async () => {
        seedSelectTime();
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "bk:gibberish"
        );
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
        expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Property 13 — Contact persistence regardless of channel
// ---------------------------------------------------------------------------
describe("Property 13: Contact persistence regardless of channel", () => {
    function seedCollectContact(missing: Array<"email" | "phone">): void {
        // Customer starts with the missing fields nulled out.
        const c = dbState.customers.get(CUSTOMER_ID)!;
        if (missing.includes("phone")) c.phone = null;
        if (missing.includes("email")) c.email = null;

        fsmState.rows.set(TG_ID, {
            flow: "book",
            step: "collect_contact",
            data: {
                serviceId: SERVICE_ID,
                durationMin: 30,
                date: "2026-05-20",
                time: "10:30",
                dates: ["2026-05-20"],
                missing,
            },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
    }

    it("phone via request_contact event persists customer.phone when valid", async () => {
        seedCollectContact(["phone"]);
        const ctx = makeCtx({ contactPhone: "+79991234567" });
        await handleContactMessage(ctx as unknown as Parameters<typeof handleContactMessage>[0]);

        expect(dbState.customerUpdates).toEqual([
            { customerId: CUSTOMER_ID, patch: { phone: "+79991234567" } },
        ]);
    });

    it("phone via typed text persists customer.phone when valid", async () => {
        seedCollectContact(["phone"]);
        const ctx = makeCtx({ text: "+79991234567" });
        await handleTextMessage(ctx as unknown as Parameters<typeof handleTextMessage>[0]);

        expect(dbState.customerUpdates).toEqual([
            { customerId: CUSTOMER_ID, patch: { phone: "+79991234567" } },
        ]);
    });

    it("phone via request_contact event leaves customer unchanged when invalid", async () => {
        seedCollectContact(["phone"]);
        const ctx = makeCtx({ contactPhone: "not-a-phone" });
        await handleContactMessage(ctx as unknown as Parameters<typeof handleContactMessage>[0]);

        expect(dbState.customerUpdates).toEqual([]);
        // FSM stays on collect_contact (no save).
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });

    it("phone via typed text leaves customer unchanged when invalid", async () => {
        seedCollectContact(["phone"]);
        const ctx = makeCtx({ text: "not-a-phone" });
        await handleTextMessage(ctx as unknown as Parameters<typeof handleTextMessage>[0]);

        expect(dbState.customerUpdates).toEqual([]);
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });

    it("email via typed text persists customer.email when valid", async () => {
        seedCollectContact(["email"]);
        const ctx = makeCtx({ text: "ALINA@example.com" });
        await handleTextMessage(ctx as unknown as Parameters<typeof handleTextMessage>[0]);

        // Schema lowercases email on parse.
        expect(dbState.customerUpdates).toEqual([
            { customerId: CUSTOMER_ID, patch: { email: "alina@example.com" } },
        ]);
    });

    it("email via typed text leaves customer unchanged when invalid", async () => {
        seedCollectContact(["email"]);
        const ctx = makeCtx({ text: "not-an-email" });
        await handleTextMessage(ctx as unknown as Parameters<typeof handleTextMessage>[0]);

        expect(dbState.customerUpdates).toEqual([]);
        expect(fsmMocks.saveBotState).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Property 14 — Waiver payload shape
// ---------------------------------------------------------------------------
describe("Property 14: Waiver payload shape", () => {
    it("createAppointment is invoked with the documented waiver payload + ctx", async () => {
        seedConfirm();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:cnf");

        expect(createAppointmentMock).toHaveBeenCalledTimes(1);
        const [input, callCtx] = createAppointmentMock.mock.calls[0] as unknown as [
            {
                serviceIds: string[];
                date: string;
                time: string;
                customer: {
                    firstName: string;
                    email: string;
                    phone: string;
                };
                waiverSigned: boolean;
                waiverSignatureData: string;
                createAccount: boolean;
            },
            {
                sessionCustomerId?: string;
                ipAddress?: string | null;
                userAgent?: string | null;
            },
        ];

        expect(input.waiverSigned).toBe(true);
        // ^tg-consent:<digits>:<ISO 8601 UTC>$
        const sigRe = /^tg-consent:\d+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u;
        expect(input.waiverSignatureData).toMatch(sigRe);

        // Embedded tgId equals ctx.from.id.
        const embeddedTgId = Number(input.waiverSignatureData.split(":")[1]);
        expect(embeddedTgId).toEqual(TG_ID);

        // Accompanying CreateAppointmentContext.
        expect(callCtx.ipAddress).toBeNull();
        expect(callCtx.userAgent).toEqual("telegram-bot");
        expect(callCtx.sessionCustomerId).toEqual(CUSTOMER_ID);

        // Service + datetime forwarded.
        expect(input.serviceIds).toEqual([SERVICE_ID]);
        expect(input.date).toEqual("2026-05-20");
        expect(input.time).toEqual("10:30");
        expect(input.createAccount).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Property 15 — Slot-conflict recovery
// ---------------------------------------------------------------------------
describe("Property 15: Slot-conflict recovery", () => {
    it("AppointmentError('slot_unavailable') rewinds to select_time and re-renders the picker without clearing", async () => {
        createAppointmentMock.mockRejectedValueOnce(
            new AppointmentError("slot_unavailable", "Время занято")
        );

        seedConfirm();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:cnf");

        // Russian-copy assertion.
        const replyCalls = ctx.reply.mock.calls.map((c) => c[0]);
        expect(replyCalls).toContain("Время занято. Выберите другой слот.");
        // Time-picker prompt re-rendered.
        expect(replyCalls).toContain("Выберите время");

        // FSM rewound to select_time, time field stripped.
        const [, saved] = fsmMocks.saveBotState.mock.calls.at(-1)!;
        const persisted = saved as { step: string; data: Record<string, unknown> };
        expect(persisted.step).toEqual("select_time");
        expect(persisted.data.time).toBeUndefined();
        expect(persisted.data.date).toEqual("2026-05-20");
        expect(persisted.data.serviceId).toEqual(SERVICE_ID);

        // No clearBotState fired on this branch.
        expect(fsmMocks.clearBotState).not.toHaveBeenCalled();
    });

    it("Other AppointmentError codes clear FSM and surface a generic Russian error", async () => {
        createAppointmentMock.mockRejectedValueOnce(
            new AppointmentError("service_not_found", "Услуга не найдена")
        );

        seedConfirm();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:cnf");

        expect(fsmMocks.clearBotState).toHaveBeenCalledWith(TG_ID);
        const replyCalls = ctx.reply.mock.calls.map((c) => c[0]);
        // The generic prefix message.
        const matched = replyCalls.find(
            (msg) => typeof msg === "string" && msg.includes("Не получилось подтвердить запись")
        );
        expect(matched).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Per-action smoke tests
// ---------------------------------------------------------------------------
describe("handleCallback — per-action smoke", () => {
    it("service tap renders the date picker text", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "book",
            step: "select_service",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            `bk:svc:${SERVICE_ID}`
        );
        const [body] = ctx.editMessageText.mock.calls[0] as unknown as [string, unknown];
        expect(body).toEqual("Выберите дату");
    });

    it("date tap renders the time picker text", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "book",
            step: "select_date",
            data: {
                serviceId: SERVICE_ID,
                durationMin: 30,
                dates: ["2026-05-20"],
            },
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "bk:date:2026-05-20"
        );
        const [body] = ctx.editMessageText.mock.calls[0] as unknown as [string, unknown];
        expect(body).toEqual("Выберите время");
    });

    it("time tap with full contact info → confirm summary uses HTML parse_mode", async () => {
        seedSelectTime();
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "bk:time:10:30"
        );
        const [body, opts] = ctx.editMessageText.mock.calls[0] as unknown as [
            string,
            { parse_mode?: string },
        ];
        expect(body).toContain("Подтверждение записи");
        expect(opts?.parse_mode).toEqual("HTML");
    });

    it("timePage tap uses editMessageReplyMarkup for in-place pagination", async () => {
        // Provide enough slots to support pagination.
        availabilityMocks.computeSlotsForDay.mockReturnValueOnce({
            date: "2026-05-20",
            isWorkingDay: true,
            slots: Array.from({ length: 30 }, (_, i) => {
                const h = String(Math.floor(i / 2)).padStart(2, "0");
                const m = i % 2 === 0 ? "00" : "30";
                return `${h}:${m}`;
            }),
        });
        seedSelectTime();
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            "bk:time_page:1"
        );
        expect(ctx.editMessageReplyMarkup).toHaveBeenCalledTimes(1);
        expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it("cancel tap renders the cancellation message", async () => {
        seedSelectTime();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:cancel");
        expect(ctx.editMessageText).toHaveBeenCalledWith("Действие отменено.");
    });
});

describe("Acknowledge before side effects (book flow)", () => {
    it("service tap acks before save / edit", async () => {
        fsmState.rows.set(TG_ID, {
            flow: "book",
            step: "select_service",
            data: {},
            updatedAt: "2026-05-16T12:00:00.000Z",
        });
        const ctx = makeCtx();
        await handleCallback(
            ctx as unknown as Parameters<typeof handleCallback>[0],
            `bk:svc:${SERVICE_ID}`
        );
        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const saveOrder = fsmMocks.saveBotState.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(saveOrder);
    });

    it("confirm tap acks before createAppointment", async () => {
        seedConfirm();
        const ctx = makeCtx();
        await handleCallback(ctx as unknown as Parameters<typeof handleCallback>[0], "bk:cnf");
        const ackOrder = ctx.answerCallbackQuery.mock.invocationCallOrder[0];
        const createOrder = createAppointmentMock.mock.invocationCallOrder[0];
        expect(ackOrder).toBeLessThan(createOrder);
    });
});
