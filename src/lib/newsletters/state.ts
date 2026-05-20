/**
 * Newsletter campaign state machine.
 *
 * Pure module — no DB, no I/O — so it can be unit-tested without a DB harness
 * and consumed identically from admin routes, the BullMQ worker, and the cron
 * sweeper. The `TRANSITIONS` literal is the canonical source of truth: rows
 * are the current state, columns are the requested action, cells are the
 * resulting state (or `null` when the row is removed by `delete`, or
 * `"rejected"` when the action is illegal in that state).
 *
 * Callers must not branch on `state === "..."` directly — always go through
 * `transition(state, action)` so a future refactor of the table can't leave
 * stale `if` ladders behind.
 */
import "server-only";

export type CampaignState = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

export type CampaignAction =
    | "schedule"
    | "send"
    | "cancel"
    | "delete"
    | "patch"
    | "sweep_promote"
    | "sweep_finalize";

/**
 * Result of a transition: either the next state or a rejection.
 * For action='delete', the next state is null (the row is removed).
 */
export type TransitionResult =
    | { ok: true; next: CampaignState | null }
    | { ok: false; error: "rejected" };

/**
 * State × Action → next state, `null` (row removed), or `"rejected"`.
 *
 * Frozen literal so the only mutator is `transition()`.
 */
export const TRANSITIONS = Object.freeze({
    draft: {
        schedule: "scheduled",
        send: "sending",
        cancel: "cancelled",
        delete: null, // row removed
        patch: "draft",
        sweep_promote: "rejected",
        sweep_finalize: "rejected",
    },
    scheduled: {
        schedule: "rejected",
        send: "sending",
        cancel: "cancelled",
        delete: "rejected",
        patch: "rejected",
        sweep_promote: "sending",
        sweep_finalize: "rejected",
    },
    sending: {
        schedule: "rejected",
        send: "rejected",
        cancel: "cancelled",
        delete: "rejected",
        patch: "rejected",
        sweep_promote: "rejected",
        sweep_finalize: "sent",
    },
    sent: {
        schedule: "rejected",
        send: "rejected",
        cancel: "rejected",
        delete: "rejected",
        patch: "rejected",
        sweep_promote: "rejected",
        sweep_finalize: "rejected",
    },
    cancelled: {
        schedule: "rejected",
        send: "rejected",
        cancel: "rejected",
        delete: null, // row removed
        patch: "rejected",
        sweep_promote: "rejected",
        sweep_finalize: "rejected",
    },
} satisfies Record<CampaignState, Record<CampaignAction, CampaignState | null | "rejected">>);

/**
 * Apply a state-machine action to the current state.
 *
 * Returns `{ ok: true, next }` where `next` is the resulting state, or `null`
 * if the row should be removed (action = `delete`).
 *
 * Returns `{ ok: false, error: "rejected" }` if the action is illegal in the
 * given state. Admin routes map this to HTTP 409; the cron sweeper treats it
 * as a silent no-op.
 */
export function transition(state: CampaignState, action: CampaignAction): TransitionResult {
    const next = TRANSITIONS[state][action];
    if (next === "rejected") {
        return { ok: false, error: "rejected" };
    }
    return { ok: true, next };
}

/** Convenience: list the actions valid in a given state. */
export function allowedActions(state: CampaignState): CampaignAction[] {
    return (Object.keys(TRANSITIONS[state]) as CampaignAction[]).filter(
        (a) => TRANSITIONS[state][a] !== "rejected"
    );
}
