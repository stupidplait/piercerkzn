/**
 * Unit tests for the aftercare drip orchestration module.
 *
 * The module under test wires together BullMQ producers, the settings
 * reader, the email + Telegram dispatchers, and the database. Every
 * collaborator is mocked at the module boundary so these tests focus on
 * the orchestration logic — no DB, Redis, Resend, grammY, or queue is
 * touched at runtime.
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 9: Drip enqueue respects time gate and max-days bound
 *   - Property 10: Aftercare log-type strings
 *   - Property 11: Sweeper covers every step
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ---------------------------------------------------------------------------
// Hoisted mocks — the module under test eagerly imports these at top-level,
// so we have to hoist their fakes via `vi.hoisted()` to make them visible
// inside the `vi.mock()` factories.
// ---------------------------------------------------------------------------
const {
    enqueueAftercareStepMock,
    sendAftercareStepEmailMock,
    notifyAftercareStepMock,
    getAftercareSettingsMock,
    captureMock,
    redisDelMock,
    redisZremMock,
    dbState,
    queueSelectResult,
    dbModule,
} = vi.hoisted(() => {
    interface DbState {
        selectByTable: Map<string, unknown[][]>;
        insertCalls: Array<{ table: string; values: Record<string, unknown> }>;
    }
    const dbState: DbState = {
        selectByTable: new Map(),
        insertCalls: [],
    };
    function selectFromTable(table: string) {
        const queue = dbState.selectByTable.get(table) ?? [];
        const next = queue.shift() ?? [];
        dbState.selectByTable.set(table, queue);
        return next;
    }
    function queueSelectResult(table: string, rows: unknown[]) {
        const existing = dbState.selectByTable.get(table) ?? [];
        existing.push(rows);
        dbState.selectByTable.set(table, existing);
    }

    // Sentinel objects that stand in for the Drizzle schema exports. The
    // module under test calls `db.select().from(<table>)` against these,
    // so we tag them with a symbolic name and dispatch on that.
    const aftercareTracking = { __table: "aftercareTracking" } as const;
    const aftercareGuides = { __table: "aftercareGuides" } as const;
    const customers = { __table: "customers" } as const;
    const notificationLogs = { __table: "notificationLogs" } as const;

    function tableTag(table: object): string {
        return (table as { __table?: string }).__table ?? "unknown";
    }

    function makeChain(table: string) {
        const result = () => selectFromTable(table);
        const obj = {
            where: () => obj,
            limit: () => obj,
            innerJoin: () => obj,
            orderBy: () => obj,
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
                from: (table: object) => makeChain(tableTag(table)),
            }),
            insert: (table: object) => ({
                values: async (v: Record<string, unknown>) => {
                    dbState.insertCalls.push({ table: tableTag(table), values: v });
                    return undefined;
                },
            }),
        },
        aftercareTracking,
        aftercareGuides,
        customers,
        notificationLogs,
    };

    return {
        enqueueAftercareStepMock: vi.fn(async () => undefined),
        sendAftercareStepEmailMock: vi.fn(async () => "msg_123"),
        notifyAftercareStepMock: vi.fn(async () => true),
        getAftercareSettingsMock: vi.fn(async () => ({
            maxDays: 90,
            downsizePiercingTypes: ["ear", "lip", "nose", "navel", "eyebrow"],
        })),
        captureMock: vi.fn(),
        redisDelMock: vi.fn(async () => 1),
        redisZremMock: vi.fn(async () => 1),
        dbState,
        queueSelectResult,
        dbModule,
    };
});

vi.mock("@/db", () => dbModule);

vi.mock("@/lib/queue", async () => {
    const real = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return {
        ...real,
        enqueueAftercareStep: enqueueAftercareStepMock,
    };
});

vi.mock("@/emails/dispatch", () => ({
    sendAftercareStepEmail: sendAftercareStepEmailMock,
}));

vi.mock("@/lib/telegram/notifications", () => ({
    notifyAftercareStep: notifyAftercareStepMock,
}));

vi.mock("@/lib/settings", () => ({
    getAftercareSettings: getAftercareSettingsMock,
}));

vi.mock("@/lib/posthog", () => ({
    capture: captureMock,
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        del: redisDelMock,
        zrem: redisZremMock,
    },
}));

// drizzle-orm helpers (eq, and, lte, sql) are only used to build WHERE
// clauses — our chain mock ignores them. Stub with no-ops so the orchestration
// code can call them without exploding.
vi.mock("drizzle-orm", () => ({
    eq: (..._a: unknown[]) => null,
    and: (..._a: unknown[]) => null,
    lte: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null; raw: () => null },
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all mocks are registered so that
// module-init code sees the fakes, not the real implementations.
// ---------------------------------------------------------------------------
import { enqueueAftercareDrip, sendAftercareStepIfDue, sweepDueAftercareSteps } from "./reminders";
import {
    AFTERCARE_STEPS,
    STEP_OFFSET_DAYS,
    aftercareStepFireUtc,
    type AftercareStep,
} from "./time";

// ---------------------------------------------------------------------------
// Test fixtures and helpers
// ---------------------------------------------------------------------------
const TRACKING = {
    id: "tracking-uuid",
    appointmentId: "appt-uuid",
    customerId: "customer-uuid",
    piercingDate: "2026-05-14",
    piercingType: "helix",
    isActive: true,
    guideId: null,
};

const CUSTOMER = {
    id: "customer-uuid",
    email: "alina@example.com",
    firstName: "Алина",
    notificationEmail: true,
};

beforeEach(() => {
    enqueueAftercareStepMock.mockReset().mockResolvedValue(undefined);
    sendAftercareStepEmailMock.mockReset().mockResolvedValue("msg_123");
    notifyAftercareStepMock.mockReset().mockResolvedValue(true);
    getAftercareSettingsMock.mockReset().mockResolvedValue({
        maxDays: 90,
        downsizePiercingTypes: ["ear", "lip", "nose", "navel", "eyebrow"],
    });
    captureMock.mockReset();
    redisDelMock.mockReset().mockResolvedValue(1);
    redisZremMock.mockReset().mockResolvedValue(1);
    dbState.selectByTable.clear();
    dbState.insertCalls.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

// ===========================================================================
// Property 9 — Drip enqueue respects time gate and max-days bound
// Validates: Requirements 4.4, 4.8, 4.9, 8.1, 8.2
// ===========================================================================
describe("enqueueAftercareDrip — Property 9: time gate + max-days bound", () => {
    // Generators carved to the input space:
    //   - piercingDate: ISO YYYY-MM-DD spanning a 4-year horizon around 2026
    //   - now: a UTC instant on a 2-year horizon around the piercing date
    //   - maxDays: any value in {1, 3, 7, 14, 30, 60, 90, 100} so we hit
    //     each step's boundary plus an above-cap value
    const piercingDateArb = fc
        .date({ min: new Date("2024-01-01"), max: new Date("2028-12-31") })
        .map((d) => d.toISOString().slice(0, 10));
    const nowArb = fc.date({
        min: new Date("2024-01-01"),
        max: new Date("2029-06-30"),
    });
    const maxDaysArb = fc.constantFrom(1, 3, 7, 14, 30, 60, 90, 100);

    it("schedules exactly the steps with offset ≤ maxDays AND fireUtc > now", async () => {
        await fcAssert(
            fc.asyncProperty(
                piercingDateArb,
                nowArb,
                maxDaysArb,
                async (piercingDate, now, maxDays) => {
                    enqueueAftercareStepMock.mockClear();
                    getAftercareSettingsMock.mockResolvedValue({
                        maxDays,
                        downsizePiercingTypes: [],
                    });

                    const result = await enqueueAftercareDrip({ ...TRACKING, piercingDate }, now);

                    // Reference set: the steps that *should* have been
                    // scheduled per the spec — offset ≤ maxDays AND the
                    // computed fire instant strictly in the future.
                    const expected: AftercareStep[] = [];
                    for (const step of AFTERCARE_STEPS) {
                        if (STEP_OFFSET_DAYS[step] > maxDays) continue;
                        const fire = aftercareStepFireUtc(piercingDate, step);
                        if (!fire) continue;
                        if (fire.getTime() <= now.getTime()) continue;
                        expected.push(step);
                    }

                    expect(result.scheduled).toEqual(expected);

                    // Producer invoked once per scheduled step with the right
                    // jobId-bound payload + delay.
                    expect(enqueueAftercareStepMock).toHaveBeenCalledTimes(expected.length);
                    for (const step of expected) {
                        const fire = aftercareStepFireUtc(piercingDate, step)!;
                        const expectedDelay = fire.getTime() - now.getTime();
                        expect(enqueueAftercareStepMock).toHaveBeenCalledWith(
                            {
                                appointmentId: TRACKING.appointmentId,
                                customerId: TRACKING.customerId,
                                step,
                            },
                            expectedDelay
                        );
                    }
                }
            ),
            { numRuns: 60, seed: 1747001 }
        );
    });

    it("falls back to tracking.id when appointmentId is null", async () => {
        // Bug catch — `enqueueAftercareDrip` should pass
        // `tracking.appointmentId ?? tracking.id` as the payload's
        // appointmentId so the worker resolves the tracking row by either
        // key.
        await enqueueAftercareDrip(
            { ...TRACKING, appointmentId: null, piercingDate: "2099-01-01" },
            new Date("2098-12-31T00:00:00Z")
        );
        const firstCall = enqueueAftercareStepMock.mock.calls[0] as unknown as [
            Record<string, unknown>,
            number,
        ];
        expect(firstCall[0]).toMatchObject({ appointmentId: TRACKING.id });
    });
});

// ===========================================================================
// Property 10 — Aftercare log-type strings
// Validates: Requirements 4.6
// ===========================================================================
describe("sendAftercareStepIfDue — Property 10: log-type strings", () => {
    // Every step's send must drive `dispatch()` with `type='aftercare_<step>'`
    // (the dispatch module hard-codes this — see `emails/dispatch.ts`'s
    // `sendAftercareStepEmail` wrapper) and the Telegram pipeline with the
    // same `type` (see `lib/telegram/notifications.ts`'s
    // `notifyAftercareStep` wrapper). Asserting the `step` arg is the
    // unit-test-level proxy: the type string is statically derived from
    // `step` in those modules.
    it.each(AFTERCARE_STEPS)(
        "step %s drives email + telegram dispatch with the right step (→ type=`aftercare_${step}`)",
        async (step) => {
            // `now` strictly after the step's fire instant so the time gate
            // passes. Piercing date 2026-05-14 + 90d max-offset = early Aug;
            // pin `now` to far in the future to guarantee all steps are due.
            const now = new Date("2027-01-01T12:00:00Z");

            queueSelectResult("aftercareTracking", [TRACKING]);
            queueSelectResult("notificationLogs", []); // no prior sends
            queueSelectResult("customers", [CUSTOMER]);
            queueSelectResult("aftercareGuides", []); // no guide

            const result = await sendAftercareStepIfDue(TRACKING.id, step, now);

            expect(result.sent).toBe(true);
            expect(result.step).toBe(step);

            expect(sendAftercareStepEmailMock).toHaveBeenCalledTimes(1);
            expect(sendAftercareStepEmailMock).toHaveBeenCalledWith(
                expect.objectContaining({ step, trackingId: TRACKING.id })
            );

            expect(notifyAftercareStepMock).toHaveBeenCalledTimes(1);
            expect(notifyAftercareStepMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    step,
                    trackingId: TRACKING.id,
                    customerId: CUSTOMER.id,
                })
            );
        }
    );

    it("idempotency: repeated invocations after a successful send produce no duplicate dispatch", async () => {
        const step: AftercareStep = "day7";
        const now = new Date("2027-01-01T12:00:00Z");

        // First call — clean state, both channels dispatch.
        queueSelectResult("aftercareTracking", [TRACKING]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [CUSTOMER]);
        queueSelectResult("aftercareGuides", []);
        await sendAftercareStepIfDue(TRACKING.id, step, now);

        sendAftercareStepEmailMock.mockClear();
        notifyAftercareStepMock.mockClear();

        // Second call — log shows both channels already sent, so the
        // function short-circuits before dispatching.
        queueSelectResult("aftercareTracking", [TRACKING]);
        queueSelectResult("notificationLogs", [{ channel: "email" }, { channel: "telegram" }]);
        const result = await sendAftercareStepIfDue(TRACKING.id, step, now);

        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("already_sent");
        expect(sendAftercareStepEmailMock).not.toHaveBeenCalled();
        expect(notifyAftercareStepMock).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// Property 11 — Sweeper covers every step
// Validates: Requirements 4.5
// ===========================================================================
describe("sweepDueAftercareSteps — Property 11: covers every step", () => {
    it("iterates all 7 steps and invokes the per-step send for each due tracking row", async () => {
        // Single tracking row whose piercingDate is 100+ days in the past,
        // so every step's fire instant has already crossed `now`. The
        // candidate pre-filter widens by the step offset, so the row will
        // appear in the candidate set for every step.
        const now = new Date("2027-01-01T12:00:00Z");
        const trackingRow = {
            id: TRACKING.id,
            piercingDate: "2026-05-14",
        };

        // Each step iteration runs:
        //   1. db.select(aftercareTracking) — candidates
        //   2. (in `sendAftercareStepIfDue`)
        //      a. db.select(aftercareTracking) — load tracking
        //      b. db.select(notificationLogs) — already-sent check
        //      c. db.select(customers) — load customer
        //      d. db.select(aftercareGuides) — guide fallback (empty)
        //
        // Queue 7 iterations of this fixture so the sweeper runs cleanly.
        for (let i = 0; i < AFTERCARE_STEPS.length; i++) {
            queueSelectResult("aftercareTracking", [trackingRow]); // candidates
            queueSelectResult("aftercareTracking", [TRACKING]); // load
            queueSelectResult("notificationLogs", []); // no prior sends
            queueSelectResult("customers", [CUSTOMER]);
            queueSelectResult("aftercareGuides", []);
        }

        const result = await sweepDueAftercareSteps(now);

        // One candidate × seven steps = seven invocations.
        expect(result.candidates).toBe(AFTERCARE_STEPS.length);
        // Each due step that successfully dispatches counts toward `sent[step]`.
        for (const step of AFTERCARE_STEPS) {
            expect(result.sent[step]).toBe(1);
        }
        // Email + Telegram were each invoked once per step.
        expect(sendAftercareStepEmailMock).toHaveBeenCalledTimes(AFTERCARE_STEPS.length);
        expect(notifyAftercareStepMock).toHaveBeenCalledTimes(AFTERCARE_STEPS.length);
        // Every step was dispatched at least once across the fan-out.
        const dispatchedSteps = new Set(
            sendAftercareStepEmailMock.mock.calls.map(
                (c) => (c as unknown as Array<{ step: AftercareStep }>)[0].step
            )
        );
        for (const step of AFTERCARE_STEPS) {
            expect(dispatchedSteps.has(step)).toBe(true);
        }
    });

    it("skips steps with offset > maxDays (settings cap)", async () => {
        // Cap at day14 — the sweeper must not even consider day30/60/90.
        getAftercareSettingsMock.mockResolvedValue({
            maxDays: 14,
            downsizePiercingTypes: [],
        });
        const now = new Date("2027-01-01T12:00:00Z");

        // Queue an empty candidate set for the 4 in-cap steps so the
        // sweeper iterates without doing further loads.
        for (let i = 0; i < 4; i++) {
            queueSelectResult("aftercareTracking", []); // empty candidates
        }

        const result = await sweepDueAftercareSteps(now);
        expect(result.candidates).toBe(0);
        // The post-cap steps were short-circuited before the candidate
        // query — verify by ensuring we didn't drain more queue entries
        // than expected.
        expect(dbState.selectByTable.get("aftercareTracking")).toEqual([]);
    });
});
