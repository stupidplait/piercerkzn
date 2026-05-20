/**
 * Unit tests for the newsletter campaign state machine.
 *
 * The module under test is a frozen literal table plus a `transition()`
 * dispatcher; there are no collaborators to mock. Every test is an
 * exhaustive table assertion or a property-based exploration of the
 * `(state, action)` cross-product.
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 1: State machine transitions match the published table
 *   - Property 2: Rejected transitions never leak a value outside the result set
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { describe, expect, it } from "vitest";
import {
    TRANSITIONS,
    allowedActions,
    transition,
    type CampaignAction,
    type CampaignState,
} from "./state";

const STATES: readonly CampaignState[] = ["draft", "scheduled", "sending", "sent", "cancelled"];

const ACTIONS: readonly CampaignAction[] = [
    "schedule",
    "send",
    "cancel",
    "delete",
    "patch",
    "sweep_promote",
    "sweep_finalize",
];

// ===========================================================================
// Property 1 — State machine transitions match the published table
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 12.1
// ===========================================================================
describe("transition — Property 1: published table is canonical", () => {
    // Build the cross-product as a fixture so `it.each` displays each cell
    // separately in the reporter.
    const cross: Array<{
        state: CampaignState;
        action: CampaignAction;
        expected: CampaignState | null | "rejected";
    }> = [];
    for (const state of STATES) {
        for (const action of ACTIONS) {
            cross.push({
                state,
                action,
                expected: TRANSITIONS[state][action],
            });
        }
    }

    it.each(cross)("($state, $action) → $expected", ({ state, action, expected }) => {
        const result = transition(state, action);
        if (expected === "rejected") {
            expect(result).toEqual({ ok: false, error: "rejected" });
        } else {
            // null = row removed (delete from draft / cancelled).
            expect(result).toEqual({ ok: true, next: expected });
        }
    });

    // Sanity-check the exact shape of the four corners of the table that
    // anchor the design's lifecycle: draft → scheduled → sending → sent.
    it("draft → schedule → scheduled", () => {
        expect(transition("draft", "schedule")).toEqual({
            ok: true,
            next: "scheduled",
        });
    });
    it("scheduled → sweep_promote → sending", () => {
        expect(transition("scheduled", "sweep_promote")).toEqual({
            ok: true,
            next: "sending",
        });
    });
    it("sending → sweep_finalize → sent", () => {
        expect(transition("sending", "sweep_finalize")).toEqual({
            ok: true,
            next: "sent",
        });
    });
    it("sending → cancel → cancelled", () => {
        expect(transition("sending", "cancel")).toEqual({
            ok: true,
            next: "cancelled",
        });
    });
    it("delete is a row-removal from draft and cancelled", () => {
        expect(transition("draft", "delete")).toEqual({
            ok: true,
            next: null,
        });
        expect(transition("cancelled", "delete")).toEqual({
            ok: true,
            next: null,
        });
    });
});

// ===========================================================================
// Property 2 — Rejected transitions never leak a value outside the result set
// Validates: Requirements 12.1
// ===========================================================================
describe("transition — Property 2: closed result set", () => {
    // The only legal results are:
    //   { ok: true, next: <one of CampaignState | null> }
    //   { ok: false, error: 'rejected' }
    // Property tested across the entire (state × action) input space using
    // fast-check; the `cross` fixture above is finite (5 × 7 = 35) so this
    // is really an exhaustive check expressed as a property.
    it("every (state, action) returns only the allowed result shapes", () => {
        fcAssert(
            fc.property(
                fc.constantFrom(...STATES),
                fc.constantFrom(...ACTIONS),
                (state, action) => {
                    const result = transition(state, action);
                    if (result.ok) {
                        // next is either a known state or null
                        const okNext: Array<CampaignState | null> = [...STATES, null];
                        expect(okNext).toContain(result.next);
                    } else {
                        expect(result.error).toBe("rejected");
                    }
                }
            ),
            { numRuns: 200, seed: 2026_05_01 }
        );
    });

    it("rejected results never carry a `next` field", () => {
        for (const state of STATES) {
            for (const action of ACTIONS) {
                const result = transition(state, action);
                if (!result.ok) {
                    expect(result).not.toHaveProperty("next");
                }
            }
        }
    });

    it("`sent` is terminal — every action is rejected", () => {
        for (const action of ACTIONS) {
            expect(transition("sent", action)).toEqual({
                ok: false,
                error: "rejected",
            });
        }
    });

    it("`cancelled` accepts only `delete`; everything else is rejected", () => {
        for (const action of ACTIONS) {
            const result = transition("cancelled", action);
            if (action === "delete") {
                expect(result).toEqual({ ok: true, next: null });
            } else {
                expect(result).toEqual({ ok: false, error: "rejected" });
            }
        }
    });
});

// ===========================================================================
// allowedActions — convenience helper sanity check
// ===========================================================================
describe("allowedActions", () => {
    it.each([
        {
            state: "draft" as CampaignState,
            expected: ["schedule", "send", "cancel", "delete", "patch"].sort(),
        },
        {
            state: "scheduled" as CampaignState,
            expected: ["send", "cancel", "sweep_promote"].sort(),
        },
        {
            state: "sending" as CampaignState,
            expected: ["cancel", "sweep_finalize"].sort(),
        },
        {
            state: "sent" as CampaignState,
            expected: [] as string[],
        },
        {
            state: "cancelled" as CampaignState,
            expected: ["delete"],
        },
    ])("$state → $expected", ({ state, expected }) => {
        expect(allowedActions(state).slice().sort()).toEqual(expected);
    });
});
