/**
 * Unit tests for the downsize-reminder orchestration module.
 *
 * Properties covered:
 *   - Property 16: Downsize enqueue gating
 *   - Property 18: Downsize idempotency gate
 *   - Property 19: Downsize unsubscribe preserves flag
 *   - Property 21 (downsize half): Studio-local fire instants
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    enqueueDownsizeReminderMock,
    sendDownsizeReminderEmailMock,
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
        updateCalls: Array<{ table: string; set: Record<string, unknown> }>;
    }
    const dbState: DbState = {
        selectByTable: new Map(),
        insertCalls: [],
        updateCalls: [],
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

    const aftercareTracking = { __table: "aftercareTracking" } as const;
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
            update: (table: object) => ({
                set(s: Record<string, unknown>) {
                    return {
                        where: async () => {
                            dbState.updateCalls.push({
                                table: tableTag(table),
                                set: s,
                            });
                            return undefined;
                        },
                    };
                },
            }),
        },
        aftercareTracking,
        customers,
        notificationLogs,
    };

    return {
        enqueueDownsizeReminderMock: vi.fn(async () => undefined),
        sendDownsizeReminderEmailMock: vi.fn(async () => "msg_downsize"),
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
        enqueueDownsizeReminder: enqueueDownsizeReminderMock,
    };
});

vi.mock("@/emails/dispatch", () => ({
    sendDownsizeReminderEmail: sendDownsizeReminderEmailMock,
}));

vi.mock("@/lib/settings", () => ({
    getAftercareSettings: getAftercareSettingsMock,
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
    inArray: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
    DOWNSIZE_OFFSET_DAYS,
    enqueueDownsizeReminder,
    sendDownsizeReminderIfDue,
} from "./reminders";
import { addDaysIso } from "@/lib/aftercare/time";
import { appointmentStartUtc } from "@/lib/booking/time";
import type { AftercareSettings } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const DEFAULT_DOWNSIZE_TYPES = ["ear", "lip", "nose", "navel", "eyebrow"];

function makeTracking(
    overrides: Partial<{
        id: string;
        appointmentId: string | null;
        customerId: string;
        piercingDate: string;
        piercingType: string;
        isActive: boolean;
        downsizeReminded: boolean;
    }> = {}
) {
    return {
        id: "tracking-uuid",
        appointmentId: "appt-uuid",
        customerId: "customer-uuid",
        piercingDate: "2026-05-14",
        piercingType: "ear",
        isActive: true,
        downsizeReminded: false,
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

beforeEach(() => {
    enqueueDownsizeReminderMock.mockReset().mockResolvedValue(undefined);
    sendDownsizeReminderEmailMock.mockReset().mockResolvedValue("msg_downsize");
    getAftercareSettingsMock.mockReset().mockResolvedValue({
        maxDays: 90,
        downsizePiercingTypes: [...DEFAULT_DOWNSIZE_TYPES],
    });
    captureMock.mockReset();
    redisDelMock.mockReset().mockResolvedValue(1);
    redisZremMock.mockReset().mockResolvedValue(1);
    dbState.selectByTable.clear();
    dbState.insertCalls.length = 0;
    dbState.updateCalls.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

// ===========================================================================
// Property 16 — Downsize enqueue gating
// Validates: Requirements 6.1, 6.2, 6.3
// ===========================================================================
describe("enqueueDownsizeReminder — Property 16: type-eligibility gating", () => {
    // For random `(piercingType, settings)` pairs assert exactly one job
    // with `jobId === "downsize:<trackingId>"` iff `piercingType ∈ effective
    // list`; assert default list applied when setting is unset.
    const eligibleTypeArb = fc.constantFrom("ear", "lip", "nose", "navel", "eyebrow");
    const allTypeArb = fc.constantFrom(
        "ear",
        "lip",
        "nose",
        "navel",
        "eyebrow",
        "industrial",
        "tongue",
        "nipple",
        "genital"
    );

    it("enqueues iff piercingType ∈ settings.downsizePiercingTypes (with explicit settings)", async () => {
        await fcAssert(
            fc.asyncProperty(
                allTypeArb,
                fc.array(eligibleTypeArb, { minLength: 0, maxLength: 5 }),
                async (piercingType, allowedRaw) => {
                    enqueueDownsizeReminderMock.mockClear();
                    const allowed = Array.from(new Set(allowedRaw));
                    const settings: AftercareSettings = {
                        maxDays: 90,
                        downsizePiercingTypes: allowed,
                    };
                    const tracking = makeTracking({
                        piercingDate: "2099-01-01", // far future → fireUtc > now
                        piercingType,
                    });
                    const now = new Date("2099-01-01T00:00:00Z");

                    const r = await enqueueDownsizeReminder(tracking, settings, now);

                    if ((allowed as readonly string[]).includes(piercingType)) {
                        expect(r.scheduled).toBe(true);
                        expect(enqueueDownsizeReminderMock).toHaveBeenCalledTimes(1);
                        // Producer payload + delay match the spec.
                        const call = enqueueDownsizeReminderMock.mock.calls[0] as unknown as [
                            Record<string, unknown>,
                            number,
                        ];
                        expect(call[0]).toMatchObject({
                            trackingId: tracking.id,
                            customerId: tracking.customerId,
                        });
                    } else {
                        expect(r.scheduled).toBe(false);
                        expect(r.reason).toBe("type_not_eligible");
                        expect(enqueueDownsizeReminderMock).not.toHaveBeenCalled();
                    }
                }
            ),
            { numRuns: 50, seed: 1747006 }
        );
    });

    it("falls back to getAftercareSettings() when settings argument is undefined (default list applied)", async () => {
        const tracking = makeTracking({
            piercingDate: "2099-01-01",
            piercingType: "ear", // in the default list
        });
        const r = await enqueueDownsizeReminder(
            tracking,
            undefined,
            new Date("2099-01-01T00:00:00Z")
        );
        expect(r.scheduled).toBe(true);
        expect(enqueueDownsizeReminderMock).toHaveBeenCalledTimes(1);
        expect(getAftercareSettingsMock).toHaveBeenCalled();
    });

    it("falls back to defaults when type not in default list", async () => {
        const tracking = makeTracking({
            piercingDate: "2099-01-01",
            piercingType: "industrial", // NOT in the default list
        });
        const r = await enqueueDownsizeReminder(
            tracking,
            undefined,
            new Date("2099-01-01T00:00:00Z")
        );
        expect(r.scheduled).toBe(false);
        expect(r.reason).toBe("type_not_eligible");
        expect(enqueueDownsizeReminderMock).not.toHaveBeenCalled();
    });

    it("uses jobId 'downsize:<trackingId>' on the producer", async () => {
        const tracking = makeTracking({
            id: "track-xyz",
            piercingDate: "2099-01-01",
            piercingType: "ear",
        });
        await enqueueDownsizeReminder(
            tracking,
            { maxDays: 90, downsizePiercingTypes: ["ear"] },
            new Date("2099-01-01T00:00:00Z")
        );
        // The producer mock accepts (payload, delayMs); the jobId logic
        // lives inside `enqueueDownsizeReminder` in `lib/queue.ts` (which we
        // re-import as the real module) — it's `downsize:<payload.trackingId>`.
        // Verify we hand the right trackingId.
        expect(enqueueDownsizeReminderMock).toHaveBeenCalledWith(
            expect.objectContaining({ trackingId: "track-xyz" }),
            expect.any(Number)
        );
    });

    it("skips and returns reason='already_past' when fireUtc <= now", async () => {
        const tracking = makeTracking({
            piercingDate: "2024-01-01", // long past — fireUtc already crossed
            piercingType: "ear",
        });
        const r = await enqueueDownsizeReminder(
            tracking,
            { maxDays: 90, downsizePiercingTypes: ["ear"] },
            new Date("2026-01-01T00:00:00Z")
        );
        expect(r.scheduled).toBe(false);
        expect(r.reason).toBe("already_past");
        expect(enqueueDownsizeReminderMock).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// Property 18 — Downsize idempotency gate
// Validates: Requirements 6.5
// ===========================================================================
describe("sendDownsizeReminderIfDue — Property 18: downsizeReminded flag idempotency", () => {
    // For tracking rows with `downsizeReminded = true`, assert repeated
    // `sendDownsizeReminderIfDue` performs no Resend call and inserts no
    // new log rows.
    it("returns skippedReason='already_sent' and skips dispatch when flag is set", async () => {
        const tracking = makeTracking({ downsizeReminded: true });
        // Far past piercingDate so the time gate would otherwise pass.
        tracking.piercingDate = "2024-01-01";

        queueSelectResult("aftercareTracking", [tracking]);

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));

        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("already_sent");
        expect(sendDownsizeReminderEmailMock).not.toHaveBeenCalled();
        // No flag-flip update issued because the row was already in the
        // terminal state.
        expect(dbState.updateCalls).toEqual([]);
    });

    it("self-heals via prior log row when downsizeReminded=false but log shows prior send", async () => {
        // The redundant audit-trail gate covers the rare case where the
        // dispatch wrote a log row but the flag flip failed. Repeated
        // invocations must not re-dispatch — they self-heal the flag.
        const tracking = makeTracking({ downsizeReminded: false });
        tracking.piercingDate = "2024-01-01";

        queueSelectResult("aftercareTracking", [tracking]);
        // customer load (after passing time + type gates)
        queueSelectResult("customers", [makeCustomer()]);
        // notificationLogs lookup → prior 'sent' row
        queueSelectResult("notificationLogs", [{ id: "log-1" }]);

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));

        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("already_sent");
        expect(sendDownsizeReminderEmailMock).not.toHaveBeenCalled();
        // Self-heal flipped the flag to true.
        expect(dbState.updateCalls).toEqual([
            { table: "aftercareTracking", set: { downsizeReminded: true } },
        ]);
    });
});

// ===========================================================================
// Property 19 — Downsize unsubscribe preserves flag
// Validates: Requirements 6.6
// ===========================================================================
describe("sendDownsizeReminderIfDue — Property 19: unsubscribe preserves flag", () => {
    it("notificationEmail=false → no Resend call AND downsizeReminded stays false", async () => {
        const tracking = makeTracking({
            piercingDate: "2024-01-01", // way past — time gate passes
            downsizeReminded: false,
        });
        const customer = makeCustomer({ notificationEmail: false });

        queueSelectResult("aftercareTracking", [tracking]);
        queueSelectResult("customers", [customer]);

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));

        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("opted_out");
        expect(sendDownsizeReminderEmailMock).not.toHaveBeenCalled();
        // The flag MUST NOT flip — customer may opt back in later and we
        // still want to deliver the reminder.
        expect(dbState.updateCalls.some((u) => u.set.downsizeReminded === true)).toBe(false);
    });

    it("happy path: opt-in customer → flag flips and email dispatches", async () => {
        const tracking = makeTracking({ piercingDate: "2024-01-01" });
        const customer = makeCustomer();

        queueSelectResult("aftercareTracking", [tracking]);
        queueSelectResult("customers", [customer]);
        queueSelectResult("notificationLogs", []); // no prior send
        // The orchestrator runs an `update` to flip the flag on success.

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));

        expect(r.sent).toBe(true);
        expect(sendDownsizeReminderEmailMock).toHaveBeenCalledTimes(1);
        expect(sendDownsizeReminderEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                to: customer.email,
                trackingId: tracking.id,
                customerId: customer.id,
                piercingDate: tracking.piercingDate,
                piercingTypeLabel: tracking.piercingType,
            })
        );
        expect(
            dbState.updateCalls.some(
                (u) => u.table === "aftercareTracking" && u.set.downsizeReminded === true
            )
        ).toBe(true);
    });

    it("dispatch_failed: messageId=null returns skippedReason and does NOT flip the flag", async () => {
        sendDownsizeReminderEmailMock.mockResolvedValueOnce(null as unknown as string);
        const tracking = makeTracking({ piercingDate: "2024-01-01" });
        const customer = makeCustomer();

        queueSelectResult("aftercareTracking", [tracking]);
        queueSelectResult("customers", [customer]);
        queueSelectResult("notificationLogs", []);

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));

        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("dispatch_failed");
        expect(dbState.updateCalls.some((u) => u.set.downsizeReminded === true)).toBe(false);
    });

    it("inactive tracking row returns skippedReason='tracking_inactive'", async () => {
        const tracking = makeTracking({ isActive: false });
        queueSelectResult("aftercareTracking", [tracking]);

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));
        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("tracking_inactive");
        expect(sendDownsizeReminderEmailMock).not.toHaveBeenCalled();
    });

    it("type became ineligible after enqueue: skippedReason='type_not_eligible'", async () => {
        const tracking = makeTracking({
            piercingDate: "2024-01-01",
            piercingType: "industrial", // NOT in the default list
        });
        // Settings reload returns the default list, which excludes "industrial".
        queueSelectResult("aftercareTracking", [tracking]);

        const r = await sendDownsizeReminderIfDue(tracking.id, new Date("2026-01-01T12:00:00Z"));
        expect(r.sent).toBe(false);
        expect(r.skippedReason).toBe("type_not_eligible");
        expect(sendDownsizeReminderEmailMock).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// Property 21 (downsize half) — Studio-local fire instants
// Validates: Requirements 8.1, 8.3
// ===========================================================================
describe("Property 21 — studio-local fire instants (downsize)", () => {
    const piercingDateArb = fc
        .date({
            min: new Date("2024-01-01"),
            max: new Date("2099-01-01"),
        })
        .map((d) => d.toISOString().slice(0, 10));

    it("enqueueDownsizeReminder fireUtc === appointmentStartUtc(addDaysIso(piercingDate, 42), '09:00')", async () => {
        await fcAssert(
            fc.asyncProperty(piercingDateArb, async (piercingDate) => {
                enqueueDownsizeReminderMock.mockClear();
                const tracking = makeTracking({
                    piercingDate,
                    piercingType: "ear",
                });
                const result = await enqueueDownsizeReminder(
                    tracking,
                    { maxDays: 90, downsizePiercingTypes: ["ear"] },
                    // `now` far in the past so we always emit a fireUtc
                    // (otherwise the `already_past` branch would suppress it).
                    new Date("2020-01-01T00:00:00Z")
                );

                const expected = appointmentStartUtc(
                    addDaysIso(piercingDate, DOWNSIZE_OFFSET_DAYS) ?? "",
                    "09:00"
                );
                expect(result.fireUtc?.getTime()).toBe(expected!.getTime());
                expect(result.fireUtc?.getUTCHours()).toBe(6);
                expect(result.fireUtc?.getUTCMinutes()).toBe(0);
            }),
            { numRuns: 40, seed: 1747007 }
        );
    });

    it("DOWNSIZE_OFFSET_DAYS is exactly 42 (= 6 weeks)", () => {
        expect(DOWNSIZE_OFFSET_DAYS).toBe(42);
    });

    it("does not import a DST or timezone library at module level", async () => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const src = await fs.readFile(path.resolve(__dirname, "./reminders.ts"), "utf8");
        expect(src).not.toMatch(/from\s+['"]luxon['"]/u);
        expect(src).not.toMatch(/from\s+['"]moment-timezone['"]/u);
        expect(src).not.toMatch(/from\s+['"]date-fns-tz['"]/u);
        expect(src).toMatch(/from\s+["']@\/lib\/booking\/time["']/u);
    });
});
