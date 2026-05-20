/**
 * Visual regression spec — testing-strategy-rollout Phase 6.
 *
 * Requirements: 6.3, 6.5, 6.8, 4.11.
 * Design: §"Phase 6 — Audits project (a11y + visual)" → `app/e2e/visual.spec.ts`
 *
 * Runs in the `audits` Playwright project (sequential). Captures
 * full-page screenshots and compares against committed baselines in
 * `app/e2e/__screenshots__/`. CI never auto-updates snapshots; only
 * `pnpm test:e2e --update-snapshots` locally + commit does (AC 6.6).
 */
import { test, expect } from "@playwright/test";

import { stubPostHog } from "./fixtures/posthog-stub";

// AC 6.8 — freeze all animations/transitions for deterministic screenshots.
const FREEZE =
    "*, *::before, *::after { animation: none !important; transition: none !important; }";

// AC 6.5 — comparator config: tolerates font hinting jitter without
// permitting layout regressions.
test.use({
    screenshot: "only-on-failure",
    expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 } },
});

const PAGES: Array<{ route: string; mask?: string[] }> = [
    { route: "/", mask: ['[data-dynamic="hero-stat"]'] },
    { route: "/catalog", mask: ['[data-dynamic="price"]'] },
    { route: "/booking" },
    { route: "/visualizer?camera=test" },
    { route: "/cart" },
    { route: "/cart?seed=one-item" },
];

for (const p of PAGES) {
    test(`visual: ${p.route}`, async ({ page }) => {
        await stubPostHog(page);
        await page.goto(p.route);
        await page.addStyleTag({ content: FREEZE });

        if (p.route.startsWith("/visualizer")) {
            await page.locator('[data-testid="visualizer-canvas-ready"]').waitFor();
        }

        const mask = (p.mask ?? []).map((s) => page.locator(s));
        await expect(page).toHaveScreenshot({ mask });
    });
}
