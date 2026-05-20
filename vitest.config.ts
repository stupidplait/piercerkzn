import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
        exclude: [
            "node_modules",
            ".next",
            "e2e",
            // Integration tests run via vitest.integration.config.ts; they
            // need the node environment + a real DB and would fail under jsdom.
            "src/**/*.integration.test.ts",
        ],
        coverage: {
            provider: "v8",
            // `json-summary` emits `coverage/coverage-summary.json` —
            // consumed by the `davelosert/vitest-coverage-report-action`
            // PR-comment action wired in the CI step (per Phase 5
            // task 5.3). The other reporters keep the developer-side
            // experience unchanged: `text` for terminal, `json` for
            // raw aggregation, `html` for the browseable report at
            // `app/coverage/index.html`.
            reporter: ["text", "json", "json-summary", "html"],
            exclude: [
                "node_modules/",
                ".next/",
                "src/test/",
                "e2e/",
                "playwright.config.ts",
                "next.config.ts",
                "drizzle.config.ts",
                "postcss.config.mjs",
                // Phase 5 task 5.2 — design §"Phase 5 — Coverage gating"
                // calls these out as exclusions on top of the existing
                // list. They are non-logic surfaces (migrations, email
                // templates rendered as HTML, worker entry-point glue)
                // whose execution is verified by integration tests
                // and visual snapshots, not unit tests.
                "src/db/migrations/",
                "src/emails/**/*.tsx",
                "src/workers/index.ts",
            ],
            // Coverage thresholds — Phase 5 / AC 5.1 + 5.7 fallback.
            //
            // Baseline measured on 2026-05-18 with the unit suite at 56
            // files / 950 tests:
            //
            //   Lines:      15.79%  (design floor 70 unreachable)
            //   Statements: 15.79%  (design floor 70 unreachable)
            //   Functions:  73.45%  (design floor 65 — already met)
            //   Branches:   79.01%  (design floor 60 — already met)
            //
            // Lines + statements are far below the design's 70% floor
            // because the unit suite covers `src/lib/{validations,media,
            // cart,booking/{time,availability},aftercare/time,settings,
            // wishlist,uploads,auth-{utils,totp},cache,consent,posthog}`,
            // `src/lib/{telegram,newsletters,telegram-broadcasts,
            // satisfaction,downsize,aftercare,booking,admin}/*.ts`, and
            // `src/emails/*.tsx`, while leaving everything in
            // `src/app/{api,admin,...}/route.ts`, `src/lib/{auth,api,
            // cors,rate-limit,reservations,...}.ts`, and other
            // integration-only surfaces at 0% line coverage. Those
            // surfaces ARE covered by the Vitest integration suite
            // (50+ tests across admin + public API routes) and the
            // Phase 4 Playwright flow specs — but the AC 5.8 explicitly
            // forbids applying integration-suite coverage to the unit
            // gate's thresholds.
            //
            // Per AC 5.7, when the design floors cannot be reached
            // without disabling tests, the floor is lowered to the
            // measured baseline minus 2pp. The values below apply that
            // fallback for lines + statements; functions + branches
            // remain at the design floors because the baseline already
            // exceeds them.
            //
            // TODO(testing-strategy-rollout): drive global coverage to
            //   the design floor of 70/70/65/60 by adding unit tests
            //   to `src/lib/{auth,api,cors,rate-limit,reservations,
            //   reviews,resend,redis,r2,queue,log,env,cron}.ts` and
            //   `src/lib/{captcha,looks,products,services,settings}/
            //   *.ts`. Each module has an existing integration test
            //   that pins its observable contract; the unit-test
            //   layer would catch internal regressions earlier and
            //   bring the gate up to the design floor.
            //
            // Per-file override on `src/lib/reservations.ts` (design §
            // "Phase 5 — Coverage gating", AC 5.5) is deliberately
            // OMITTED. The file's unit-coverage baseline is 0% — it is
            // exclusively covered by `src/lib/reservations.integration
            // .test.ts` (which AC 5.8 excludes from the gate). The
            // 90/80 per-file override is unreachable until that file
            // gains direct unit tests; the integration suite already
            // exercises every documented branch (4 PBT properties + 2
            // example tests covering create / cancel / expire round-
            // trip, FK rollback, conservation invariant, idempotence,
            // metamorphic cancel order, and concurrent admission). The
            // integration suite is the authoritative regression oracle
            // for this module.
            thresholds: {
                lines: 14,
                statements: 14,
                functions: 71,
                branches: 77,
            },
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            // Next.js' `import "server-only"` package only exists at runtime
            // in the Next bundler. Stub it for Vitest with an empty module.
            "server-only": path.resolve(__dirname, "./src/test/server-only.stub.ts"),
        },
    },
});
