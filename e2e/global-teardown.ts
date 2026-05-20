/**
 * Playwright `globalTeardown`. Reads the tag stashed by
 * `global-setup.ts`, then runs the same cleanup pair the in-process
 * `seedFlowFixtures().cleanup` would — `cleanupReservationRows`
 * (reservation children → parents) followed by `cleanupTaggedRows`
 * (curated-look / blog / inquiry rows that may share the tag).
 *
 * The cleanup callable from `seedFlowFixtures` itself isn't reused
 * here because Playwright's setup / teardown run in separate Node
 * contexts, and the function isn't JSON-serialisable through
 * `process.env.__E2E_SEED__`. Reconstructing from the tag keeps
 * teardown a pure side-effect on the same DB.
 *
 * Env loading: like `global-setup.ts`, we explicitly load
 * `.env.local` because Playwright's teardown process does not
 * inherit it automatically. The `dotenv.config()` call lives inside
 * the function body and the `@/test/integration/*` modules are
 * imported dynamically so the dotenv call runs BEFORE the
 * side-effect chain that resolves `@/db` (which validates
 * `DATABASE_URL` at module load).
 */
import path from "node:path";

import type { E2ESeedStash } from "./fixtures/seed";

export default async function globalTeardown(): Promise<void> {
    const { config } = require("dotenv") as typeof import("dotenv");
    config({ path: path.resolve(__dirname, "..", ".env.local") });

    const raw = process.env.__E2E_SEED__;
    if (!raw) {
        // Setup never ran (or already cleared) — nothing to tear down.
        return;
    }

    let stash: E2ESeedStash;
    try {
        stash = JSON.parse(raw) as E2ESeedStash;
    } catch {
        // Malformed stash: bail rather than risk a tag-less cascading
        // delete. The next CI run starts from a clean env.
        return;
    }

    if (!stash.tag) return;

    // CommonJS `require` so the `@/db` side-effect chain (which
    // validates env at module load) runs AFTER `dotenv.config()` above.
    const { cleanupTaggedRows } =
        require("@/test/integration/helpers") as typeof import("@/test/integration/helpers");
    const { cleanupReservationRows } =
        require("@/test/integration/reservation-fixtures") as typeof import("@/test/integration/reservation-fixtures");

    await cleanupReservationRows(stash.tag);
    await cleanupTaggedRows(stash.tag);

    delete process.env.__E2E_SEED__;
}
