import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    // Seed the reservation-domain fixtures (one tagged product + variant
    // + customer) once per run via `e2e/global-setup.ts`. The seed handle
    // is stashed on `process.env.__E2E_SEED__` for individual specs.
    // `global-teardown.ts` reads the tag back and cleans the rows up.
    globalSetup: require.resolve("./e2e/global-setup"),
    globalTeardown: require.resolve("./e2e/global-teardown"),
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "html",
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
            testIgnore: /(a11y|visual)\.spec\.ts$/,
        },
        {
            name: "audits",
            use: { ...devices["Desktop Chrome"] },
            testMatch: /(a11y|visual)\.spec\.ts$/,
            fullyParallel: false,
        },
    ],
    webServer: {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
