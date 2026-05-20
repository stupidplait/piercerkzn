/**
 * Accessibility audit spec — testing-strategy-rollout Phase 6.
 *
 * Requirements: 6.1, 6.2, 6.7, 4.11.
 * Design: §"Phase 6 — Audits project (a11y + visual)" → `app/e2e/a11y.spec.ts`
 *
 * Runs in the `audits` Playwright project (sequential). Iterates the
 * public storefront routes and asserts zero serious/critical axe
 * violations on each. The `/visualizer` route gets a scoped allow-list
 * (AC 6.7) for WebGL-specific rules that produce unactionable noise.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { stubPostHog } from "./fixtures/posthog-stub";

const ROUTES = ["/", "/catalog", "/booking", "/visualizer", "/cart", "/about", "/contact"];

// AC 6.7 — only on /visualizer; the WebGL canvas triggers these rules
// without a DOM-level fix being possible.
const VISUALIZER_ALLOWLIST = ["canvas-content", "region"];

for (const route of ROUTES) {
    test(`a11y: ${route}`, async ({ page }) => {
        await stubPostHog(page);
        await page.goto(route);

        const axe = new AxeBuilder({ page });

        if (route === "/visualizer") {
            for (const rule of VISUALIZER_ALLOWLIST) axe.disableRules(rule);
            await page.locator('[data-testid="visualizer-canvas-ready"]').waitFor();
        }

        const result = await axe.analyze();
        const blocking = result.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical"
        );

        // expect.soft attaches ALL violations to the report rather than
        // stopping at the first — gives a complete picture per route.
        expect.soft(blocking, `${route}: ${blocking.map((v) => v.id).join(",")}`).toEqual([]);
    });
}
