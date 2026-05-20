/**
 * Integration tests for /visualizer layout chrome stripping.
 *
 * Validates Properties: 6, 14
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock next/headers
let mockHeaders: Record<string, string> = {};
let cookieSetCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];

vi.mock("next/headers", () => ({
    headers: async () => ({
        get: (name: string) => mockHeaders[name] ?? null,
    }),
    cookies: async () => ({
        get: () => undefined,
        set: (name: string, value: string, opts: Record<string, unknown>) => {
            cookieSetCalls.push({ name, value, opts });
        },
    }),
}));

vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) => (
        <a href={href}>{children}</a>
    ),
}));

import VisualizerLayout from "@/app/visualizer/layout";

describe("VisualizerLayout — chrome stripping (Property 6, 14)", () => {
    beforeEach(() => {
        mockHeaders = {};
        cookieSetCalls = [];
    });

    it("renders data-mini='1' and telegramThemed class when tgmini=1", async () => {
        mockHeaders["x-invoke-path"] = "/visualizer?tgmini=1";
        const Layout = await VisualizerLayout({ children: <p>child</p> });
        const { container } = render(Layout as React.ReactElement);
        const wrapper = container.firstElementChild as HTMLElement;
        expect(wrapper.getAttribute("data-mini")).toBe("1");
        expect(wrapper.className).toContain("telegramThemed");
        // No fallback header
        expect(container.querySelector("header")).toBeNull();
    });

    it("renders data-mini='0' and fallback header when not mini", async () => {
        mockHeaders["x-invoke-path"] = "/visualizer";
        const Layout = await VisualizerLayout({ children: <p>child</p> });
        const { container } = render(Layout as React.ReactElement);
        const wrapper = container.firstElementChild as HTMLElement;
        expect(wrapper.getAttribute("data-mini")).toBe("0");
        expect(wrapper.className || "").not.toContain("telegramThemed");
        // Fallback header with link to /
        const header = container.querySelector("header");
        expect(header).not.toBeNull();
        const link = header!.querySelector("a");
        expect(link?.getAttribute("href")).toBe("/");
        expect(link?.textContent).toContain("На сайт");
    });

    it("stamps the sticky cookie when tgmini=1 is in query", async () => {
        mockHeaders["x-invoke-path"] = "/visualizer?tgmini=1";
        await VisualizerLayout({ children: <p>child</p> });
        expect(cookieSetCalls.length).toBe(1);
        expect(cookieSetCalls[0].name).toBe("pkzn_tgmini");
        expect(cookieSetCalls[0].value).toBe("1");
        expect(cookieSetCalls[0].opts.maxAge).toBe(3600);
        expect(cookieSetCalls[0].opts.sameSite).toBe("lax");
    });
});
