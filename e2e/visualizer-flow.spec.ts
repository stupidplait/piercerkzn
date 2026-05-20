/**
 * Playwright E2E spec — visualizer flow (testing-strategy-rollout Phase 4).
 *
 * Requirements: 4.1, 4.7, 4.11, 4.12.
 *
 * Phase 4 vs Phase 5b
 * -------------------
 * The visualizer page at `/visualizer` currently renders a placeholder
 * body (see `app/src/components/visualizer/visualizer-shell.tsx`) — the
 * real R3F `<Canvas>` ships in Phase 5b. The placeholder simulates the
 * `<Canvas onCreated>` event one animation frame after mount so the
 * `data-testid="visualizer-canvas-ready"` seam (added in task 4.1) is
 * already observable in dev/test today.
 *
 * Until Phase 5b lands, the placeholder body has no jewelry-place
 * affordance and no "Save look" button, so the eventual happy-path shape
 * (place jewelry → save look → land on `/visualizer/saved/<id>`) is
 * captured below as a `test.fixme` placeholder test that documents the
 * full flow but is skipped from execution. The Phase-4 test exercises
 * everything observable today: WebGL gating, the canvas-ready signal,
 * the placeholder copy, and the PostHog stub.
 */
import { test, expect } from "@playwright/test";

import { stubPostHog } from "./fixtures/posthog-stub";

test.beforeEach(async ({ page }) => {
    await stubPostHog(page);
});

test("visualizer canvas-ready seam resolves and placeholder renders", async ({ page }) => {
    await page.goto("/visualizer");

    // ---- WebGL gate (AC 4.12) ------------------------------------------
    // Probe whether the headless browser can hand out a WebGL context.
    // Some Playwright/Chromium configurations (notably Linux CI without
    // `--use-gl=swiftshader`) refuse `getContext("webgl")`. Skipping
    // with a console warning keeps the skip observable so a CI flake
    // hunt can grep `WebGL unavailable` rather than silently passing.
    const hasWebGL = await page.evaluate(() => {
        try {
            const canvas = document.createElement("canvas");
            return !!(
                canvas.getContext("webgl") ||
                canvas.getContext("webgl2") ||
                canvas.getContext("experimental-webgl")
            );
        } catch {
            return false;
        }
    });

    if (!hasWebGL) {
        // AC 4.12: the skip MUST be observable, so emit a console warning
        // before the `test.skip` call. `no-console` is not enabled in the
        // app's ESLint config, so no disable directive is needed.
        console.warn("[visualizer-flow.spec] WebGL unavailable in this environment — skipping");
        test.skip(true, "WebGL unavailable in this environment");
        return;
    }

    // ---- Canvas-ready signal (AC 4.7) ----------------------------------
    // The dev-only seam set by `visualizer-shell.tsx` after R3F's first
    // frame fires. Required by AC 4.7 to eliminate flake from R3F warm-up
    // before any interaction. Today the placeholder body simulates this
    // one rAF after mount; Phase 5b wires it to `<Canvas onCreated>`.
    await page.locator('[data-testid="visualizer-canvas-ready"]').waitFor({ timeout: 10_000 });

    // ---- Placeholder-body assertion (Phase 4 stand-in) -----------------
    // The placeholder copy lives in `visualizer-shell.tsx` as
    // `TXT_VISUALIZER_PLACEHOLDER_TITLE = "3D-примерка"`. Asserting it is
    // visible proves the page rendered after the canvas-ready signal
    // resolved — i.e. the dev-only seam wiring works end-to-end. Once
    // Phase 5b lands, this assertion is replaced by the place/save/
    // navigate flow tracked by the `fixme` test below.
    await expect(page.getByText("3D-примерка", { exact: true })).toBeVisible();
});

/**
 * Phase 5b placeholder — registers the eventual happy-path shape so the
 * place/save/navigate flow is shape-documented in the test suite today
 * even though it cannot run against the placeholder body. Switch this
 * to `test(...)` and fill in the selectors once Phase 5b lands the real
 * R3F canvas, the anchor handles, and the "Save look" affordance.
 *
 * Per Req 7.4 (undocumented skips are a lint-level violation), the
 * fixme reason names the spec section that justifies the deferral.
 */
test.fixme("user places jewelry on a body anchor and saves the look", async ({ page }) => {
    // TODO(testing-strategy-rollout Phase 5b): plumb the real flow:
    //   1. Goto `/visualizer` and await `[data-testid="visualizer-canvas-ready"]`.
    //   2. Click a body anchor on the canvas (e.g. `[data-anchor="lobe-l"]`).
    //   3. Pick a jewelry item from the picker (selector TBD by Phase 5b).
    //   4. Click the "Сохранить look" button.
    //   5. Assert URL: `await expect(page).toHaveURL(/\/visualizer\/saved\/[a-z0-9-]+/i);`
    //
    // The reference is `requirements.md` Req 4.1 + AC 4.7; the
    // deferral is justified by `design.md` §"Phase 4 — Playwright
    // flow specs" → "the visualizer's placeholder body has no
    // jewelry-place affordance until Phase 5b".
    await page.goto("/visualizer");
    await expect(page).toHaveURL(/\/visualizer\/saved\/[a-z0-9-]+/i);
});
