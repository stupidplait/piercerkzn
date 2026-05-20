/**
 * Playwright E2E spec — reservation flow (testing-strategy-rollout Phase 4).
 *
 * Requirements: 4.1, 4.6, 4.10, 4.11.
 *
 * Phase 4 vs follow-up phase
 * --------------------------
 * The customer-facing reservation funnel (PDP → "Забронировать" → cart
 * → customer details → confirmation) has not yet been built — only the
 * API surface, server-side guest cart store, and reservation domain
 * exist today. Concretely:
 *
 *   - `app/src/app/api/products/[handle]/route.ts` (PDP detail)
 *   - `app/src/app/api/reservations/route.ts` (POST creates a reservation
 *     with reference number `PK-RES-YYYY-NNNN`)
 *   - `app/src/app/api/reservations/[id]/route.ts` (GET single reservation)
 *   - `app/src/lib/reservations.ts` (atomic transaction + cancel + expire)
 *   - `app/src/lib/cart/guest-cart.ts` (server mirror of the client cart;
 *     cookie `pkzn_guest_cart` keys a Redis hash)
 *
 * No `app/src/app/catalog/[handle]/page.tsx`, `app/src/app/cart/page.tsx`,
 * or reservation-confirmation page (e.g. `app/src/app/reservations/[ref]/page.tsx`)
 * exists yet. The storefront homepage at `app/src/app/new-design/` has
 * a chapter labelled "ЗАБРОНИРУЙ" that scrolls into view but only links
 * to Telegram for the actual reservation — it is not a navigable funnel
 * the test can walk. The follow-up phase ships the storefront pages +
 * the `[data-testid="cart-badge"]` selector; at that point the
 * `test.fixme` below flips to `test(...)` and exercises the full happy
 * path (AC 4.6) with the seeded fixtures.
 *
 * Today's observable surface is therefore limited to:
 *   1. The PDP API endpoint answering for the seeded product handle —
 *      proves the seed wired up and the route the eventual UI will
 *      consume is healthy.
 *   2. The PostHog stub (AC 4.11) — exercised by the API request so
 *      analytics never fire from CI.
 *   3. The seed handle `process.env.__E2E_SEED__` (AC 4.3) — read once
 *      so a missing or malformed stash fails the suite loudly rather
 *      than producing surprising downstream failures.
 *
 * Per Req 7.4 (undocumented skips are a lint-level violation), the
 * `test.fixme` reason names the spec section that justifies the
 * deferral — see `design.md` §"Phase 4 — Playwright flow specs" →
 * `e2e/reservation-flow.spec.ts`.
 *
 * Cart-badge selector
 * -------------------
 * AC 4.6 requires the final assertion `expect(page.getByTestId("cart-badge"))
 * .toHaveText("0")` after confirmation. Because no cart-badge component
 * exists today (the cart itself is unbuilt), the testid is captured in
 * the fixme test as a comment — adding the seam to a non-existent
 * component would create a dangling reference. When the storefront
 * ships its cart-badge, it MUST attach `data-testid="cart-badge"` to
 * the badge node so this fixme can flip on without further wiring.
 *
 * Serial mode (AC 4.10)
 * ---------------------
 * The reservation flow has inventory side effects: every confirmed
 * reservation atomically decrements `product_variant.inventory_quantity`
 * (cf. `app/src/lib/reservations.ts` `createReservation`). Even though
 * the seed allocates `inventoryQty: 100` headroom (cf.
 * `e2e/fixtures/seed.ts` `E2E_INVENTORY_QTY`), running this file's
 * tests in parallel against the same seeded variant could race the
 * row-level `SELECT … FOR UPDATE` lock and surface as flake. Per AC
 * 4.10 we declare serial mode at the file level so the fixme test (and
 * any future siblings exercising the same variant) execute one at a
 * time within their worker.
 */
import { test, expect } from "@playwright/test";

import { stubPostHog } from "./fixtures/posthog-stub";
import type { E2ESeedStash } from "./fixtures/seed";

// ---------------------------------------------------------------------------
// Serial mode (AC 4.10)
// ---------------------------------------------------------------------------
// Inventory side effects → tests in this file MUST NOT race each other.
// Workers can still run in parallel across files (the booking-flow and
// visualizer-flow specs stay in default parallel mode); only the
// reservation-flow file is serial.
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Seed handle (AC 4.3)
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
            "[reservation-flow.spec] process.env.__E2E_SEED__ is empty — did Playwright globalSetup run?"
        );
    }
    try {
        return JSON.parse(SEED_RAW) as E2ESeedStash;
    } catch (err) {
        throw new Error(
            `[reservation-flow.spec] failed to parse __E2E_SEED__ JSON: ${(err as Error).message}`
        );
    }
}

test.beforeEach(async ({ page }) => {
    // AC 4.11 — every reservation page navigation issues PostHog calls;
    // stub the ingest endpoint to a 204 so analytics never fire from CI.
    // We register the route on every test (not just the navigating ones)
    // so even API-only tests that incidentally trigger PostHog from
    // server-side rendering stay stubbed.
    await stubPostHog(page);
});

// ---------------------------------------------------------------------------
// Live test — what's exercisable against the storefront today.
// ---------------------------------------------------------------------------
// The PDP storefront page doesn't exist yet, but the API endpoint that
// will back it does. Hitting `/api/products/${seed.productHandle}` via
// Playwright's `request` context proves:
//
//   1. The seed product was inserted with the expected handle (AC 4.3).
//   2. The PDP API filter (`status: "published"` + `deletedAt IS NULL`)
//      lets the seeded row through — the eventual `/catalog/[handle]`
//      page will receive a real product to render.
//   3. The seeded variant carries enough inventory to absorb the
//      reservation that the fixme test will eventually fire.
//
// This catches a regression where the API contract or the seed shape
// drifts before the storefront page ships, which would silently break
// the eventual happy-path test.
test("seeded product is reachable through the PDP API the storefront will consume", async ({
    page,
}) => {
    const seed = readSeed();
    expect(seed.tag).toMatch(/^e2e-\d+-[0-9a-f]{8}$/);
    expect(seed.productHandle).toBe(`${seed.tag}-prod`);

    const res = await page.request.get(`/api/products/${encodeURIComponent(seed.productHandle)}`);
    expect(res.status()).toBe(200);

    const body = (await res.json()) as {
        product: {
            handle: string;
            variants: Array<{ sku: string; inventoryQuantity: number; inStock: boolean }>;
        };
    };

    expect(body.product.handle).toBe(seed.productHandle);
    expect(body.product.variants.length).toBeGreaterThan(0);

    // The seed allocates `inventoryQty: 100` headroom — anything > 0 is
    // enough for the eventual happy-path test, but pinning the lower
    // bound here surfaces a seed-contract drift loudly.
    const seededVariant = body.product.variants.find((v) => v.sku === seed.variantSku);
    expect(seededVariant).toBeDefined();
    expect(seededVariant!.inventoryQuantity).toBeGreaterThan(0);
    expect(seededVariant!.inStock).toBe(true);
});

// ---------------------------------------------------------------------------
// Happy-path placeholder — registered as fixme until the storefront ships.
// ---------------------------------------------------------------------------
// Documents the eventual flow shape so reviewers can see where AC 4.6
// will be enforced. The final URL assertion uses the
// `PK-RES-YYYY-NNNN` reference-number shape emitted by
// `nextReferenceNumber("RES", …)` in `app/src/lib/reference-numbers.ts`
// — verified end-to-end by the existing integration test at
// `app/src/app/api/reservations/route.integration.test.ts` (regex
// `/^PK-RES-\d{4}-\d{4}$/`). The cart-badge assertion uses the
// `[data-testid="cart-badge"]` selector that the storefront component
// MUST attach when it ships.
test.fixme("user reserves jewelry and lands on a PK-RES-YYYY-NNNN confirmation", async ({
    page,
}) => {
    const seed = readSeed();

    // TODO(testing-strategy-rollout follow-up): plumb the real flow.
    // Suggested selectors (final shape TBD by the storefront's
    // implementation phase):
    //   1. await page.goto(`/catalog/${seed.productHandle}`);
    //   2. // PDP — pick the seeded variant, click "Забронировать":
    //      await page.getByRole("button", { name: /Забронировать/i }).click();
    //   3. // Cart — review the item, advance to customer details:
    //      await page.goto("/cart");
    //      await page.getByRole("button", { name: /Оформить бронь|Продолжить/i }).click();
    //   4. // Customer details — guest path (anonymous reservation
    //      // is the simpler funnel; the logged-in path also works
    //      // via `signInAs` from `./fixtures/auth` if/when needed):
    //      await page.getByLabel(/Имя/i).fill(seed.tag);
    //      await page.getByLabel(/Email/i).fill(seed.customerEmail);
    //      await page.getByLabel(/Телефон/i).fill("+79001234567");
    //   5. // Confirm:
    //      await page.getByRole("button", { name: /Подтвердить бронь/i }).click();
    //
    // Final assertions:
    //
    //   AC 4.6 (URL contains `PK-RES-YYYY-NNNN`):
    //     The confirmation page MUST surface the reservation
    //     reference number in the URL. Format is `PK-RES-YYYY-NNNN`
    //     per `nextReferenceNumber("RES", …)`. Use the same shape
    //     here so a drift between the API and the URL is caught.
    await expect(page).toHaveURL(/PK-RES-\d{4}-\d{4}/, { timeout: 15_000 });

    //   AC 4.6 (cart badge resets to "0" after confirmation):
    //     The storefront cart-badge component MUST attach
    //     `data-testid="cart-badge"` to the visible badge node.
    //     After a successful reservation, `clearCartByToken` (cf.
    //     `app/src/lib/cart/guest-cart.ts`) drops the Redis-backed
    //     server cart and the client store flushes localStorage,
    //     so the badge MUST read "0" once the confirmation page
    //     finishes hydrating.
    await expect(page.getByTestId("cart-badge")).toHaveText("0");

    // Sanity guard so the seed reference is not flagged as unused
    // by the eventual test body — `seed.productHandle` and
    // `seed.customerEmail` will both be consumed by the steps
    // above; this no-op keeps the variable observable in the
    // fixme body so the diff lands cleanly.
    expect(seed.productHandle.length).toBeGreaterThan(0);
});
