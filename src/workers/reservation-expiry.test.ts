/**
 * Unit tests for the reservation-expiry sweep worker
 * (`sweepExpiredReservations` in `src/workers/reservation-expiry.ts`).
 *
 * Validates: Requirements 2.11
 *
 * This is a `*.test.ts` (NOT `*.integration.test.ts`) so it runs in the unit
 * suite (`pnpm test:unit`) with `@/db` and `@/lib/reservations` mocked. The
 * goal is to assert the *failure-isolation* property of the sweep loop: a
 * thrown error inside `expireReservation` for one candidate must not abort
 * the loop or starve subsequent candidates.
 *
 * Three sub-cases (per task 2.8):
 *   1. All candidates succeed → expired === candidates.length, errors === 0.
 *   2. One candidate throws → expired === N − 1, errors === 1, loop continues.
 *   3. Zero candidates → { candidates: 0, expired: 0, errors: 0 }, no capture().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { expireReservationMock, captureMock, candidatesQueue, pushCandidates, dbModule } =
    vi.hoisted(() => {
        /**
         * Per-test queue of "next call to db.select(...).from(...).where(...) resolves
         * to this array". The SUT only issues a single select per invocation, but we
         * expose a queue so a test could conceivably push more shape if extended.
         */
        const candidatesQueue: Array<Array<{ id: string; ref: string }>> = [];
        function pushCandidates(rows: Array<{ id: string; ref: string }>): void {
            candidatesQueue.push(rows);
        }
        function nextCandidates(): Array<{ id: string; ref: string }> {
            return candidatesQueue.shift() ?? [];
        }

        /**
         * Drizzle's query builder is a thenable: `db.select().from().where()` can
         * be `await`-ed directly. The SUT awaits the result, so the mock's
         * terminal node implements `.then`.
         */
        function makeChain() {
            const result = () => nextCandidates();
            const obj = {
                from: () => obj,
                where: () => obj,
                then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                    return Promise.resolve(result()).then(resolve, reject);
                },
                catch(reject: (e: unknown) => unknown) {
                    return Promise.resolve(result()).catch(reject);
                },
            };
            return obj;
        }

        const reservations = { __table: "reservations" } as const;

        const dbModule = {
            db: {
                select: () => makeChain(),
            },
            reservations,
        };

        return {
            expireReservationMock: vi.fn(),
            captureMock: vi.fn(),
            candidatesQueue,
            pushCandidates,
            dbModule,
        };
    });

vi.mock("@/db", () => dbModule);

vi.mock("@/lib/reservations", () => ({
    expireReservation: expireReservationMock,
}));

vi.mock("@/lib/posthog", () => ({
    capture: captureMock,
}));

// `drizzle-orm` helpers are called inside the SUT to build the WHERE clause;
// the values are passed to our mocked `where()` and ignored, so stub them
// as no-ops. Keep the named exports the SUT imports (`and`, `eq`, `lte`).
vi.mock("drizzle-orm", () => ({
    and: (..._a: unknown[]) => null,
    eq: (..._a: unknown[]) => null,
    lte: (..._a: unknown[]) => null,
}));

// ---------------------------------------------------------------------------
// Module under test (imported AFTER vi.mock calls so mocks are applied)
// ---------------------------------------------------------------------------
import { sweepExpiredReservations } from "./reservation-expiry";

beforeEach(() => {
    expireReservationMock.mockReset();
    captureMock.mockReset();
    candidatesQueue.length = 0;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("sweepExpiredReservations — Property: failure isolation (AC 2.11)", () => {
    it("all candidates succeed → expired === candidates.length, errors === 0", async () => {
        const candidates = [
            { id: "res-1", ref: "PK-RES-2026-0001" },
            { id: "res-2", ref: "PK-RES-2026-0002" },
            { id: "res-3", ref: "PK-RES-2026-0003" },
        ];
        pushCandidates(candidates);

        // Every expireReservation call returns a row whose status flipped to
        // "expired" — this is the happy path the SUT counts as a success.
        expireReservationMock.mockImplementation(async (id: string) => ({
            id,
            status: "expired",
            referenceNumber: candidates.find((c) => c.id === id)?.ref ?? "PK-RES-?",
        }));

        const result = await sweepExpiredReservations();

        expect(result).toEqual({ candidates: 3, expired: 3, errors: 0 });
        expect(expireReservationMock).toHaveBeenCalledTimes(3);
        expect(expireReservationMock).toHaveBeenNthCalledWith(1, "res-1");
        expect(expireReservationMock).toHaveBeenNthCalledWith(2, "res-2");
        expect(expireReservationMock).toHaveBeenNthCalledWith(3, "res-3");
        // PostHog `capture` fires once per successful expiry.
        expect(captureMock).toHaveBeenCalledTimes(3);
    });

    it("one candidate throws → loop continues, expired === N − 1, errors === 1", async () => {
        const candidates = [
            { id: "res-a", ref: "PK-RES-2026-0010" },
            { id: "res-b", ref: "PK-RES-2026-0011" },
            { id: "res-c", ref: "PK-RES-2026-0012" },
        ];
        pushCandidates(candidates);

        // First call resolves OK, second throws (failure-isolation pivot),
        // third must still be invoked and resolve OK — the loop MUST NOT
        // abort on the second's exception.
        expireReservationMock
            .mockResolvedValueOnce({
                id: "res-a",
                status: "expired",
                referenceNumber: "PK-RES-2026-0010",
            })
            .mockRejectedValueOnce(new Error("simulated drizzle failure"))
            .mockResolvedValueOnce({
                id: "res-c",
                status: "expired",
                referenceNumber: "PK-RES-2026-0012",
            });

        // Suppress the SUT's `console.error("[expirySweep] failed for", …)`
        // during the deliberate throw so the test output stays clean.
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await sweepExpiredReservations();

        expect(result).toEqual({ candidates: 3, expired: 2, errors: 1 });
        // Critical: 3 invocations, not 2 — the loop did NOT abort on the throw.
        expect(expireReservationMock).toHaveBeenCalledTimes(3);
        expect(expireReservationMock).toHaveBeenNthCalledWith(1, "res-a");
        expect(expireReservationMock).toHaveBeenNthCalledWith(2, "res-b");
        expect(expireReservationMock).toHaveBeenNthCalledWith(3, "res-c");
        // Only the 2 successful expiries should fire a PostHog capture.
        expect(captureMock).toHaveBeenCalledTimes(2);
        // The thrown candidate's id is logged via console.error for ops triage.
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[1]).toBe("res-b");
    });

    it("zero candidates → { candidates: 0, expired: 0, errors: 0 } and no capture()", async () => {
        pushCandidates([]);

        const result = await sweepExpiredReservations();

        expect(result).toEqual({ candidates: 0, expired: 0, errors: 0 });
        expect(expireReservationMock).not.toHaveBeenCalled();
        expect(captureMock).not.toHaveBeenCalled();
    });
});
