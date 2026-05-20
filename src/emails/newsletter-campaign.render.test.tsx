/**
 * Render-level integration test for `sendNewsletterCampaignEmail`.
 *
 * Validates: Requirements 8.1, 9.1, 9.2, 10.1, 10.2, 10.3, 11.7, 12.6
 *
 * The dispatcher orchestrates the INSERT-claim → render → Resend → audit
 * UPDATE pipeline. We mock the DB at the `@/db` boundary and the Resend
 * client at `@/lib/resend.sendEmail`, then assert:
 *
 *   - `sendEmail` is called with the rendered HTML containing the Russian
 *     static-copy markers and the unsubscribe URL.
 *   - The `headers["List-Unsubscribe"]`, `["List-Unsubscribe-Post"]`, and
 *     `["Content-Language"]` are wired through per RFC 8058 + Requirement
 *     10.2.
 *   - `from` is taken from `settings.fromAddress`; `replyTo` falls back to
 *     `settings.fromAddress` when `settings.replyTo` is null.
 *   - The unsubscribe token round-trips back to the recipient's customer id.
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 15: Outbound headers + From/Reply-To wiring
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "test-secret-render";
process.env.NEXT_PUBLIC_SITE_URL = "https://piercerkzn.ru";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { sendEmailMock, getNewsletterSettingsMock, dbState, dbModule } = vi.hoisted(() => {
    interface DbState {
        insertCalls: Array<{ table: string; values: Record<string, unknown> }>;
        updateCalls: Array<{ table: string; set: Record<string, unknown> }>;
        // Behaviour switches read by the per-test setup:
        nextInsertThrow: unknown | null;
        nextInsertReturning: unknown[];
    }
    const dbState: DbState = {
        insertCalls: [],
        updateCalls: [],
        nextInsertThrow: null,
        nextInsertReturning: [{ id: "log-row-id" }],
    };

    const newsletterCampaigns = { __table: "newsletterCampaigns" } as const;
    const customers = { __table: "customers" } as const;
    const notificationLogs = { __table: "notificationLogs" } as const;

    function tableTag(table: object): string {
        return (table as { __table?: string }).__table ?? "unknown";
    }

    const dbModule = {
        db: {
            insert(table: object) {
                const tag = tableTag(table);
                return {
                    values(v: Record<string, unknown>) {
                        dbState.insertCalls.push({ table: tag, values: v });
                        if (dbState.nextInsertThrow) {
                            const err = dbState.nextInsertThrow;
                            dbState.nextInsertThrow = null;
                            return {
                                returning() {
                                    return Promise.reject(err);
                                },
                            };
                        }
                        return {
                            returning() {
                                return Promise.resolve(dbState.nextInsertReturning);
                            },
                        };
                    },
                };
            },
            update(table: object) {
                const tag = tableTag(table);
                let setValue: Record<string, unknown> = {};
                const obj = {
                    set(v: Record<string, unknown>) {
                        setValue = v;
                        return obj;
                    },
                    where() {
                        dbState.updateCalls.push({ table: tag, set: setValue });
                        return Promise.resolve();
                    },
                };
                return obj;
            },
        },
        newsletterCampaigns,
        customers,
        notificationLogs,
    };

    return {
        sendEmailMock: vi.fn(
            async (_params: {
                to: string;
                subject: string;
                html?: string;
                text?: string;
                from?: string;
                replyTo?: string;
                headers?: Record<string, string>;
            }): Promise<string> => "msg_resend_001"
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
        dbState,
        dbModule,
    };
});

vi.mock("@/db", () => dbModule);

vi.mock("@/lib/resend", () => ({
    sendEmail: sendEmailMock,
    DEFAULT_FROM: "PiercerKZN <noreply@piercerkzn.ru>",
}));

vi.mock("@/lib/api", () => ({
    pgErrorCode: (err: unknown) => (err as { code?: string } | null)?.code ?? undefined,
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        del: vi.fn(async () => 1),
        zrem: vi.fn(async () => 1),
    },
}));

vi.mock("@/lib/settings", async () => {
    const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
    return {
        ...actual,
        getNewsletterSettings: getNewsletterSettingsMock,
    };
});

vi.mock("drizzle-orm", () => ({
    eq: () => null,
    sql: ((...a: unknown[]) => ({ __sql: true, parts: a })) as unknown as {
        (...a: unknown[]): unknown;
    },
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { sendNewsletterCampaignEmail } from "./dispatch";
import { verifyUnsubscribeToken } from "@/lib/newsletters/unsubscribe-token";

beforeEach(() => {
    sendEmailMock.mockReset().mockResolvedValue("msg_resend_001");
    getNewsletterSettingsMock.mockReset().mockResolvedValue({
        fromAddress: "studio@piercerkzn.ru",
        replyTo: null,
        chunkSize: 50,
        chunkDelayMs: 200,
        stuckAfterMs: 30 * 60_000,
    });
    dbState.insertCalls.length = 0;
    dbState.updateCalls.length = 0;
    dbState.nextInsertThrow = null;
    dbState.nextInsertReturning = [{ id: "log-row-id" }];
});

afterEach(() => {
    vi.clearAllMocks();
});

const FIXTURE = {
    to: "alina@example.com",
    customerId: "11111111-2222-3333-4444-555555555555",
    campaignId: "campaign-001",
    customerFirstName: "Алина",
    subject: "Майская акция — скидка 15%",
    preheader: "Только до конца мая",
    bodyMarkdown: "# Привет!\n\nТекст рассылки.",
};

// ===========================================================================
// Property 15 — End-to-end render + headers + From/Reply-To
// ===========================================================================
describe("sendNewsletterCampaignEmail — Property 15", () => {
    it("calls sendEmail with HTML containing Russian static markers", async () => {
        const result = await sendNewsletterCampaignEmail(FIXTURE);
        expect(result).toEqual({ sent: true, messageId: "msg_resend_001" });

        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        const call = sendEmailMock.mock.calls[0][0] as {
            html: string;
            text: string;
        };
        expect(call.html).toContain("Здравствуйте, Алина!");
        expect(call.html).toContain("PiercerKZN");
        expect(call.html).toContain("Отписаться от рассылки");
        expect(call.text).toContain("Здравствуйте, Алина");
    });

    it("falls back to «Здравствуйте!» when first name is absent", async () => {
        await sendNewsletterCampaignEmail({
            ...FIXTURE,
            customerFirstName: undefined,
        });
        const call = sendEmailMock.mock.calls[0][0] as { html: string };
        expect(call.html).toContain("Здравствуйте!");
        expect(call.html).not.toContain("Здравствуйте, ");
    });

    it("renders an unsubscribe URL whose token verifies back to the customerId", async () => {
        await sendNewsletterCampaignEmail(FIXTURE);
        const call = sendEmailMock.mock.calls[0][0] as {
            html: string;
            text: string;
            headers?: Record<string, string>;
        };
        // The URL appears in the body markup …
        const urlMatch = call.html.match(
            /https:\/\/piercerkzn\.ru\/api\/unsubscribe\?token=([A-Za-z0-9_\-.]+)/
        );
        expect(urlMatch).not.toBeNull();
        const token = urlMatch![1];
        expect(verifyUnsubscribeToken(token)).toBe(FIXTURE.customerId);

        // … and in the List-Unsubscribe header.
        expect(call.headers?.["List-Unsubscribe"]).toBe(
            `<https://piercerkzn.ru/api/unsubscribe?token=${token}>`
        );
        // … and in the plaintext alternative.
        expect(call.text).toContain(`?token=${token}`);
    });

    it("emits the RFC 8058 List-Unsubscribe-Post + Content-Language headers", async () => {
        await sendNewsletterCampaignEmail(FIXTURE);
        const call = sendEmailMock.mock.calls[0][0] as {
            headers?: Record<string, string>;
        };
        expect(call.headers).toMatchObject({
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "Content-Language": "ru",
        });
    });

    it("uses settings.fromAddress for `from` and falls back to it for `replyTo` when settings.replyTo is null", async () => {
        await sendNewsletterCampaignEmail(FIXTURE);
        const call = sendEmailMock.mock.calls[0][0] as {
            from: string;
            replyTo: string;
        };
        expect(call.from).toBe("studio@piercerkzn.ru");
        expect(call.replyTo).toBe("studio@piercerkzn.ru");
    });

    it("uses settings.replyTo when set, distinct from settings.fromAddress", async () => {
        getNewsletterSettingsMock.mockResolvedValue({
            fromAddress: "studio@piercerkzn.ru",
            replyTo: "support@piercerkzn.ru",
            chunkSize: 50,
            chunkDelayMs: 200,
            stuckAfterMs: 30 * 60_000,
        });
        await sendNewsletterCampaignEmail(FIXTURE);
        const call = sendEmailMock.mock.calls[0][0] as {
            from: string;
            replyTo: string;
        };
        expect(call.from).toBe("studio@piercerkzn.ru");
        expect(call.replyTo).toBe("support@piercerkzn.ru");
    });

    it("inserts a notification_log claim row before sending and updates it to 'sent' after Resend returns", async () => {
        await sendNewsletterCampaignEmail(FIXTURE);

        // INSERT — claim row with status='pending' and the campaignId/customerId
        // metadata that the partial unique index uses for dedupe.
        expect(dbState.insertCalls).toHaveLength(1);
        expect(dbState.insertCalls[0].table).toBe("notificationLogs");
        expect(dbState.insertCalls[0].values).toMatchObject({
            channel: "email",
            type: "newsletter_campaign",
            recipient: FIXTURE.to,
            status: "pending",
            metadata: {
                campaignId: FIXTURE.campaignId,
                customerId: FIXTURE.customerId,
            },
        });

        // UPDATE — flip to 'sent' with providerId.
        expect(dbState.updateCalls).toHaveLength(1);
        expect(dbState.updateCalls[0].set).toMatchObject({
            status: "sent",
            providerId: "msg_resend_001",
        });
        expect(dbState.updateCalls[0].set.sentAt).toBeInstanceOf(Date);
    });

    it("returns { sent: false, skipped: 'already_sent' } when the claim INSERT raises PG 23505", async () => {
        // Synthesize a Postgres unique-violation error shape.
        dbState.nextInsertThrow = Object.assign(new Error("duplicate key"), {
            code: "23505",
        });

        const result = await sendNewsletterCampaignEmail(FIXTURE);
        expect(result).toEqual({ sent: false, skipped: "already_sent" });
        // Resend was not called — the claim is the gate.
        expect(sendEmailMock).not.toHaveBeenCalled();
        // No status='sent' UPDATE was issued.
        expect(dbState.updateCalls).toHaveLength(0);
    });

    it("marks the claim row 'failed' when sendEmail throws and surfaces the error message", async () => {
        sendEmailMock.mockRejectedValueOnce(new Error("Resend exploded"));
        const result = await sendNewsletterCampaignEmail(FIXTURE);
        expect(result).toEqual({ sent: false, failed: "Resend exploded" });

        // INSERT happened, then UPDATE to status='failed' (best effort).
        expect(dbState.insertCalls).toHaveLength(1);
        expect(dbState.updateCalls).toHaveLength(1);
        expect(dbState.updateCalls[0].set).toMatchObject({
            status: "failed",
        });
    });

    it("throws when fromAddress is not configured (defensive guardrail)", async () => {
        getNewsletterSettingsMock.mockResolvedValue({
            fromAddress: null,
            replyTo: null,
            chunkSize: 50,
            chunkDelayMs: 200,
            stuckAfterMs: 30 * 60_000,
        });
        await expect(sendNewsletterCampaignEmail(FIXTURE)).rejects.toThrow(/from_address/i);
        expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("uses the campaign subject as the Resend `subject:` header", async () => {
        await sendNewsletterCampaignEmail(FIXTURE);
        const call = sendEmailMock.mock.calls[0][0] as { subject: string };
        expect(call.subject).toBe(FIXTURE.subject);
    });

    it("addresses the email to the supplied recipient", async () => {
        await sendNewsletterCampaignEmail(FIXTURE);
        const call = sendEmailMock.mock.calls[0][0] as { to: string };
        expect(call.to).toBe(FIXTURE.to);
    });
});
