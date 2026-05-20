/**
 * Property test for the aftercare email template — every step in the
 * canonical 7-element `AFTERCARE_STEPS` tuple must produce a non-empty
 * rendered email. This is the runtime side of the static
 * `Record<AftercareStep, Copy>` type-level constraint in the template,
 * and it also doubles as a smoke test for the React Email renderer.
 *
 * Validates: Requirements 4.7, 4.10
 *
 * Note: the spec also names `STEP_TITLE` (in `@/emails/dispatch`) and
 * `AFTERCARE_HEADLINE` (in `@/lib/telegram/notifications`) as targets for
 * Property 8, but those maps are module-private. The TypeScript
 * `Record<AftercareStep, ...>` typing is what statically forces them to
 * cover every step; the dispatch / Telegram unit tests in
 * `lib/aftercare/reminders.test.ts` exercise the runtime side via the
 * `notification_log.type === \`aftercare_${step}\`` assertion.
 */
import { describe, expect, it } from "vitest";
import React from "react";

import AftercareStepEmail from "./aftercare-step";
import { AFTERCARE_STEPS } from "@/lib/aftercare/time";
import { renderEmail } from "./render";

describe("AftercareStepEmail — static-map completeness (Property 8)", () => {
    it.each(AFTERCARE_STEPS)(
        "step %s renders a non-empty email with a Russian heading and lead",
        async (step) => {
            const { html, text } = await renderEmail(
                React.createElement(AftercareStepEmail, {
                    customerFirstName: "Алина",
                    piercingDate: "2026-05-14",
                    piercingTypeLabel: "Прокол хеликса",
                    guideHandle: "helix",
                    guideUrl: "https://piercerkzn.ru/aftercare/helix",
                    step,
                })
            );

            // Cyrillic content is mandatory — copy is Russian-only.
            expect(html).toMatch(/[А-Яа-яЁё]/u);
            expect(text).toMatch(/[А-Яа-яЁё]/u);

            // Customer name + piercing-date snapshot must reach the body.
            expect(html).toContain("Алина");
            expect(html).toContain("2026-05-14");

            // Render must produce real HTML, not an empty document.
            expect(html.length).toBeGreaterThan(500);
            expect(text.trim().length).toBeGreaterThan(50);
        }
    );

    it("AFTERCARE_STEPS is the canonical 7-element chronological tuple", () => {
        // Belt-and-suspenders: the tuple shape used to drive every map in
        // the pipeline. If a future migration shrinks or reorders this list
        // without updating the corresponding maps, the per-step `it.each`
        // above will flag it.
        expect(AFTERCARE_STEPS).toHaveLength(7);
        expect([...AFTERCARE_STEPS]).toEqual([
            "day1",
            "day3",
            "day7",
            "day14",
            "day30",
            "day60",
            "day90",
        ]);
    });
});
