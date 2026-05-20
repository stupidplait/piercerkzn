/**
 * Unit tests for the satisfaction-survey orchestration module.
 *
 * Every collaborator (DB, BullMQ, Resend wrapper, PostHog, Redis) is
 * mocked at the module boundary. Tests focus on the property-driven
 * orchestration contract:
 *
 *   - Property 12: Satisfaction job enqueue contract
 *   - Property 13: Satisfaction dispatch gate
 *   - Property 14: Satisfaction log row schema
 *   - Property 21 (satisfaction half): Studio-local fire instants
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    enqueueSatisfactionSurveyMock,
    sendSatisfactionSurveyEmailMock,
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

    const appointments = { __table: "appointments" } as const;
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
                    dbState.insertCalls.push({
                        table: tableTag(table),
                        values: v,
                    });
                    return undefined;
                },
            }),
        },
        appointments,
        customers,
        notificationLogs,
    };

    return {
        enqueueSatisfactionSurveyMock: vi.fn(async () => undefined),
        sendSatisfactionSurveyEmailMock: vi.fn(async () => "msg_satisfaction"),
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
        enqueueSatisfactionSurvey: enqueueSatisfactionSurveyMock,
    };
});

vi.mock("@/emails/dispatch", () => ({
    sendSatisfactionSurveyEmail: sendSatisfactionSurveyEmailMock,
}));

vi.mock("@/lib/posthog", () => ({
    capture: captureMock,
}));

vi.mock("@/lib/redis", () => ({
    redis: { del: redisDelMock, zrem: redisZremMock },
}));

vi.mock("drizzle-orm", () => ({
    eq: (..._a: unknown[]) => null,
    and: (..._a: unknown[]) => null,
    lte: (..._a: unknown[]) => null,
    notExists: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
    cancelSatisfactionSurvey,
    enqueueSatisfactionSurvey,
    sendSatisfactionSurveyIfDue,
} from "./reminders";
import { addDaysIso } from "@/lib/aftercare/time";
import { appointmentStartUtc } from "@/lib/booking/time";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeAppointment(
    overrides: Partial<{
        id: string;
        customerId: string | null;
        referenceNumber: string;
        date: string;
        timeStart: string;
        status: string;
        completedAt: Date | null;
    }> = {}
) {
    return {
        id: "appt-uuid",
        customerId: "customer-uuid",
        referenceNumber: "PK-APT-2026-0042",
        date: "2026-05-14",
        timeStart: "12:30",
        status: "completed",
        completedAt: new Date("2026-05-14T13:00:00Z"),
        ...overrides,
    };
}

function makeCustomer(
    overrides: Partial<{
        id: string;
        email: string | null;
        firstName: string;
        notificationEmail: boolean | null;
    }> = {}
) {
    return {
        id: "customer-uuid",
        email: "alina@example.com",
        firstName: "Алина",
        notificationEmail: true,
        ...overrides,
    };
}

function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

beforeEach(() => {
    enqueueSatisfactionSurveyMock.mockReset().mockResolvedValue(undefined);
    sendSatisfactionSurveyEmailMock.mockReset().mockResolvedValue("msg_satisfaction");
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
// Property 12 — Satisfaction job enqueue contract
// Validates: Requirements 5.1, 8.1
// ===========================================================================
describe("enqueueSatisfactionSurvey — Property 12: enqueue contract", () => {
    // For random `completedAt` and `now`, assert exactly one job with
    // `jobId === "satisfaction:<id>"` is enqueued onto `satisfaction:survey`
    // with `delayMs === max(0, appointmentStartUtc(addDaysIso(toIsoDate(T),
    // 7), "09:00") - now)`.
    const completedAtArb = fc.date({ min: new Date("2024-01-01"), max: new Date("2028-12-31") });
    const nowArb = fc.date({
        min: new Date("2024-01-01"),
        max: new Date("2029-06-30"),
    });

    it("enqueues exactly one job with the specified jobId and delay math", async () => {
        await fcAssert(
            fc.asyncProperty(completedAtArb, nowArb, async (completedAt, now) => {
                enqueueSatisfactionSurveyMock.mockClear();
                const appt = makeAppointment({ id: "appt-test" });

                const result = await enqueueSatisfactionSurvey(appt, completedAt, now);

                expect(result.scheduled).toBe(true);
                expect(enqueueSatisfactionSurveyMock).toHaveBeenCalledTimes(1);

                const expectedFireUtc = appointmentStartUtc(
                    addDaysIso(toIsoDate(completedAt), 7) ?? "",
                    "09:00"
                );
                expect(expectedFireUtc).not.toBeNull();
                const expectedDelay = Math.max(0, expectedFireUtc!.getTime() - now.getTime());

                expect(enqueueSatisfactionSurveyMock).toHaveBeenCalledWith(appt.id, expectedDelay);

                // The fire instant returned to the caller equals the
                // computed expected fire instant (Property 21 contract).
                expect(result.fireUtc?.getTime()).toBe(expectedFireUtc!.getTime());
            }),
            { numRuns: 50, seed: 1747003 }
        );
    });

    it("returns scheduled=false with reason='no_email_optin' when customerId is null", async () => {
        const appt = makeAppointment({ customerId: null });
        const r = await enqueueSatisfactionSurvey(
            appt,
            new Date("2026-05-14T12:00:00Z"),
            new Date("2026-05-14T13:00:00Z")
        );
        expect(r.scheduled).toBe(false);
        expect(r.reason).toBe("no_email_optin");
        expect(enqueueSatisfactionSurveyMock).not.toHaveBeenCalled();
    });

    it("returns scheduled=false with reason='no_completed_at' for invalid Date", async () => {
        const appt = makeAppointment();
        const r = await enqueueSatisfactionSurvey(
            appt,
            new Date(NaN),
            new Date("2026-05-14T13:00:00Z")
        );
        expect(r.scheduled).toBe(false);
        expect(r.reason).toBe("no_completed_at");
    });

    it("BullMQ producer failure is non-fatal — result still scheduled=true (cron is the safety net)", async () => {
        enqueueSatisfactionSurveyMock.mockRejectedValueOnce(new Error("redis down"));
        const appt = makeAppointment();
        const r = await enqueueSatisfactionSurvey(
            appt,
            new Date("2026-05-14T12:00:00Z"),
            new Date("2026-05-14T13:00:00Z")
        );
        expect(r.scheduled).toBe(true);
    });
});

// ===========================================================================
// Property 13 — Satisfaction dispatch gate
// Validates: Requirements 5.2, 5.3, 5.4, 5.6
// ===========================================================================
describe("sendSatisfactionSurveyIfDue — Property 13: dispatch gate", () => {
    // For all (status, notificationEmail, existingSentLog) triples assert
    // dispatch iff status==='completed' AND notificationEmail !== false AND
    // no prior sent log.
    const statusArb = fc.constantFrom("pending", "confirmed", "completed", "cancelled", "no_show");
    const optInArb = fc.constantFrom<boolean | null>(true, false, null);
    const existingLogArb = fc.boolean();

    // `now` strictly more than 7 days after completedAt so the time gate
    // is open in every iteration.
    const COMPLETED_AT = new Date("2026-05-14T13:00:00Z");
    const NOW = new Date("2026-05-22T13:00:00Z"); // +8d

    it("dispatches iff status='completed' AND notificationEmail !== false AND no prior sent log", async () => {
        await fcAssert(
            fc.asyncProperty(
                statusArb,
                optInArb,
                existingLogArb,
                async (status, notificationEmail, hasExistingSentLog) => {
                    sendSatisfactionSurveyEmailMock.mockClear();
                    dbState.selectByTable.clear();

                    const appt = makeAppointment({
                        status,
                        completedAt: COMPLETED_AT,
                    });
                    const customer = makeCustomer({
                        notificationEmail: notificationEmail as boolean | null,
                    });

                    queueSelectResult("appointments", [appt]);
                    if (status === "completed") {
                        // Time gate passes (NOW > completedAt + 7d).
                        // The orchestrator next runs the prior-sent-log check.
                        queueSelectResult(
                            "notificationLogs",
                            hasExistingSentLog ? [{ id: "log-1" }] : []
                        );
                        if (!hasExistingSentLog) {
                            queueSelectResult("customers", [customer]);
                        }
                    }

                    await sendSatisfactionSurveyIfDue(appt.id, NOW);

                    const shouldDispatch =
                        status === "completed" &&
                        notificationEmail !== false &&
                        !hasExistingSentLog;

                    if (shouldDispatch) {
                        expect(sendSatisfactionSurveyEmailMock).toHaveBeenCalledTimes(1);
                    } else {
                        expect(sendSatisfactionSurveyEmailMock).not.toHaveBeenCalled();
                    }
                }
            ),
            { numRuns: 60, seed: 1747004 }
        );
    });

    it("returns skippedReason='not_due_yet' when fireUtc is in the future", async () => {
        const appt = makeAppointment({
            completedAt: new Date("2026-05-14T13:00:00Z"),
        });
        queueSelectResult("appointments", [appt]);

        // `now` is only 1 day after completedAt — fireUtc (=+7d) is still in
        // the future, the time gate is closed.
        const r = await sendSatisfactionSurveyIfDue(appt.id, new Date("2026-05-15T13:00:00Z"));
        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("not_due_yet");
        expect(sendSatisfactionSurveyEmailMock).not.toHaveBeenCalled();
    });

    it("returns skippedReason='no_email' when customer email is missing", async () => {
        const appt = makeAppointment({ completedAt: COMPLETED_AT });
        const customer = makeCustomer({ email: null });

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);

        const r = await sendSatisfactionSurveyIfDue(appt.id, NOW);
        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("no_email");
        expect(sendSatisfactionSurveyEmailMock).not.toHaveBeenCalled();
    });

    it("returns skippedReason='opted_out' when notificationEmail === false", async () => {
        const appt = makeAppointment({ completedAt: COMPLETED_AT });
        const customer = makeCustomer({ notificationEmail: false });

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);

        const r = await sendSatisfactionSurveyIfDue(appt.id, NOW);
        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("opted_out");
        expect(sendSatisfactionSurveyEmailMock).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// Property 14 — Satisfaction log row schema
// Validates: Requirements 5.5
// ===========================================================================
describe("sendSatisfactionSurveyIfDue — Property 14: dispatch contract", () => {
    // Assert the dispatch wrapper is invoked with the metadata that
    // produces a `notification_log` row of shape:
    //   { type: "satisfaction_survey", channel: "email",
    //     metadata: { appointmentId } }
    //
    // The `dispatch()` helper inside `@/emails/dispatch.ts` is what writes
    // the `channel='email'` + `type='satisfaction_survey'` literals; this
    // unit test verifies the orchestrator hands the right inputs to that
    // helper. The integration test in PR 2 closes the loop by asserting
    // the actual DB row.
    it("invokes sendSatisfactionSurveyEmail with appointmentId, customerId, referenceNumber, customer email", async () => {
        const appt = makeAppointment({
            completedAt: new Date("2026-05-14T13:00:00Z"),
        });
        const customer = makeCustomer();

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);

        const r = await sendSatisfactionSurveyIfDue(appt.id, new Date("2026-05-22T13:00:00Z"));

        expect(r.sent).toBe(true);
        expect(sendSatisfactionSurveyEmailMock).toHaveBeenCalledTimes(1);
        expect(sendSatisfactionSurveyEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                to: customer.email,
                customerId: customer.id,
                appointmentId: appt.id,
                customerFirstName: customer.firstName,
                appointmentDate: appt.date,
                referenceNumber: appt.referenceNumber,
            })
        );
    });

    it("captures a posthog event on success", async () => {
        const appt = makeAppointment({
            completedAt: new Date("2026-05-14T13:00:00Z"),
        });
        const customer = makeCustomer();

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);

        await sendSatisfactionSurveyIfDue(appt.id, new Date("2026-05-22T13:00:00Z"));
        expect(captureMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: "satisfaction_survey_sent",
                distinctId: customer.id,
                properties: expect.objectContaining({
                    appointment_id: appt.id,
                    reference_number: appt.referenceNumber,
                }),
            })
        );
    });
});

// ===========================================================================
// Property 21 (satisfaction half) — Studio-local fire instants
// Validates: Requirements 8.1, 8.3
// ===========================================================================
describe("Property 21 — studio-local fire instants (satisfaction)", () => {
    // For every fire instant produced by the satisfaction producer, assert
    // equality with `appointmentStartUtc(targetDate, "09:00")`.
    it("enqueueSatisfactionSurvey fireUtc === appointmentStartUtc(addDaysIso(toIsoDate(completedAt), 7), '09:00')", async () => {
        await fcAssert(
            fc.asyncProperty(
                fc.date({
                    min: new Date("2024-01-01"),
                    max: new Date("2028-12-31"),
                }),
                async (completedAt) => {
                    enqueueSatisfactionSurveyMock.mockClear();
                    const appt = makeAppointment();
                    const result = await enqueueSatisfactionSurvey(
                        appt,
                        completedAt,
                        new Date("2024-01-01T00:00:00Z")
                    );

                    const expected = appointmentStartUtc(
                        addDaysIso(toIsoDate(completedAt), 7) ?? "",
                        "09:00"
                    );
                    expect(result.fireUtc?.getTime()).toBe(expected!.getTime());
                    // 09:00 МСК === 06:00 UTC; static check on the wall clock.
                    expect(result.fireUtc?.getUTCHours()).toBe(6);
                    expect(result.fireUtc?.getUTCMinutes()).toBe(0);
                }
            ),
            { numRuns: 40, seed: 1747005 }
        );
    });

    it("does not import a DST or timezone library at module level", async () => {
        // Static import-graph check: `lib/satisfaction/reminders.ts` must
        // only depend on the project's local `appointmentStartUtc` /
        // `addDaysIso` helpers (which are pure UTC arithmetic with a
        // hard-coded +03:00 offset). A future regression that pulls in
        // `date-fns-tz`, `luxon`, or `moment-timezone` here would
        // immediately surface as a new top-level import.
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const src = await fs.readFile(path.resolve(__dirname, "./reminders.ts"), "utf8");
        expect(src).not.toMatch(/from\s+['"]luxon['"]/u);
        expect(src).not.toMatch(/from\s+['"]moment-timezone['"]/u);
        expect(src).not.toMatch(/from\s+['"]date-fns-tz['"]/u);
        // The `date-fns` package (without -tz) is OK — the project uses it
        // for non-timezone formatting elsewhere — but this module should
        // route every studio-time conversion through `appointmentStartUtc`.
        expect(src).toMatch(/from\s+["']@\/lib\/booking\/time["']/u);
    });
});

// ===========================================================================
// Smoke — cancel never throws
// ===========================================================================
describe("cancelSatisfactionSurvey", () => {
    it("removes the job by jobId via Redis (best-effort, never throws)", async () => {
        await cancelSatisfactionSurvey("appt-xyz");
        expect(redisDelMock).toHaveBeenCalledWith("bull:satisfaction:survey:satisfaction:appt-xyz");
        expect(redisZremMock).toHaveBeenCalledWith(
            "bull:satisfaction:survey:delayed",
            "satisfaction:appt-xyz"
        );
    });

    it("swallows Redis failures", async () => {
        redisDelMock.mockRejectedValueOnce(new Error("boom"));
        await expect(cancelSatisfactionSurvey("appt-xyz")).resolves.toBeUndefined();
    });
});
