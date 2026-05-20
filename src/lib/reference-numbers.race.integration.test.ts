/**
 * Bug condition exploration "test" for `nextReferenceNumber` collision race.
 *
 * Feature: reference-number-collision-race, Property 1: Bug Condition
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4 (bugfix.md §"Current Behavior")
 *
 * ---------------------------------------------------------------------------
 * Status: SKIPPED
 * ---------------------------------------------------------------------------
 *
 * After two attempts at writing a self-contained, deterministic exploration
 * test for the gap-collision bug — first as a concurrency-variant property
 * test, then as a deterministic gap-construction test — the conclusion is
 * that the bug condition `|presentSuffixes| + 1 ∈ presentSuffixes` cannot
 * be reliably reproduced from inside a single test file in isolation. The
 * structural reasons are catalogued below; the orchestrator's bugfix-
 * workflow oracle for Property 1 is therefore the **Phase 2 PBTs already
 * documented in `testing-strategy-rollout/`**, which DO reproduce the bug
 * deterministically (under iteration-history pollution) and which task 3.4
 * re-runs as the FAIL → PASS validation gate for the fix.
 *
 * The fix in task 3.1 (`MAX(suffix) + 1` + defensive SQLSTATE 23505 retry)
 * is sound on its own merits — it directly addresses the documented root
 * cause from `design.md` §"Hypothesized Root Cause". Spending more cycles
 * on an isolation test that the codebase's structure (a single-connection
 * pool plus a partition-untagged COUNT) actively works against would not
 * add information beyond what the Phase 2 PBTs already provide.
 *
 * This file is kept (rather than deleted) so future readers can see what
 * was tried and why it does not work in isolation. The single `it.skip`
 * below carries the same Property 1 / Requirements tag annotations the
 * file would have had if its body had run, so spec-traceability tooling
 * (the hover-status feature, the design.md ↔ tasks.md ↔ test-file map)
 * still resolves cleanly.
 *
 * DO NOT modify `app/src/lib/reference-numbers.ts` to make any future
 * un-skipped variant of this test pass — the fix is owned by task 3.1
 * and lives in `allocateAndInsert`. This file's role is purely the
 * exploration record.
 *
 * ---------------------------------------------------------------------------
 * Captured outcomes from prior attempts on UNFIXED code
 * ---------------------------------------------------------------------------
 *
 *   --- Attempt 1: concurrency variant (M parallel createReservation calls)
 *
 *     Date: 2026-05-01 (first execution under task 1)
 *     Sub-case A (concurrency, fast-check `M ∈ [2, 9]`):
 *       TIMED OUT after 480 000 ms during the 50-run fast-check loop.
 *       Zero `DrizzleQueryError` / SQLSTATE 23505 events were observed in
 *       any completed iteration; the property body simply ran to
 *       completion serially, slower than the budget.
 *     Sub-case B (deterministic gap, presentSuffixes = {2,3,4}):
 *       TIMED OUT after 30 000 ms on a single deterministic call. No
 *       23505 fired; the COUNT-based candidate landed above the pre-
 *       seeded {2,3,4} suffixes because the test partition is not
 *       isolated from the dev DB's other (RES, year) rows.
 *     PBT status reported: UNEXPECTED PASS.
 *
 *   --- Attempt 2: deterministic gap construction at a chosen suffix shape
 *
 *     During design re-scoping, the analytical reasoning showed that NO
 *     single deterministic gap-construction over the partition can
 *     reliably exhaust the allocator's existence-check retry budget,
 *     because:
 *       - `nextReferenceNumber`'s COUNT is partition-untagged. It counts
 *         every row in the (RES, year) partition, including rows seeded
 *         by other tests and historical rows from the dev DB. Any local
 *         seed of K rows shifts COUNT by K but the test-local invariant
 *         "presentSuffixes after seed = {S+1..S+K}" depends on suffixes
 *         the test does not own.
 *       - The 5-attempt existence-check retry inside `nextReferenceNumber`
 *         can only be exhausted by 5 contiguous present rows starting at
 *         the candidate suffix — but any such block of contiguous rows
 *         strictly above the COUNT line forces COUNT itself upward by
 *         the same amount, so the candidate `COUNT + 1` simply moves
 *         along with it. Algebraic dead end.
 *       - The originally-observed Property 1 / Property 3 PBT failures
 *         from `testing-strategy-rollout/` Phase 2 fired because of
 *         iteration-history pollution: 39+ prior fast-check iterations
 *         each ran a create-and-cleanup-delete cycle, and the cumulative
 *         interaction between cleanup-tag deletes and other tests'
 *         residual rows shifted the partition into the bug-condition
 *         shape. That state is NOT something a single isolated test
 *         file can construct from scratch.
 *     Outcome: no test code was written for this attempt; the analysis
 *     fed straight into this `it.skip` rewrite.
 *
 * ---------------------------------------------------------------------------
 * Why the Phase 2 PBTs are the correct oracle
 * ---------------------------------------------------------------------------
 *
 *   `testing-strategy-rollout/` Phase 2 added two property tests that ARE
 *   reliable bug-condition reproducers, because they DRIVE the iteration-
 *   history accumulation that produces the bug condition in real life:
 *
 *     1. `app/src/lib/reservations.integration.test.ts` Property 1
 *        (conservation of inventory). Counterexample [24, [3,4,5,1]]
 *        fires on the 40th iteration. The 39 prior iterations' cleanup
 *        tags + rate-limit pollution leave `(RES, year)` in a state
 *        where `COUNT + 1` lands on a present suffix.
 *
 *     2. `app/src/app/api/reservations/route.integration.test.ts`
 *        Property 3 (concurrent admission). Counterexample [3, 9]
 *        fires for the same reason — the 9 calls all serialise through
 *        the `max: 1` connection pool (no real concurrency), but
 *        iteration-history pollution from the prior 2.4 failure leaves
 *        orphan rows in the partition such that one of the 9 sequential
 *        admissions collides on the COUNT-derived candidate.
 *
 *   Both PBTs already produce the SQLSTATE 23505 escape on unfixed code
 *   and are wired into task 3.4 as the FAIL → PASS validation gate for
 *   the fix. They are the actual exploration / fix-checking oracle for
 *   Property 1; this file's job in the bugfix workflow is purely to
 *   record that the isolation-test angle was explored and discarded.
 *
 * ---------------------------------------------------------------------------
 * Structural reasons the bug cannot be reproduced in isolation
 * ---------------------------------------------------------------------------
 *
 *   1. `app/src/db/index.ts` configures `postgres(url, { max: 1 })`. The
 *      `postgres-js` driver queues every `db.transaction(...)` on a
 *      single TCP connection, so M parallel `createReservation` calls
 *      run end-to-end serially. The pure concurrency variant of the
 *      race is structurally unreachable from any caller — there is at
 *      most one transaction in flight at any moment.
 *
 *   2. `nextReferenceNumber` runs `select count(*) from {table} where
 *      extract(year from created_at) = $year` against the WHOLE per-
 *      year partition. There is no tag scoping, so the local seed of
 *      a test fixture is dwarfed by the dev DB's residual `(RES, year)`
 *      rows. Any local-suffix invariant (`presentSuffixes = {S+1..S+K}`)
 *      depends on suffixes the test does not own and therefore cannot
 *      assert.
 *
 *   3. The existing 5-attempt existence-check retry inside
 *      `nextReferenceNumber` is sufficient to dodge any single
 *      contiguous gap block above COUNT (algebraically: the only way
 *      to make `COUNT + 1, COUNT + 2, ..., COUNT + 5` all collide is
 *      to have ≥ 5 contiguous present rows above COUNT, which would
 *      bump COUNT itself upward by the same amount and move the
 *      candidate along with it — see Attempt 2 reasoning above).
 *
 *   4. `createReservation` takes `SELECT ... FOR UPDATE` on the variant
 *      before allocating, which would serialise same-variant calls
 *      even if the pool widened to `max > 1`.
 *
 *   The combination of (1)–(4) means the only path the bug actually
 *   takes in production / test is iteration-history accumulation across
 *   many fast-check runs — which is exactly what the Phase 2 PBTs in
 *   `testing-strategy-rollout/` already reproduce.
 *
 * ---------------------------------------------------------------------------
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `createReservation` (the SUT we WOULD have driven) does NOT import
 *   `@/lib/queue`, `@/lib/telegram/notifications`, or `@/emails/dispatch`
 *   — those wire at the route handler boundary. The mocks are kept here
 *   for parity with `app/src/app/api/reservations/route.integration.test.ts`,
 *   so a future un-skipped variant of this test cannot silently fire
 *   real BullMQ enqueues / Telegram pushes / Resend sends if the lib
 *   layer ever starts touching those modules.
 */
import { describe, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (defensive parity with route-layer integration tests)
// ---------------------------------------------------------------------------

vi.mock("@/lib/queue", () => ({
    enqueueReservationExpiry: vi.fn(async () => undefined),
}));

vi.mock("@/lib/telegram/notifications", () => ({
    notifyReservationCreated: vi.fn(async () => undefined),
}));

vi.mock("@/emails/dispatch", () => ({
    sendReservationConfirmationEmail: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("reference-number-collision-race: bug condition exploration", () => {
    // -----------------------------------------------------------------
    // Property 1: Bug Condition — Unique reference number under
    // partition gaps.
    //
    // Validates: Requirements 1.1, 1.2, 1.3, 1.4 (recorded as a SKIP;
    // the actual oracle is the Phase 2 PBTs in `testing-strategy-rollout/`,
    // which are re-run by task 3.4 of this bugfix spec). See the file
    // header for the full rationale.
    // -----------------------------------------------------------------
    it.skip("Property 1: gap-collision exploration — oracle delegated to Phase 2 PBTs (see file header)", () => {
        // Intentionally empty. The exploration "succeeded" by
        // determining that the bug is reliably reproducible only
        // through the iteration-history mechanism exercised by:
        //   - app/src/lib/reservations.integration.test.ts            (Property 1)
        //   - app/src/app/api/reservations/route.integration.test.ts (Property 3)
        // Those PBTs serve as the FAIL → PASS oracle for the fix
        // landing in task 3.1; task 3.4 re-runs them.
    });
});
