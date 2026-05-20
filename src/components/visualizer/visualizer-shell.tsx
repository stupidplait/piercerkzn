"use client";

/**
 * Visualizer shell — wraps the page body, mounts the Telegram WebApp
 * provider, and emits the documented PostHog `visualizer_opened` event
 * exactly once per mount.
 *
 * The placeholder body lives here so future Phase 5b 3D-UI work can swap
 * the body without touching the layout, the provider, or the theme bridge.
 *
 * Phase 4 of the testing-strategy-rollout spec adds two **dev-only seams**
 * that the e2e flow specs (`app/e2e/visualizer-flow.spec.ts`) and audit
 * specs (`app/e2e/a11y.spec.ts`, `app/e2e/visual.spec.ts`) coordinate
 * against. Both seams are guarded by `process.env.NODE_ENV !== "production"`
 * so the Next.js compiler (which inlines `process.env.NODE_ENV` at build
 * time) lets Terser DCE the entire branch out of the production bundle.
 * The strings `"visualizer-canvas-ready"` and `"camera=test"` therefore
 * never reach end users — verified by `pnpm build` + grep on
 * `.next/static/`.
 *
 *   1. **Canvas-ready signal** — once R3F's `<Canvas onCreated>` fires,
 *      `data-testid="visualizer-canvas-ready"` appears on the canvas
 *      wrapper. Until Phase 5b plumbs the real R3F `<Canvas>` here, the
 *      placeholder body simulates that event one animation frame after
 *      mount so the seam is usable in dev/test today; Phase 5b just
 *      replaces the simulator with `<Canvas onCreated={onCanvasReady}>`.
 *   2. **Test camera override** — `?camera=test` resolves to the
 *      deterministic `{ position: [0, 1.5, 3], fov: 45 }` per
 *      design §"Architecture" → D-7. Phase 5b spreads it via
 *      `<Canvas camera={testCamera ?? DEFAULTS}>`.
 *
 * Requirements: 1.1, 9.1, 9.2, 9.3, 11.1; testing-strategy-rollout 4.7, 6.8.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { usePostHogClient } from "@/components/posthog-provider";

import { TelegramWebAppProvider, useTelegramWebApp } from "./mini-app-context";

// ---------------------------------------------------------------------------
// Russian copy — exported so tests can assert exact strings
// ---------------------------------------------------------------------------

export const TXT_VISUALIZER_PLACEHOLDER_TITLE = "3D-примерка";
export const TXT_VISUALIZER_PLACEHOLDER_BODY =
    "3D-примерка скоро откроется. Следите за обновлениями в Telegram-канале студии.";

// ---------------------------------------------------------------------------
// Dev-only test seams (testing-strategy-rollout Phase 4 — task 4.1)
// ---------------------------------------------------------------------------

/**
 * Camera preset honoured when `?camera=test` is present in the URL **and**
 * the build is not production. Pinned values per design §"Architecture"
 * → D-7 — keep them deterministic so visual snapshots are stable.
 *
 * Exported for the future Phase 5b `<Canvas camera={…}>` integration.
 */
export interface VisualizerTestCamera {
    position: readonly [number, number, number];
    fov: number;
}

const TEST_CAMERA_OVERRIDE: VisualizerTestCamera = {
    position: [0, 1.5, 3],
    fov: 45,
};

/**
 * Returns the deterministic camera override iff
 *   1. the build is not production (compile-time gate — Terser DCEs the
 *      whole helper out of the prod bundle), AND
 *   2. the current URL carries `?camera=test`.
 *
 * Returns `null` otherwise. The future Phase 5b `<Canvas>` site is the
 * only consumer (`<Canvas camera={testCamera ?? defaultCamera}>`).
 *
 * Reads the URL via `useSearchParams()` from `next/navigation` so the
 * value is hydration-safe and re-evaluates if the user navigates between
 * `/visualizer` and `/visualizer?camera=test` without a full reload.
 * The hook requires a `<Suspense>` boundary above the consumer; the
 * root `app/layout.tsx` already wraps the tree in one for the existing
 * PostHog `useSearchParams` consumer.
 */
function useTestCameraOverride(): VisualizerTestCamera | null {
    // `useSearchParams()` is invoked unconditionally to satisfy the rules
    // of hooks; the cheap branch below decides whether the value matters.
    // In production the entire helper is DCE'd by the
    // `process.env.NODE_ENV` short-circuit so the search-params call site
    // disappears too.
    const searchParams = useSearchParams();
    if (process.env.NODE_ENV === "production") return null;
    return searchParams?.get("camera") === "test" ? TEST_CAMERA_OVERRIDE : null;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

interface VisualizerShellProps {
    isMini: boolean;
}

export default function VisualizerShell({ isMini }: VisualizerShellProps) {
    return (
        <TelegramWebAppProvider>
            <VisualizerBody isMini={isMini} />
        </TelegramWebAppProvider>
    );
}

function VisualizerBody({ isMini }: { isMini: boolean }) {
    const ph = usePostHogClient();
    const captureFiredRef = useRef(false);
    const webApp = useTelegramWebApp();

    // ===== Phase 4 dev-only test seams (testing-strategy-rollout 4.7, 6.8)
    const testCamera = useTestCameraOverride();
    const [canvasReady, setCanvasReady] = useState(false);

    // Placeholder simulator for `<Canvas onCreated>` — fires one animation
    // frame after mount so the `[data-testid="visualizer-canvas-ready"]`
    // seam is observable in dev/test builds **today**, before Phase 5b
    // lands the real R3F integration. The whole effect tree-shakes out
    // of the production bundle because its body short-circuits when
    // `process.env.NODE_ENV === "production"` (statically inlined by the
    // Next.js compiler). Phase 5b deletes this effect and wires
    // `<Canvas onCreated={() => setCanvasReady(true)}>` instead.
    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        if (typeof window === "undefined") return;
        const id = window.requestAnimationFrame(() => setCanvasReady(true));
        return () => window.cancelAnimationFrame(id);
    }, []);

    // Fire `visualizer_opened` exactly once per mount, even under React 19
    // Strict Mode double-mount in development.
    useEffect(() => {
        if (captureFiredRef.current) return;
        captureFiredRef.current = true;
        ph.capture("visualizer_opened", { is_mini: isMini });
    }, [ph, isMini]);

    // Inside the Mini-App, surface a single "Закрыть" main button so the
    // close affordance is one tap. The button is hidden outside Telegram.
    useEffect(() => {
        if (!webApp.isMini) return;
        webApp.mainButton.setText("Закрыть");
        webApp.mainButton.show();
        const dispose = webApp.mainButton.onClick(() => webApp.close());
        return () => {
            dispose();
            webApp.mainButton.hide();
        };
    }, [webApp]);

    // Compose dev-only attributes on the canvas wrapper. Wrapped in a
    // single `process.env.NODE_ENV` guard so Terser drops the whole block
    // (and the string literals it contains) from the production bundle.
    const wrapperProps: Record<string, string> = {};
    if (process.env.NODE_ENV !== "production") {
        if (canvasReady) wrapperProps["data-testid"] = "visualizer-canvas-ready";
        if (testCamera !== null) wrapperProps["data-test-camera"] = "true";
    }

    return (
        <main
            {...wrapperProps}
            style={{
                maxWidth: "32rem",
                margin: "0 auto",
                padding: "3rem 1.5rem",
                textAlign: "center",
            }}
        >
            <h1
                style={{
                    fontSize: "2rem",
                    fontWeight: 700,
                    marginBottom: "0.75rem",
                }}
            >
                {TXT_VISUALIZER_PLACEHOLDER_TITLE}
            </h1>
            <p style={{ fontSize: "1rem", lineHeight: 1.5, opacity: 0.85 }}>
                {TXT_VISUALIZER_PLACEHOLDER_BODY}
            </p>
        </main>
    );
}
