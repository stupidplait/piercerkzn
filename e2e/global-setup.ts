/**
 * Playwright `globalSetup`. Runs exactly once per `pnpm test:e2e`,
 * before any worker boots. Seeds the reservation-domain fixtures the
 * three flow specs need and stashes a JSON-serialisable handle on
 * `process.env.__E2E_SEED__` so individual spec files can read it
 * without re-seeding.
 *
 * `cleanup` is intentionally NOT stashed (functions don't survive
 * `JSON.stringify`); `global-teardown.ts` reconstructs the cleanup
 * from the tag instead.
 *
 * Env loading: Playwright spawns globalSetup in a fresh Node process
 * that does NOT auto-read `.env.local`. We mirror the integration
 * suite's pattern (`src/test/integration/setup.ts`) and load it
 * explicitly here so `seedReservationFixtures` can find
 * `DATABASE_URL` / `DATABASE_URL_POOLER`. The dotenv call lives
 * inside the function body (not at the module top) because TypeScript
 * import declarations are hoisted above any preceding code, so a
 * top-level `config({ ... })` would run AFTER the `seedFlowFixtures`
 * import side-effect chains evaluate `@/db`. Calling it inside the
 * function and then `await import()`-ing the seed module ensures the
 * env is populated before the DB client constructs.
 */
import path from "node:path";

import type { E2ESeedStash } from "./fixtures/seed";

export default async function globalSetup(): Promise<void> {
    const { config } = require("dotenv") as typeof import("dotenv");
    config({ path: path.resolve(__dirname, "..", ".env.local") });

    // Stub `server-only` so the auth-utils import chain (used by
    // `seedReservationFixtures` for Argon2 hashing) loads cleanly in
    // the Playwright Node context. The real package always throws
    // outside a Server Component to prevent client-side leakage; in a
    // test context we own the import surface so the throw is just
    // noise. The vitest configs use a Vite alias for the same purpose
    // (`server-only` → `./src/test/server-only.stub.ts`); this require
    // hook is the Node-side equivalent.
    const Module = require("node:module") as typeof import("node:module");
    const origResolve = (Module as any)._resolveFilename;
    (Module as any)._resolveFilename = function (
        this: unknown,
        request: string,
        ...rest: unknown[]
    ) {
        if (request === "server-only") {
            return path.resolve(__dirname, "..", "src", "test", "server-only.stub.ts");
        }
        return origResolve.call(this, request, ...rest);
    };

    // CommonJS `require` so the side-effect chain that resolves `@/db`
    // runs AFTER the dotenv `config()` call above has populated
    // `process.env.DATABASE_URL` / `DATABASE_URL_POOLER`. Playwright's
    // TS loader is CommonJS, so dynamic `await import()` of a `.ts`
    // file fails ("Cannot use import statement outside a module").
    const { seedFlowFixtures } = require("./fixtures/seed") as typeof import("./fixtures/seed");

    const seed = await seedFlowFixtures();

    const stash: E2ESeedStash = {
        tag: seed.tag,
        productHandle: seed.productHandle,
        variantSku: seed.variantSku,
        customerEmail: seed.customerEmail,
        customerPassword: seed.customerPassword,
    };

    process.env.__E2E_SEED__ = JSON.stringify(stash);
}
