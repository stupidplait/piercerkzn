/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    CONSENT_EVENT,
    CONSENT_STORAGE_KEY,
    readConsent,
    setConsent,
    subscribeConsent,
} from "./consent";

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("consent — readConsent", () => {
    it("returns defaults when nothing is stored", () => {
        expect(readConsent()).toEqual({
            decided: false,
            analytics: false,
            replay: false,
            updatedAt: 0,
        });
    });

    it("ignores malformed JSON", () => {
        localStorage.setItem(CONSENT_STORAGE_KEY, "{not json");
        expect(readConsent().decided).toBe(false);
    });

    it("rejects non-boolean coercions on each flag", () => {
        localStorage.setItem(
            CONSENT_STORAGE_KEY,
            JSON.stringify({ decided: "yes", analytics: 1, replay: "true", updatedAt: -3 })
        );
        const state = readConsent();
        expect(state.decided).toBe(false);
        expect(state.analytics).toBe(false);
        expect(state.replay).toBe(false);
        expect(state.updatedAt).toBe(0);
    });
});

describe("consent — setConsent", () => {
    it("persists the patch with decided=true + updatedAt timestamp", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-14T00:00:00Z"));

        const next = setConsent({ analytics: true });
        expect(next.decided).toBe(true);
        expect(next.analytics).toBe(true);
        expect(next.replay).toBe(false);
        expect(next.updatedAt).toBe(Date.UTC(2026, 4, 14));

        const reread = readConsent();
        expect(reread).toEqual(next);
    });

    it("merges with the previous state — only patched fields change", () => {
        setConsent({ analytics: true, replay: true });
        setConsent({ replay: false });
        const state = readConsent();
        expect(state.analytics).toBe(true);
        expect(state.replay).toBe(false);
    });

    it("dispatches a CONSENT_EVENT with the new state", () => {
        const listener = vi.fn();
        window.addEventListener(CONSENT_EVENT, listener);
        setConsent({ analytics: true });
        expect(listener).toHaveBeenCalledOnce();
        const evt = listener.mock.calls[0][0] as CustomEvent;
        expect(evt.detail.analytics).toBe(true);
        window.removeEventListener(CONSENT_EVENT, listener);
    });
});

describe("consent — subscribeConsent", () => {
    it("calls the listener on each setConsent", () => {
        const listener = vi.fn();
        const unsub = subscribeConsent(listener);
        setConsent({ analytics: true });
        setConsent({ replay: true });
        expect(listener).toHaveBeenCalledTimes(2);
        unsub();
    });

    it("stops calling the listener after unsubscribe", () => {
        const listener = vi.fn();
        const unsub = subscribeConsent(listener);
        unsub();
        setConsent({ analytics: true });
        expect(listener).not.toHaveBeenCalled();
    });
});
