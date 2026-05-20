/**
 * Unit tests for the newsletter campaign orchestration core.
 *
 * The module under test wires together the audience selector, the BullMQ
 * producer, the per-recipient email dispatcher, the settings reader, and
 * the database. Every collaborator is mocked at the module boundary so
 * these tests focus on the orchestration contract.
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 5:  Per-recipient idempotency contract (claim → send)
 *   - Property 6:  Chunking arithmetic and pacing
 *   - Property 7:  Empty-audience short-circuit
 *
 * Validates: Requirements 4.4, 5.1, 5.2, 5.3, 5.4, 11.6
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    enqueueNewsletterCampaignJobMock,
    sendNewsletterCampaignEmailMock,
    selectMarketingAudienceMock,
    getNewsletterSettingsMock,
    captureMock,
    dbState,
    queueSelectResult,
    dbModule,
} = vi.hoisted(() => {
    interface DbState {
        selectByTable: Map<string, unknown[][]>;
        insertCalls: Array<{ table: string; values: Record<string, unknown> }>;
        updateCalls: Array<{ table: string; set: Record<string, unknown> }>;
        deleteCalls: Array<{ table: string }>;
        // Queue of values to return from `update().…returning()` per table.
        updateReturning: Map<string, unknown[][]>;
        // Queue of values to return from `delete().…returning()` per table.
        deleteReturning: Map<string, unknown[][]>;
        // Queue of values to return from `insert().…returning()` per table.
        insertReturning: Map<string, unknown[][]>;
    }
    const dbState: DbState = {
        selectByTable: new Map(),
        insertCalls: [],
        updateCalls: [],
        deleteCalls: [],
        updateReturning: new Map(),
        deleteReturning: new Map(),
        insertReturning: new Map(),
    };
    function shiftQueue(map: Map<string, unknown[][]>, table: string) {
        const queue = map.get(table) ?? [];
        const next = queue.shift() ?? [];
        map.set(table, queue);
        return next;
    }
    function selectFromTable(table: string) {
        return shiftQueue(dbState.selectByTable, table);
    }
    function queueSelectResult(table: string, rows: unknown[]) {
        const existing = dbState.selectByTable.get(table) ?? [];
        existing.push(rows);
        dbState.selectByTable.set(table, existing);
    }

    // Sentinel objects standing in for the schema exports.
    const newsletterCampaigns = { __table: "newsletterCampaigns" } as const;
    const customers = { __table: "customers" } as const;
    const notificationLogs = { __table: "notificationLogs" } as const;

    function tableTag(table: object): string {
        return (table as { __table?: string }).__table ?? "unknown";
    }

    function makeSelectChain(table: string) {
        const result = () => selectFromTable(table);
        const obj = {
            where: () => obj,
            limit: () => obj,
            offset: () => obj,
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

    function makeUpdateChain(table: string) {
        let setValue: Record<string, unknown> = {};
        const obj = {
            set(v: Record<string, unknown>) {
                setValue = v;
                return obj;
            },
            where() {
                return obj;
            },
            returning(): Promise<unknown[]> {
                dbState.updateCalls.push({ table, set: setValue });
                return Promise.resolve(shiftQueue(dbState.updateReturning, table));
            },
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                dbState.updateCalls.push({ table, set: setValue });
                return Promise.resolve(undefined).then(resolve, reject);
            },
        };
        return obj;
    }

    function makeInsertChain(table: string) {
        const obj = {
            values(v: Record<string, unknown>) {
                dbState.insertCalls.push({ table, values: v });
                return {
                    returning(): Promise<unknown[]> {
                        return Promise.resolve(shiftQueue(dbState.insertReturning, table));
                    },
                    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                        return Promise.resolve(undefined).then(resolve, reject);
                    },
                };
            },
        };
        return obj;
    }

    function makeDeleteChain(table: string) {
        const obj = {
            where() {
                return obj;
            },
            returning(): Promise<unknown[]> {
                dbState.deleteCalls.push({ table });
                return Promise.resolve(shiftQueue(dbState.deleteReturning, table));
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (table: object) => makeSelectChain(tableTag(table)),
            }),
            insert: (table: object) => makeInsertChain(tableTag(table)),
            update: (table: object) => makeUpdateChain(tableTag(table)),
            delete: (table: object) => makeDeleteChain(tableTag(table)),
        },
        newsletterCampaigns,
        customers,
        notificationLogs,
    };

    return {
        enqueueNewsletterCampaignJobMock: vi.fn(async () => undefined),
        sendNewsletterCampaignEmailMock: vi.fn(
            async (): Promise<{
                sent: boolean;
                messageId?: string;
                skipped?: "already_sent";
                failed?: string;
            }> => ({ sent: true, messageId: "msg_test" })
        ),
        selectMarketingAudienceMock: vi.fn(
            async (): Promise<Array<{ id: string; email: string }>> => []
        ),
        getNewsletterSettingsMock: vi.fn(
            async (): Promise<{
                fromAddress: string | null;
                replyTo: string | null;
                chunkSize: number;
                chunkDelayMs: number;
                stuckAfterMs: number;
            }> => ({
                fromAddress: "studio@piercerkzn.ru",
                replyTo: null,
                chunkSize: 50,
                chunkDelayMs: 200,
                stuckAfterMs: 30 * 60_000,
            })
        ),
        captureMock: vi.fn(),
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
        enqueueNewsletterCampaignJob: enqueueNewsletterCampaignJobMock,
    };
});

vi.mock("@/emails/dispatch", () => ({
    sendNewsletterCampaignEmail: sendNewsletterCampaignEmailMock,
}));

vi.mock("@/lib/newsletters/audience", () => ({
    selectMarketingAudience: selectMarketingAudienceMock,
}));

vi.mock("@/lib/settings", () => ({
    getNewsletterSettings: getNewsletterSettingsMock,
}));

vi.mock("@/lib/posthog", () => ({
    capture: captureMock,
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        del: vi.fn(async () => 1),
        zrem: vi.fn(async () => 1),
    },
}));

vi.mock("drizzle-orm", () => ({
    eq: () => null,
    and: () => null,
    asc: () => null,
    desc: () => null,
    inArray: () => null,
    lt: () => null,
    lte: () => null,
    sql: ((...a: unknown[]) => {
        // Tag the result so downstream `set()` payloads look like Drizzle
        // SQL fragments rather than primitive numbers.
        const _strings = a;
        return { __sql: true, _strings };
    }) as unknown as { (...a: unknown[]): unknown },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
    InvalidTransitionError,
    cancelCampaign,
    chunk,
    createCampaign,
    deleteCampaign,
    fanoutNewsletter,
    getCampaign,
    processRecipientJob,
    runCampaign,
    scheduleCampaign,
    updateCampaign,
} from "./dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function queueUpdateReturning(table: string, rows: unknown[]) {
    const existing = dbState.updateReturning.get(table) ?? [];
    existing.push(rows);
    dbState.updateReturning.set(table, existing);
}
function queueInsertReturning(table: string, rows: unknown[]) {
    const existing = dbState.insertReturning.get(table) ?? [];
    existing.push(rows);
    dbState.insertReturning.set(table, existing);
}
function queueDeleteReturning(table: string, rows: unknown[]) {
    const existing = dbState.deleteReturning.get(table) ?? [];
    existing.push(rows);
    dbState.deleteReturning.set(table, existing);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
    enqueueNewsletterCampaignJobMock.mockReset().mockResolvedValue(undefined);
    sendNewsletterCampaignEmailMock.mockReset().mockResolvedValue({
        sent: true,
        messageId: "msg_test",
    });
    selectMarketingAudienceMock.mockReset().mockResolvedValue([]);
    getNewsletterSettingsMock.mockReset().mockResolvedValue({
        fromAddress: "studio@piercerkzn.ru",
        replyTo: null,
        chunkSize: 50,
        chunkDelayMs: 200,
        stuckAfterMs: 30 * 60_000,
    });
    captureMock.mockReset();
    dbState.selectByTable.clear();
    dbState.insertCalls.length = 0;
    dbState.updateCalls.length = 0;
    dbState.deleteCalls.length = 0;
    dbState.updateReturning.clear();
    dbState.deleteReturning.clear();
    dbState.insertReturning.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

// ===========================================================================
// chunk — tiny pure utility
// ===========================================================================
describe("chunk()", () => {
    it("splits into fixed-size chunks", () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
    it("returns single chunk when size >= length", () => {
        expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    });
    it("returns empty array on empty input", () => {
        expect(chunk([], 5)).toEqual([]);
    });
    it("falls back to single chunk on size <= 0", () => {
        expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
    });
});

// ===========================================================================
// createCampaign — defaults
// ===========================================================================
describe("createCampaign — defaults", () => {
    it("inserts with state=draft and zero counters", async () => {
        const id = "campaign-001";
        queueInsertReturning("newsletterCampaigns", [
            {
                id,
                subject: "Hello",
                preheader: null,
                bodyMarkdown: "Body",
                state: "draft",
                recipientCount: 0,
                sentCount: 0,
                failedCount: 0,
            },
        ]);

        const row = await createCampaign({
            subject: "Hello",
            bodyMarkdown: "Body",
        });
        expect(row).toMatchObject({
            id,
            state: "draft",
            recipientCount: 0,
            sentCount: 0,
            failedCount: 0,
        });
        expect(dbState.insertCalls).toHaveLength(1);
        expect(dbState.insertCalls[0].table).toBe("newsletterCampaigns");
        expect(dbState.insertCalls[0].values).toMatchObject({
            subject: "Hello",
            preheader: null,
            bodyMarkdown: "Body",
            state: "draft",
            recipientCount: 0,
            sentCount: 0,
            failedCount: 0,
            createdByUserId: null,
        });
    });

    it("threads `createdByUserId` and `preheader` through", async () => {
        queueInsertReturning("newsletterCampaigns", [{ id: "c2" }]);
        await createCampaign({
            subject: "Hi",
            preheader: "Tease me",
            bodyMarkdown: "Body",
            createdByUserId: "admin-uuid",
        });
        expect(dbState.insertCalls[0].values).toMatchObject({
            preheader: "Tease me",
            createdByUserId: "admin-uuid",
        });
    });
});

// ===========================================================================
// updateCampaign — invalid transition
// ===========================================================================
describe("updateCampaign — Property: invalid transition", () => {
    it("throws InvalidTransitionError when current state ≠ draft", async () => {
        // Step 1: getCampaign loads the row → state='scheduled'
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "scheduled" }]);

        await expect(updateCampaign("c1", { subject: "new subject" })).rejects.toMatchObject({
            name: "InvalidTransitionError",
            from: "scheduled",
            action: "patch",
        });
    });

    it("throws InvalidTransitionError when row is missing", async () => {
        queueSelectResult("newsletterCampaigns", []);
        await expect(updateCampaign("missing", { subject: "x" })).rejects.toBeInstanceOf(
            InvalidTransitionError
        );
    });

    it("throws InvalidTransitionError when CAS loses the race", async () => {
        // First select → in-process state is `draft`
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "draft" }]);
        // CAS UPDATE returns no row (race lost)
        queueUpdateReturning("newsletterCampaigns", []);
        // Re-load after the failed CAS shows the new state.
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "scheduled" }]);

        await expect(updateCampaign("c1", { subject: "x" })).rejects.toMatchObject({
            from: "scheduled",
            action: "patch",
        });
    });

    it("returns the updated row on the happy path", async () => {
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "draft" }]);
        const updated = {
            id: "c1",
            state: "draft",
            subject: "new",
        };
        queueUpdateReturning("newsletterCampaigns", [updated]);

        const result = await updateCampaign("c1", { subject: "new" });
        expect(result).toEqual(updated);
        expect(dbState.updateCalls.at(-1)?.set).toMatchObject({
            subject: "new",
        });
    });
});

// ===========================================================================
// scheduleCampaign — fromAddress gate
// ===========================================================================
describe("scheduleCampaign — settings gate", () => {
    it("throws when fromAddress is unset", async () => {
        getNewsletterSettingsMock.mockResolvedValue({
            fromAddress: null,
            replyTo: null,
            chunkSize: 50,
            chunkDelayMs: 200,
            stuckAfterMs: 30 * 60_000,
        });
        await expect(scheduleCampaign("c1", new Date("2099-01-01"))).rejects.toThrow(
            /from_address_unset/
        );
    });

    it("CAS into scheduled when fromAddress is set", async () => {
        queueUpdateReturning("newsletterCampaigns", [{ id: "c1", state: "scheduled" }]);
        const result = await scheduleCampaign("c1", new Date("2099-01-01T00:00:00Z"));
        expect(result.state).toBe("scheduled");
        expect(dbState.updateCalls.at(-1)?.set).toMatchObject({
            state: "scheduled",
        });
    });
});

// ===========================================================================
// runCampaign / fanoutNewsletter — Property 7: empty audience
// ===========================================================================
describe("runCampaign — Property 7: empty audience short-circuit", () => {
    it("CAS into sent with all counters zero and completedAt set; no jobs enqueued", async () => {
        // CAS into 'sending'
        queueUpdateReturning("newsletterCampaigns", [{ id: "c1", state: "sending" }]);
        // fanoutNewsletter — empty audience → CAS to sent
        selectMarketingAudienceMock.mockResolvedValue([]);
        // The CAS to 'sent' update returning is consumed but not asserted.
        queueUpdateReturning("newsletterCampaigns", [{ id: "c1", state: "sent" }]);

        const now = new Date("2026-05-14T12:00:00Z");
        await runCampaign("c1", { now, allowedFromStates: ["draft"] });

        expect(enqueueNewsletterCampaignJobMock).not.toHaveBeenCalled();

        // The terminating UPDATE must carry { state: 'sent', completedAt,
        // recipientCount=0, sentCount=0, failedCount=0 }.
        const finalUpdate = dbState.updateCalls.find((c) => c.set?.state === "sent");
        expect(finalUpdate).toBeDefined();
        expect(finalUpdate?.set).toMatchObject({
            state: "sent",
            recipientCount: 0,
            sentCount: 0,
            failedCount: 0,
            completedAt: now,
        });

        // Telemetry — empty_audience flag set on the completion event.
        const completion = captureMock.mock.calls.find(
            (c) => (c[0] as { event: string }).event === "newsletter_campaign_completed"
        );
        expect(completion).toBeDefined();
        expect(
            (completion?.[0] as { properties: { empty_audience: boolean } }).properties
                .empty_audience
        ).toBe(true);
    });
});

// ===========================================================================
// fanoutNewsletter — Property 6: chunking arithmetic
// ===========================================================================
describe("fanoutNewsletter — Property 6: chunking arithmetic", () => {
    // Parametrize over (audience.length, chunkSize) tuples. For every tuple
    // we should see ceil(N/c) chunks of size ≤ c, with delay = chunkIndex * d.
    const cases: Array<[number, number]> = [
        [1, 50],
        [50, 50],
        [51, 50],
        [100, 50],
        [101, 50],
        [10, 3],
        [25, 7],
        [3, 10],
    ];
    it.each(cases)(
        "audience=%i, chunkSize=%i → ceil(N/c) chunks each ≤ c with chunkIndex*delayMs delay",
        async (n, c) => {
            const audience = Array.from({ length: n }, (_, i) => ({
                id: `cust-${String(i).padStart(4, "0")}`,
                email: `c${i}@example.com`,
            }));
            selectMarketingAudienceMock.mockResolvedValue(audience);
            const delayMs = 200;
            getNewsletterSettingsMock.mockResolvedValue({
                fromAddress: "from@example.com",
                replyTo: null,
                chunkSize: c,
                chunkDelayMs: delayMs,
                stuckAfterMs: 30 * 60_000,
            });
            // recipientCount UPDATE — consume one returning slot.
            queueUpdateReturning("newsletterCampaigns", []);

            await fanoutNewsletter("c1", new Date("2026-05-14T12:00:00Z"));

            const expectedChunks = Math.ceil(n / c);
            expect(enqueueNewsletterCampaignJobMock).toHaveBeenCalledTimes(n);

            // Group the enqueue calls by their delay — each delay bucket
            // corresponds to one chunk.
            const byDelay = new Map<number, number>();
            for (const call of enqueueNewsletterCampaignJobMock.mock.calls) {
                const [, delay] = call as unknown as [unknown, number];
                byDelay.set(delay, (byDelay.get(delay) ?? 0) + 1);
            }
            expect(byDelay.size).toBe(expectedChunks);
            // Every bucket has size ≤ c.
            for (const count of byDelay.values()) {
                expect(count).toBeLessThanOrEqual(c);
            }
            // Every chunkIndex has delay = i * delayMs.
            for (let i = 0; i < expectedChunks; i++) {
                expect(byDelay.has(i * delayMs)).toBe(true);
            }

            // Recipient count was persisted before enqueue.
            const recipientCountUpdate = dbState.updateCalls.find(
                (u) => u.set?.recipientCount === n
            );
            expect(recipientCountUpdate).toBeDefined();
        }
    );

    it("each enqueue carries { campaignId, customerId } and a non-negative delay", async () => {
        const audience = Array.from({ length: 5 }, (_, i) => ({
            id: `cust-${i}`,
            email: `c${i}@example.com`,
        }));
        selectMarketingAudienceMock.mockResolvedValue(audience);
        getNewsletterSettingsMock.mockResolvedValue({
            fromAddress: "f@example.com",
            replyTo: null,
            chunkSize: 2,
            chunkDelayMs: 100,
            stuckAfterMs: 30 * 60_000,
        });
        queueUpdateReturning("newsletterCampaigns", []);

        await fanoutNewsletter("c1", new Date());

        for (const call of enqueueNewsletterCampaignJobMock.mock.calls) {
            const [job, delay] = call as unknown as [
                { campaignId: string; customerId: string },
                number,
            ];
            expect(job.campaignId).toBe("c1");
            expect(typeof job.customerId).toBe("string");
            expect(job.customerId).toMatch(/^cust-/);
            expect(delay).toBeGreaterThanOrEqual(0);
        }
    });

    it("property: total enqueues equals audience length (random N, c)", () => {
        // Hand-roll the property because the chunking function is sync but
        // fanout is async; we cap N to keep runtime bounded.
        return fcAssert(
            fc.asyncProperty(
                fc.integer({ min: 0, max: 30 }),
                fc.integer({ min: 1, max: 10 }),
                async (n, c) => {
                    enqueueNewsletterCampaignJobMock.mockClear();
                    const audience = Array.from({ length: n }, (_, i) => ({
                        id: `cust-${i}`,
                        email: `c${i}@example.com`,
                    }));
                    selectMarketingAudienceMock.mockResolvedValue(audience);
                    getNewsletterSettingsMock.mockResolvedValue({
                        fromAddress: "f@example.com",
                        replyTo: null,
                        chunkSize: c,
                        chunkDelayMs: 50,
                        stuckAfterMs: 30 * 60_000,
                    });
                    queueUpdateReturning("newsletterCampaigns", []);
                    if (n === 0) {
                        // Empty-audience branch issues two updates (CAS to
                        // sent + recipientCount). Pre-queue the second one.
                        queueUpdateReturning("newsletterCampaigns", []);
                    }

                    await fanoutNewsletter("c1", new Date());
                    expect(enqueueNewsletterCampaignJobMock.mock.calls.length).toBe(n);
                }
            ),
            { numRuns: 30, seed: 2026_05_06 }
        );
    });
});

// ===========================================================================
// processRecipientJob — Property 5: idempotency & gating
// ===========================================================================
describe("processRecipientJob — Property 5: gates and idempotency", () => {
    function queueLoadCampaign(state: string) {
        queueSelectResult("newsletterCampaigns", [
            {
                id: "c1",
                state,
                subject: "S",
                preheader: null,
                bodyMarkdown: "Body",
                recipientCount: 1,
                sentCount: 0,
                failedCount: 0,
            },
        ]);
    }
    function queueLoadCustomer(
        overrides: Partial<{
            id: string;
            email: string | null;
            firstName: string | null;
            deletedAt: Date | null;
            notificationMarketing: boolean;
        }> = {}
    ) {
        queueSelectResult("customers", [
            {
                id: "u1",
                email: "alice@example.com",
                firstName: "Alice",
                deletedAt: null,
                notificationMarketing: true,
                ...overrides,
            },
        ]);
    }

    it("short-circuits with 'campaign_missing' when getCampaign returns null", async () => {
        queueSelectResult("newsletterCampaigns", []);
        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "campaign_missing" });
        expect(sendNewsletterCampaignEmailMock).not.toHaveBeenCalled();
    });

    it("short-circuits with 'campaign_state' when state ≠ sending", async () => {
        queueLoadCampaign("scheduled");
        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "campaign_state" });
        expect(sendNewsletterCampaignEmailMock).not.toHaveBeenCalled();
    });

    it("short-circuits with 'customer_missing' when customer row absent", async () => {
        queueLoadCampaign("sending");
        queueSelectResult("customers", []);
        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "customer_missing" });
    });

    it("short-circuits with 'customer_deleted' on soft-deleted customer", async () => {
        queueLoadCampaign("sending");
        queueLoadCustomer({ deletedAt: new Date("2026-01-01") });
        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "customer_deleted" });
        expect(sendNewsletterCampaignEmailMock).not.toHaveBeenCalled();
    });

    it("short-circuits with 'customer_opted_out' when notificationMarketing is false", async () => {
        queueLoadCampaign("sending");
        queueLoadCustomer({ notificationMarketing: false });
        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "customer_opted_out" });
        expect(sendNewsletterCampaignEmailMock).not.toHaveBeenCalled();
    });

    it("short-circuits with 'customer_no_email' when email is null", async () => {
        queueLoadCampaign("sending");
        queueLoadCustomer({ email: null });
        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "customer_no_email" });
        expect(sendNewsletterCampaignEmailMock).not.toHaveBeenCalled();
    });

    it("returns 'already_sent' when the dispatcher signals a duplicate notification_log row (PG 23505)", async () => {
        queueLoadCampaign("sending");
        queueLoadCustomer();
        // The dispatcher catches the unique violation and returns this shape.
        sendNewsletterCampaignEmailMock.mockResolvedValueOnce({
            sent: false,
            skipped: "already_sent",
        });

        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "skipped", reason: "already_sent" });
        // No counter UPDATE is issued — the prior worker already accounted
        // for this recipient.
        expect(dbState.updateCalls).toHaveLength(0);
    });

    it("happy path increments sentCount and runs the completion check", async () => {
        queueLoadCampaign("sending");
        queueLoadCustomer();
        sendNewsletterCampaignEmailMock.mockResolvedValueOnce({
            sent: true,
            messageId: "msg_42",
        });
        // sentCount UPDATE
        queueUpdateReturning("newsletterCampaigns", []);
        // maybeFinaliseCampaign UPDATE — return [] (no flip yet).
        queueUpdateReturning("newsletterCampaigns", []);

        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "sent", messageId: "msg_42" });

        // First UPDATE bumps sentCount, second UPDATE is the completion CAS.
        expect(dbState.updateCalls).toHaveLength(2);
        const sentEvent = captureMock.mock.calls.find(
            (c) => (c[0] as { event: string }).event === "newsletter_campaign_sent"
        );
        expect(sentEvent).toBeDefined();
    });

    it("dispatch failure increments failedCount and runs the completion check", async () => {
        queueLoadCampaign("sending");
        queueLoadCustomer();
        sendNewsletterCampaignEmailMock.mockResolvedValueOnce({
            sent: false,
            failed: "smtp blew up",
        });
        // failedCount UPDATE
        queueUpdateReturning("newsletterCampaigns", []);
        // maybeFinaliseCampaign UPDATE
        queueUpdateReturning("newsletterCampaigns", []);

        const r = await processRecipientJob({ campaignId: "c1", customerId: "u1" });
        expect(r).toEqual({ status: "failed", error: "smtp blew up" });
        expect(dbState.updateCalls).toHaveLength(2);
    });
});

// ===========================================================================
// cancelCampaign / deleteCampaign — InvalidTransitionError shape
// ===========================================================================
describe("cancelCampaign / deleteCampaign — invalid transition", () => {
    it("cancelCampaign throws InvalidTransitionError when state ∉ {draft, scheduled, sending}", async () => {
        queueUpdateReturning("newsletterCampaigns", []); // CAS lost
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "sent" }]);
        await expect(cancelCampaign("c1")).rejects.toMatchObject({
            from: "sent",
            action: "cancel",
        });
    });

    it("deleteCampaign throws InvalidTransitionError when state ∉ {draft, cancelled}", async () => {
        queueDeleteReturning("newsletterCampaigns", []); // nothing deleted
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "sending" }]);
        await expect(deleteCampaign("c1")).rejects.toMatchObject({
            from: "sending",
            action: "delete",
        });
    });

    it("deleteCampaign succeeds when CAS returns a row", async () => {
        queueDeleteReturning("newsletterCampaigns", [{ id: "c1" }]);
        await expect(deleteCampaign("c1")).resolves.toBeUndefined();
    });
});

// ===========================================================================
// getCampaign — returns null on miss
// ===========================================================================
describe("getCampaign", () => {
    it("returns null when the row is missing", async () => {
        queueSelectResult("newsletterCampaigns", []);
        expect(await getCampaign("missing")).toBeNull();
    });

    it("returns the row when present", async () => {
        queueSelectResult("newsletterCampaigns", [{ id: "c1", state: "draft" }]);
        expect(await getCampaign("c1")).toEqual({ id: "c1", state: "draft" });
    });
});
