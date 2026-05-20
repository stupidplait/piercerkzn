/**
 * Playwright-side seed wrapper around the Phase 1 reservation fixtures.
 *
 * `seedFlowFixtures()` is invoked exactly once per Playwright run — see
 * `app/e2e/global-setup.ts` — and produces the bare-minimum row set the
 * three flow specs (booking, reservation, visualizer) need: one tagged
 * product with a single variant carrying enough inventory to absorb the
 * concurrent runs, plus one tagged customer whose Argon2 password hash
 * matches `${tag}-pw` so `signInAs()` can mint a session through the
 * existing credentials provider.
 *
 * Tag conventions (per design §"Test tag conventions"):
 *
 *   tag             = `e2e-${process.pid}-${nonce}`
 *   product.handle  = `${tag}-prod`
 *   variant.sku     = `${tag}-sku-0`
 *   customer.email  = `${tag}@test.local`
 *   customer hash   = Argon2(`${tag}-pw`)
 *
 * Parallel CI shards each spawn their own pid; the random nonce
 * disambiguates within a single pid (e.g. when multiple Playwright
 * workers attach to the same parent). Cleanup is order-aware: the
 * `cleanup` callable returned here calls `cleanupReservationRows`
 * (children → parents within the reservation domain) and then
 * `cleanupTaggedRows` (curated-look / blog / inquiry rows that share
 * the tag); the latter is a no-op on the e2e seed today but stays
 * called for safety so a future spec that pulls in e.g. the wishlist
 * flow doesn't leak rows.
 */
import { randomBytes } from "node:crypto";

import { cleanupTaggedRows } from "@/test/integration/helpers";
import {
    cleanupReservationRows,
    seedReservationFixtures,
} from "@/test/integration/reservation-fixtures";

/** JSON-serialisable subset of `E2ESeed` — what `globalSetup` stashes. */
export interface E2ESeedStash {
    tag: string;
    productHandle: string;
    variantSku: string;
    customerEmail: string;
    customerPassword: string;
}

export interface E2ESeed extends E2ESeedStash {
    /**
     * Tear down every tagged row inserted by this seed. Idempotent;
     * safe to call from `globalTeardown` even if seeding threw mid-way.
     */
    cleanup: () => Promise<void>;
}

/** Inventory headroom: > any single flow's reservation footprint. */
const E2E_INVENTORY_QTY = 100;

/**
 * Seed the bare-minimum data the three flow specs need. Tagged with
 * `e2e-${process.pid}-${nonce}` so parallel CI shards don't collide.
 */
export async function seedFlowFixtures(): Promise<E2ESeed> {
    const nonce = randomBytes(4).toString("hex");
    const tag = `e2e-${process.pid}-${nonce}`;

    const fixtures = await seedReservationFixtures(tag, {
        variantCount: 1,
        inventoryQty: E2E_INVENTORY_QTY,
    });

    return {
        tag,
        productHandle: `${tag}-prod`,
        variantSku: fixtures.sku(0),
        customerEmail: fixtures.email,
        // Mirrors the deterministic Argon2 hash written by
        // `seedReservationFixtures` — exposed here so `signInAs()` can
        // post `{ email, password }` to the credentials provider.
        customerPassword: `${tag}-pw`,
        cleanup: async () => {
            // Reservation children → parents first, then the broader
            // tagged-row cleanup. Both helpers are `LIKE %tag%`-based
            // so the empty intersection between them is fine.
            await cleanupReservationRows(tag);
            await cleanupTaggedRows(tag);
        },
    };
}
