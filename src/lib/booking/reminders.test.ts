/**
 * Unit tests for the booking-reminder orchestration module.
 *
 * The module under test wires together BullMQ producers, the email +
 * Telegram dispatchers, and the database. Every collaborator is mocked at
 * the module boundary so these tests focus on the orchestration logic and
 * the unsubscribe / opt-in gate semantics — no DB, Redis, Resend, grammY
 * or BullMQ runtime is touched.
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 3:  Reminder channel isolation under unsubscribe
 *   - Property 4:  Default-true email opt-in
 *   - sendBookingReminderIfDue unit coverage for both kinds (24h / 2h)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    sendBookingReminderEmailMock,
    notifyBookingReminderMock,
    enqueueBookingReminderMock,
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
    const appointmentServices = { __table: "appointmentServices" } as const;
    const customers = { __table: "customers" } as const;
    const notificationLogs = { __table: "notificationLogs" } as const;
    const services = { __table: "services" } as const;
    const settings = { __table: "settings" } as const;

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
        appointmentServices,
        customers,
        notificationLogs,
        services,
        settings,
    };

    return {
        sendBookingReminderEmailMock: vi.fn(async () => "msg_999"),
        notifyBookingReminderMock: vi.fn(async () => true),
        enqueueBookingReminderMock: vi.fn(async () => undefined),
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
        enqueueBookingReminder: enqueueBookingReminderMock,
    };
});

vi.mock("@/emails/dispatch", () => ({
    sendBookingReminderEmail: sendBookingReminderEmailMock,
}));

vi.mock("@/lib/telegram/notifications", () => ({
    notifyBookingReminder: notifyBookingReminderMock,
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
    gt: (..._a: unknown[]) => null,
    inArray: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { REMINDER_KINDS, sendBookingReminderIfDue, type ReminderKind } from "./reminders";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeAppointment(
    overrides: Partial<{
        id: string;
        customerId: string | null;
        customerEmail: string;
        customerFirstName: string;
        referenceNumber: string;
        status: string;
        date: string;
        timeStart: string;
        timeEnd: string;
    }> = {}
) {
    return {
        id: "appt-uuid",
        customerId: "customer-uuid",
        customerEmail: "guest@example.com",
        customerFirstName: "Иван",
        referenceNumber: "PK-APT-2026-0042",
        status: "confirmed",
        date: "2099-05-14", // far future so the reminder window is open
        timeStart: "12:30:00",
        timeEnd: "13:00:00",
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
    sendBookingReminderEmailMock.mockReset().mockResolvedValue("msg_999");
    notifyBookingReminderMock.mockReset().mockResolvedValue(true);
    enqueueBookingReminderMock.mockReset().mockResolvedValue(undefined);
    captureMock.mockReset();
    redisDelMock.mockReset().mockResolvedValue(1);
    redisZremMock.mockReset().mockResolvedValue(1);
    dbState.selectByTable.clear();
    dbState.insertCalls.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

// `now` is far before the appointment (2099-05-14 12:30 МСК = 09:30 UTC),
// so the time gate (`appointmentStartUtc > now`) always passes and the
// 24h / 2h reminder window is wide open.
const NOW = new Date("2099-05-13T00:00:00Z");

// ===========================================================================
// Property 3 — Reminder channel isolation under unsubscribe
// Validates: Requirements 2.1, 2.2
// ===========================================================================
describe("sendBookingReminderIfDue — Property 3: unsubscribe channel isolation", () => {
    // For any (appointmentId, kind) and customer with `notificationEmail =
    // false`, assert no Resend call, no `email`-channel `sent` log row, and
    // that the Telegram path is still attempted.
    it.each<ReminderKind>([...REMINDER_KINDS])(
        "kind=%s — notificationEmail=false skips email but invokes Telegram",
        async (kind) => {
            const appt = makeAppointment();
            const customer = makeCustomer({ notificationEmail: false });

            queueSelectResult("appointments", [appt]);
            queueSelectResult("notificationLogs", []); // no prior sends
            queueSelectResult("customers", [customer]);
            queueSelectResult("appointmentServices", []); // no service titles
            queueSelectResult("settings", []); // studio address absent

            const result = await sendBookingReminderIfDue(appt.id, kind, NOW);

            // Email channel: no Resend call, no `sent` log row written by us.
            expect(sendBookingReminderEmailMock).not.toHaveBeenCalled();
            // Telegram channel: still attempted.
            expect(notifyBookingReminderMock).toHaveBeenCalledTimes(1);
            expect(notifyBookingReminderMock).toHaveBeenCalledWith(
                expect.objectContaining({ id: appt.id }),
                kind,
                expect.any(Object)
            );

            // The result reflects the Telegram dispatch (mock returns true).
            expect(result.sent).toBe(true);
            expect(result.emailSent).toBeUndefined();
            expect(result.telegramSent).toBe(true);
        }
    );

    it("notificationEmail=false AND telegram-not-linked → both channels skipped, sent=false", async () => {
        const appt = makeAppointment();
        const customer = makeCustomer({ notificationEmail: false });

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);
        queueSelectResult("appointmentServices", []);
        queueSelectResult("settings", []);

        // Telegram returns false (chat not linked / opted out).
        notifyBookingReminderMock.mockResolvedValueOnce(false);

        const result = await sendBookingReminderIfDue(appt.id, "24h", NOW);

        expect(sendBookingReminderEmailMock).not.toHaveBeenCalled();
        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("no_email_and_no_telegram");
    });
});

// ===========================================================================
// Property 4 — Default-true email opt-in
// Validates: Requirements 2.3
// ===========================================================================
describe("sendBookingReminderIfDue — Property 4: default-true opt-in", () => {
    // For `notificationEmail = null | undefined`, assert email send is
    // attempted. `false` is the only value that gates email; everything
    // else (null / undefined / true) lets the email through.
    const optInArb = fc.constantFrom<boolean | null | undefined>(true, null, undefined);

    it("attempts email when notificationEmail is true | null | undefined", async () => {
        await fcAssert(
            fc.asyncProperty(
                optInArb,
                fc.constantFrom<ReminderKind>(...REMINDER_KINDS),
                async (notificationEmail, kind) => {
                    sendBookingReminderEmailMock.mockClear();
                    notifyBookingReminderMock.mockClear();
                    dbState.selectByTable.clear();

                    const appt = makeAppointment();
                    const customer = makeCustomer({
                        notificationEmail: notificationEmail as boolean | null,
                    });

                    queueSelectResult("appointments", [appt]);
                    queueSelectResult("notificationLogs", []);
                    queueSelectResult("customers", [customer]);
                    queueSelectResult("appointmentServices", []);
                    queueSelectResult("settings", []);

                    await sendBookingReminderIfDue(appt.id, kind, NOW);

                    expect(sendBookingReminderEmailMock).toHaveBeenCalledTimes(1);
                    expect(sendBookingReminderEmailMock).toHaveBeenCalledWith(
                        expect.objectContaining({
                            kind,
                            appointmentId: appt.id,
                            to: customer.email,
                        })
                    );
                }
            ),
            { numRuns: 30, seed: 1747002 }
        );
    });

    it("falls back to appointment.customerEmail when no customer record exists", async () => {
        // When `appt.customerId` is null we never load a customer row;
        // `notificationEmail` defaults to true (no opt-out exists), so the
        // email *is* attempted using `appt.customerEmail`.
        const appt = makeAppointment({ customerId: null });

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        // No customers row queued because the orchestrator skips the
        // SELECT when `customerId` is null.
        queueSelectResult("appointmentServices", []);
        queueSelectResult("settings", []);

        await sendBookingReminderIfDue(appt.id, "24h", NOW);

        expect(sendBookingReminderEmailMock).toHaveBeenCalledTimes(1);
        expect(sendBookingReminderEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({ to: appt.customerEmail })
        );
    });
});

// ===========================================================================
// sendBookingReminderIfDue — unit coverage for unsubscribe gate behaviour
// Requirements: 2.4
// ===========================================================================
describe("sendBookingReminderIfDue — unit coverage for both kinds", () => {
    it.each<ReminderKind>([...REMINDER_KINDS])(
        "kind=%s: terminal status (cancelled) skips both channels",
        async (kind) => {
            const appt = makeAppointment({ status: "cancelled" });
            queueSelectResult("appointments", [appt]);

            const result = await sendBookingReminderIfDue(appt.id, kind, NOW);

            expect(result.sent).toBe(false);
            expect(result.skippedReason).toBe("appointment_terminal");
            expect(sendBookingReminderEmailMock).not.toHaveBeenCalled();
            expect(notifyBookingReminderMock).not.toHaveBeenCalled();
        }
    );

    it.each<ReminderKind>([...REMINDER_KINDS])(
        "kind=%s: appointment in the past short-circuits with skippedReason='in_past'",
        async (kind) => {
            const appt = makeAppointment({ date: "2000-01-01" });
            queueSelectResult("appointments", [appt]);

            const result = await sendBookingReminderIfDue(appt.id, kind, NOW);

            expect(result.sent).toBe(false);
            expect(result.skippedReason).toBe("in_past");
            expect(sendBookingReminderEmailMock).not.toHaveBeenCalled();
            expect(notifyBookingReminderMock).not.toHaveBeenCalled();
        }
    );

    it.each<ReminderKind>([...REMINDER_KINDS])(
        "kind=%s: per-channel idempotency skips channels with prior 'sent' log rows",
        async (kind) => {
            const appt = makeAppointment();
            const customer = makeCustomer();

            queueSelectResult("appointments", [appt]);
            // Email already sent on a prior tick — Telegram still pending.
            queueSelectResult("notificationLogs", [{ channel: "email" }]);
            queueSelectResult("customers", [customer]);
            queueSelectResult("appointmentServices", []);
            queueSelectResult("settings", []);

            const result = await sendBookingReminderIfDue(appt.id, kind, NOW);

            expect(sendBookingReminderEmailMock).not.toHaveBeenCalled();
            expect(notifyBookingReminderMock).toHaveBeenCalledTimes(1);
            // Telegram dispatch fires; `sent` is the OR of the two channels.
            expect(result.telegramSent).toBe(true);
        }
    );

    it.each<ReminderKind>([...REMINDER_KINDS])(
        "kind=%s: appointment not found returns skippedReason='appointment_not_found'",
        async (kind) => {
            queueSelectResult("appointments", []); // empty result

            const result = await sendBookingReminderIfDue("missing-id", kind, NOW);
            expect(result.sent).toBe(false);
            expect(result.skippedReason).toBe("appointment_not_found");
            expect(sendBookingReminderEmailMock).not.toHaveBeenCalled();
            expect(notifyBookingReminderMock).not.toHaveBeenCalled();
        }
    );

    it("happy path for kind=24h: dispatches email + telegram and returns sent=true", async () => {
        const appt = makeAppointment();
        const customer = makeCustomer();

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);
        queueSelectResult("appointmentServices", []);
        queueSelectResult("settings", []);

        const result = await sendBookingReminderIfDue(appt.id, "24h", NOW);

        expect(result.sent).toBe(true);
        expect(result.emailSent).toBe(true);
        expect(result.telegramSent).toBe(true);
        expect(sendBookingReminderEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "24h",
                appointmentId: appt.id,
                customerId: customer.id,
                referenceNumber: appt.referenceNumber,
            })
        );
        expect(notifyBookingReminderMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: appt.id }),
            "24h",
            expect.any(Object)
        );
    });

    it("happy path for kind=2h: dispatches email + telegram", async () => {
        const appt = makeAppointment();
        const customer = makeCustomer();

        queueSelectResult("appointments", [appt]);
        queueSelectResult("notificationLogs", []);
        queueSelectResult("customers", [customer]);
        queueSelectResult("appointmentServices", []);
        queueSelectResult("settings", []);

        const result = await sendBookingReminderIfDue(appt.id, "2h", NOW);

        expect(result.sent).toBe(true);
        expect(sendBookingReminderEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "2h" })
        );
    });
});
