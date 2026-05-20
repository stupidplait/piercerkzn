/**
 * Unit tests for setup-telegram-menu.ts idempotency.
 *
 * Validates Property: 12
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Mock the db/load-env import to avoid side effects
vi.mock("../src/db/load-env", () => ({}));

const fetchMock = vi.fn(async () => ({
    json: async () => ({ ok: true }),
}));

describe("setup-telegram-menu (Property 12)", () => {
    beforeAll(() => {
        vi.stubGlobal("fetch", fetchMock);
        process.env.TELEGRAM_BOT_TOKEN = "test:token";
        process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    });

    afterEach(() => {
        fetchMock.mockClear();
    });

    it("setMyCommands contains /visualizer and setChatMenuButton targets the visualizer URL", async () => {
        vi.resetModules();
        vi.mock("../src/db/load-env", () => ({}));
        await import("../scripts/setup-telegram-menu");
        await new Promise((r) => setTimeout(r, 100));

        // setChatMenuButton
        const menuCall = fetchMock.mock.calls.find((c) =>
            (c[0] as string).includes("setChatMenuButton")
        );
        expect(menuCall).toBeDefined();
        const menuBody = JSON.parse(menuCall![1]!.body as string);
        expect(menuBody.menu_button.type).toBe("web_app");
        expect(menuBody.menu_button.web_app.url).toBe("https://example.test/visualizer?tgmini=1");

        // setMyCommands
        const cmdCall = fetchMock.mock.calls.find((c) =>
            (c[0] as string).includes("setMyCommands")
        );
        expect(cmdCall).toBeDefined();
        const cmdBody = JSON.parse(cmdCall![1]!.body as string);
        const visualizerCmd = cmdBody.commands.find(
            (c: { command: string }) => c.command === "visualizer"
        );
        expect(visualizerCmd).toEqual({
            command: "visualizer",
            description: "Открыть 3D-примерку",
        });
        // 5 commands total
        expect(cmdBody.commands).toHaveLength(5);
    });

    it("rejects when NEXT_PUBLIC_SITE_URL is missing", async () => {
        const saved = process.env.NEXT_PUBLIC_SITE_URL;
        delete process.env.NEXT_PUBLIC_SITE_URL;

        vi.resetModules();
        vi.mock("../src/db/load-env", () => ({}));

        const exitMock = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
        const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

        await import("../scripts/setup-telegram-menu");
        await new Promise((r) => setTimeout(r, 100));

        expect(exitMock).toHaveBeenCalledWith(1);
        exitMock.mockRestore();
        errorMock.mockRestore();
        process.env.NEXT_PUBLIC_SITE_URL = saved;
    });
});
