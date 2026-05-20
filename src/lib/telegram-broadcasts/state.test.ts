/**
 * Telegram broadcast state-machine unit tests.
 *
 * Pure module — the state-machine table is a `Record<state, Record<action, …>>`,
 * so we can drive the entire `BroadcastState × BroadcastAction` cross-product
 * without any DB or BullMQ harness. The two properties below together pin the
 * canonical lifecycle from the design doc.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { describe, expect, it } from "vitest";
import {
    TRANSITIONS,
    allowedActions,
    transition,
    type BroadcastAction,
    type BroadcastState,
} from "./state";

// ---------------------------------------------------------------------------
// Cross-product enumeration helpers
// ---------------------------------------------------------------------------
const STATES: BroadcastState[] = ["draft", "scheduled", "sending", "sent", "cancelled"];
const ACTIONS: BroadcastAction[] = [
    "schedule",
    "send",
    "cancel",
    "delete",
    "patch",
    "sweep_promote",
    "sweep_finalize",
];

const CROSS_PRODUCT: Array<[BroadcastState, BroadcastAction]> = STATES.flatMap((s) =>
    ACTIONS.map((a) => [s, a] as [BroadcastState, BroadcastAction])
);

// ===========================================================================
// Property 1 — `transition(s, a)` matches the table for every cross-product cell
// ===========================================================================
describe("state-machine — Property 1: transition matches TRANSITIONS table", () => {
    it.each(CROSS_PRODUCT)("transition(%s, %s) matches TRANSITIONS table", (state, action) => {
        const cell = TRANSITIONS[state][action];
        const result = transition(state, action);

        if (cell === "rejected") {
            expect(result).toEqual({ ok: false, error: "rejected" });
        } else {
            expect(result).toEqual({ ok: true, next: cell });
        }
    });

    // Property-test the same invariant for resilience: drive arbitrary
    // (state, action) pairs through `fast-check` and assert the same
    // table-equivalence.
    it("fc — transition output equals TRANSITIONS[state][action] verbatim", () => {
        fcAssert(
            fc.property(
                fc.constantFrom<BroadcastState>(...STATES),
                fc.constantFrom<BroadcastAction>(...ACTIONS),
                (state, action) => {
                    const cell = TRANSITIONS[state][action];
                    const result = transition(state, action);
                    if (cell === "rejected") {
                        return result.ok === false && result.error === "rejected";
                    }
                    return result.ok === true && result.next === cell;
                }
            ),
            { numRuns: 200, seed: 4_242 }
        );
    });
});

// ===========================================================================
// Property 2 — TRANSITIONS table is exhaustive (every cell defined)
// ===========================================================================
describe("state-machine — Property 2: TRANSITIONS table is exhaustive", () => {
    it("every state has all actions defined as either next-state, null, or 'rejected'", () => {
        for (const state of STATES) {
            const row = TRANSITIONS[state];
            for (const action of ACTIONS) {
                // Use Object.prototype.hasOwnProperty so we catch a missing
                // key even if its value happened to be `undefined`.
                expect(Object.prototype.hasOwnProperty.call(row, action)).toBe(true);
                const cell = row[action];
                const validCell =
                    cell === "rejected" || cell === null || STATES.includes(cell as BroadcastState);
                expect(validCell).toBe(true);
            }
        }
    });

    it("table has exactly STATES.length × ACTIONS.length cells", () => {
        let total = 0;
        for (const state of STATES) {
            total += Object.keys(TRANSITIONS[state]).length;
        }
        expect(total).toBe(STATES.length * ACTIONS.length);
    });

    it("rejected cells return { ok: false, error: 'rejected' } with no other fields", () => {
        for (const state of STATES) {
            for (const action of ACTIONS) {
                if (TRANSITIONS[state][action] !== "rejected") continue;
                const r = transition(state, action);
                expect(r).toEqual({ ok: false, error: "rejected" });
            }
        }
    });

    it("non-rejected cells return { ok: true, next } where `next` matches the cell", () => {
        for (const state of STATES) {
            for (const action of ACTIONS) {
                const cell = TRANSITIONS[state][action];
                if (cell === "rejected") continue;
                const r = transition(state, action);
                expect(r).toEqual({ ok: true, next: cell });
            }
        }
    });

    // Spot-check a few key cells from the design doc so a regression that
    // accidentally rewrites the table fails noisily.
    it("design-doc spot checks: critical transitions", () => {
        expect(TRANSITIONS.draft.schedule).toBe("scheduled");
        expect(TRANSITIONS.draft.send).toBe("sending");
        expect(TRANSITIONS.draft.cancel).toBe("cancelled");
        expect(TRANSITIONS.draft.delete).toBeNull();
        expect(TRANSITIONS.draft.patch).toBe("draft");

        expect(TRANSITIONS.scheduled.sweep_promote).toBe("sending");
        expect(TRANSITIONS.scheduled.send).toBe("sending");
        expect(TRANSITIONS.scheduled.cancel).toBe("cancelled");
        // Scheduled rows can no longer be patched — Requirements 3.5
        expect(TRANSITIONS.scheduled.patch).toBe("rejected");

        expect(TRANSITIONS.sending.sweep_finalize).toBe("sent");
        expect(TRANSITIONS.sending.cancel).toBe("cancelled");

        // Sent + cancelled are essentially terminal w.r.t. mutation.
        expect(TRANSITIONS.sent.cancel).toBe("rejected");
        expect(TRANSITIONS.sent.delete).toBe("rejected");
        expect(TRANSITIONS.cancelled.delete).toBeNull();
        expect(TRANSITIONS.cancelled.cancel).toBe("rejected");
    });
});

// ===========================================================================
// Helper sanity — `allowedActions` mirrors the table
// ===========================================================================
describe("state-machine — allowedActions reflects the table", () => {
    it.each(STATES)("allowedActions(%s) returns exactly the non-rejected actions", (state) => {
        const expected = ACTIONS.filter((a) => TRANSITIONS[state][a] !== "rejected");
        expect([...allowedActions(state)].sort()).toEqual([...expected].sort());
    });
});
