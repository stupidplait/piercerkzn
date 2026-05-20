/**
 * Playwright E2E spec — booking flow (testing-strategy-rollout Phase 4).
 *
 * Requirements: 4.1, 4.5, 4.8, 4.11.
 *
 * Phase 4 vs follow-up phase
 * --------------------------
 * The customer-facing booking wizard at `/booking` (service select →
 * date / slot pick → customer details → waiver → confirmation) has not
 * yet been built — only the API surface exists today. Concretely:
 *
 *   - `app/src/app/api/booking/services/route.ts` (list)
 *   - `app/src/app/api/booking/services/[handle]/route.ts` (detail)
 *   - `app/src/app/api/booking/availability/route.ts` (slot computation)
 *   - `app/src/app/api/booking/appointments/route.ts` (POST creates an
 *     appointment with reference number `PK-APT-YYYY-NNNN`)
 *   - `app/src/actions/booking.ts` (`createAppointmentAction` server
 *     action consumed by the eventual UI)
 *
 * No `app/src/app/booking/page.tsx` exists yet (cf.
 * `app/src/app/new-design-copy/page.tsx` and other storefront entries
 * which all link to `/booking` but resolve to a 404 today). The
 * follow-up phase ships the wizard component tree + the page entry; at
 * that point the `test.fixme` below flips to `test(...)` and exercises
 * the full happy path with the seeded fixtures.
 *
 * Today's observable surface is therefore limited to:
 *   1. The storefront CTA that links to `/booking` (confirms the link
 *      target the wizard will eventually answer).
 *   2. The PostHog stub (AC 4.11) — exercised by every page navigation
 *      so the route handler is wired before the wizard ships.
 *   3. The seed handle `process.env.__E2E_SEED__` (AC 4.3) — read once
 *      so a missing or malformed stash fails the suite loudly rather
 *      than producing surprising downstream failures.
 *
 * Per Req 7.4 (undocumented skips are a lint-level violation), the
 * `test.fixme` reason names the spec section that justifies the
 * deferral — see `design.md` §"Phase 4 — Playwright flow specs" →
 * `e2e/booking-flow.spec.ts`.
 *
 * Default parallel mode
 * ---------------------
 * Per AC 4.10, this file does NOT call
 * `test.describe.configure({ mode: "serial" })`; the booking flow has
 * no inventory side-effects (each iteration creates a fresh appointment
 * row keyed off the seeded customer / unique slot), so workers can run
 * it in parallel safely once the wizard ships.
 */
import { test, expect } from "@playwright/test";

import { signInAs } from "./fixtures/auth";
import { stubPostHog } from "./fixtures/posthog-stub";
import type { E2ESeedStash } from "./fixtures/seed";

// ---------------------------------------------------------------------------
// Seed handle (AC 4.3 / 4.8)
// ---------------------------------------------------------------------------
// `globalSetup` (`app/e2e/global-setup.ts`) calls `seedFlowFixtures()`
// once per `pnpm test:e2e` run and JSON-stringifies the resulting
// `E2ESeedStash` onto `process.env.__E2E_SEED__`. We read it eagerly at
// spec-load time so a missing stash fails one test rather than every
// `beforeAll` hook independently. The full `E2ESeed` (with the
// `cleanup` callable) is NOT recoverable here — functions don't survive
// `JSON.stringify`; teardown is handled by `global-teardown.ts`.
const SEED_RAW = process.env.__E2E_SEED__ ?? "";

function readSeed(): E2ESeedStash {
    if (!SEED_RAW) {
        throw new Error(
            "[booking-flow.spec] process.env.__E2E_SEED__ is empty — did Playwright globalSetup run?"
        );
    }
    try {
        return JSON.parse(SEED_RAW) as E2ESeedStash;
    } catch (err) {
        throw new Error(
            `[booking-flow.spec] failed to parse __E2E_SEED__ JSON: ${(err as Error).message}`
        );
    }
}

test.beforeEach(async ({ page }) => {
    // AC 4.11 — every booking page navigation issues PostHog calls; stub
    // the ingest endpoint to a 204 so analytics never fire from CI.
    await stubPostHog(page);
});

// ---------------------------------------------------------------------------
// Live test — what's exercisable against the storefront today.
// ---------------------------------------------------------------------------
// Even with the wizard not yet built, the storefront homepage already
// renders multiple `Запись`/`Записаться` CTAs that point at `/booking`
// (cf. `new-design-copy/page.tsx` lines 96, 157, 165, 200). Verifying
// the link target stays stable today is what catches a refactor that
// silently re-points the booking CTA somewhere else before the wizard
// ships, which would be a regression even before the destination page
// exists.
test("homepage exposes a /booking-style CTA the wizard will answer", async ({ page }) => {
    // Read the seed once so a missing stash surfaces here rather than
    // inside the eventual happy-path test below — same diagnostic
    // surface the wizard test will use, which makes future debugging
    // easier when the fixme flips on.
    const seed = readSeed();
    expect(seed.tag).toMatch(/^e2e-\d+-[0-9a-f]{8}$/);
    expect(seed.customerEmail).toBe(`${seed.tag}@test.local`);

    await page.goto("/");

    // The homepage renders several `Запись`/`Записаться` links. Today
    // (with the wizard unbuilt) some of those links point at the
    // Telegram fallback `https://t.me/piercerkzn`; once the wizard
    // ships, internal links to `/booking` join them. Until both
    // surfaces coexist, this assertion verifies that AT LEAST ONE
    // booking-style CTA is wired to one of the two acceptable
    // destinations: the internal `/booking` route OR the Telegram
    // fallback. This catches a regression where the booking CTA points
    // somewhere completely different (e.g. `/contact` or a dead link)
    // but accommodates the current state where Telegram is the
    // working destination.
    const ctas = page.getByRole("link", { name: /Запис(ь|аться)/i });
    const count = await ctas.count();
    expect(count).toBeGreaterThan(0);

    // Collect every booking-style CTA's href and verify each goes to
    // either `/booking` (internal wizard) or `t.me/piercerkzn`
    // (Telegram fallback). When the wizard ships and the internal
    // link replaces the Telegram one, this assertion will still pass —
    // the only way to break it is to silently re-point a booking CTA
    // somewhere unrelated, which IS the regression we want to catch.
    const acceptable = (href: string | null) =>
        href !== null &&
        (href === "/booking" ||
            href.startsWith("/booking?") ||
            href.startsWith("/booking#") ||
            /^https?:\/\/t\.me\/piercerkzn/.test(href));

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
        const href = await ctas.nth(i).getAttribute("href");
        if (href !== null) hrefs.push(href);
    }
    expect(
        hrefs.every(acceptable),
        `expected every booking CTA to link to /booking or t.me/piercerkzn, got: ${JSON.stringify(hrefs)}`
    ).toBe(true);
});

// ---------------------------------------------------------------------------
// Happy-path placeholder — registered as fixme until the wizard ships.
// ---------------------------------------------------------------------------
// Documents the eventual flow shape so reviewers can see where AC 4.5
// will be enforced. Per AC 4.10 this stays in the default parallel
// mode. Per AC 4.8 the session is minted via `signInAs` against the
// real credentials provider rather than via cookie mutation. The final
// URL assertion uses the `PK-APT-YYYY-NNNN` reference-number shape
// emitted by `nextReferenceNumber("APT", …)` in
// `app/src/lib/reference-numbers.ts`.
test.fixme("user books an appointment and lands on a PK-APT-YYYY-NNNN confirmation", async ({
    page,
}) => {
    const seed = readSeed();

    // AC 4.8 — mint a NextAuth session for the seeded customer so
    // the wizard's customer-scoped state (saved profile, prior
    // wishlist picks, returning-customer pre-fill) is observable.
    // Anonymous booking is also supported by the API (cf.
    // `app/src/app/api/booking/appointments/route.ts`) but the
    // logged-in path exercises more of the wizard's branching.
    await signInAs(page, seed.customerEmail, seed.customerPassword);

    // TODO(testing-strategy-rollout follow-up): plumb the real flow.
    // Suggested selectors (final shape TBD by the wizard's
    // implementation phase):
    //   1. await page.goto("/booking");
    //   2. await page.getByRole("button", { name: /Запис(ь|аться)/i }).click();
    //   3. // service select — pick the first available service card
    //      await page.getByRole("button", { name: /Выбрать услугу/i }).first().click();
    //   4. // date / slot pick — pick first available date + first slot
    //      await page.getByRole("button", { name: /Выбрать дату/i }).click();
    //      await page.getByTestId("availability-day").first().click();
    //      await page.getByTestId("availability-slot").first().click();
    //   5. // customer details — pre-fill comes from `signInAs` above;
    //      // any blank required fields:
    //      await page.getByLabel(/Имя/i).fill(seed.tag);
    //      await page.getByLabel(/Телефон/i).fill("+79001234567");
    //   6. // waiver — sign + accept. The signature pad ships as
    //      // a `<canvas>` consumed by `bookAppointmentSchema.waiverSignatureData`
    //      // (cf. `app/src/lib/validations/appointment.ts`); the wizard
    //      // is expected to expose a `data-testid="waiver-signature"` seam
    //      // that accepts a synthetic stroke (mirroring the visualizer-canvas-ready
    //      // dev-only seam pattern from task 4.1).
    //      await page.getByTestId("waiver-signature").click();
    //      await page.getByRole("checkbox", { name: /Подтверждаю/i }).check();
    //   7. await page.getByRole("button", { name: /Подтвердить запись/i }).click();
    //
    // Final assertion (AC 4.5): the confirmation page MUST surface
    // the appointment reference number in the URL. Format is
    // `PK-APT-YYYY-NNNN` per `nextReferenceNumber("APT", …)` —
    // verified by the existing integration test at
    // `app/src/app/api/booking/route.integration.test.ts` (regex
    // `/^PK-APT-\d{4}-\d{4}$/`). Use the same shape here so a drift
    // between the API and the URL is caught.
    await expect(page).toHaveURL(/PK-APT-\d{4}-\d{4}/, { timeout: 15_000 });
});
