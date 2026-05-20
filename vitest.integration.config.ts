/**
 * Integration test config.
 *
 * Runs against a real Postgres database (the dev Neon DB by default;
 * override with `TEST_DATABASE_URL` to point at an isolated CI database).
 * Tests directly import route-handler functions (`GET`, `POST`, etc.) and
 * call them with synthetic `Request` objects — there is no HTTP server.
 *
 * Why a separate config:
 *   - The unit config uses `jsdom`; integration tests need `node` so the
 *     `postgres` driver and `crypto.randomUUID` work without polyfills.
 *   - We run integration tests serially (`singleFork: true`) so concurrent
 *     test files can't insert rows that violate each other's per-test row
 *     prefixes during cleanup.
 *   - A different `include` glob (`*.integration.test.ts`) keeps integration
 *     tests out of the fast unit run.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        environment: "node",
        globals: true,
        setupFiles: ["./src/test/integration/setup.ts"],
        include: ["src/**/*.integration.test.ts"],
        exclude: ["node_modules", ".next", "e2e"],
        pool: "forks",
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        // Generous timeout — first-run schema introspection + cold Neon
        // connection can take several seconds.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "server-only": path.resolve(__dirname, "./src/test/server-only.stub.ts"),
        },
    },
});
