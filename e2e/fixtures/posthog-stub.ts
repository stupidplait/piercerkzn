import type { Page } from "@playwright/test";

/**
 * Block every PostHog ingest URL with a 204. Covers eu.posthog.com,
 * us.posthog.com, app.posthog.com, i.posthog.com, and self-hosted
 * overrides whose host contains "posthog.com".
 *
 * Per AC 4.11, every Playwright spec MUST call this in `beforeEach`
 * (or via the test fixture) before navigating, so analytics never fire
 * from CI runs.
 */
export async function stubPostHog(page: Page): Promise<void> {
    await page.route(/\/(i\.|app\.|us\.|eu\.)?posthog\.com\//i, (route) =>
        route.fulfill({ status: 204, contentType: "application/json", body: "{}" })
    );
}
