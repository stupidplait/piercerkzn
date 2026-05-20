"use client";

/**
 * Telegram Mini-App context provider.
 *
 * Wraps the `window.Telegram.WebApp` SDK in a typed React hook so the
 * visualizer page (and future Phase 5b 3D-UI code) can call
 * `MainButton`, `BackButton`, `HapticFeedback`, and read `themeParams`
 * without reaching into globals or null-checking on every render.
 *
 * Behaviour:
 *   - On mount, calls `WebApp.ready()` and `WebApp.expand()` once when
 *     `window.Telegram?.WebApp` is present. Both are idempotent in
 *     Telegram's SDK so React 19 Strict Mode double-mount is harmless.
 *   - Stamps every `themeParams` key onto `document.documentElement.style`
 *     as `--tg-theme-{snake_case_key}`. Subscribes to the `themeChanged`
 *     event and re-stamps on every emit.
 *   - On unmount, unsubscribes from `themeChanged` and clears the stamped
 *     CSS variables so non-Mini routes never see them.
 *   - Outside Telegram (`window.Telegram?.WebApp` undefined), the hook
 *     returns `{ isMini: false, … }` with **referentially-stable** no-op
 *     stubs for `mainButton`, `backButton`, `hapticFeedback`, `close`,
 *     and `ready`. Callers therefore never need to null-check.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.4
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TelegramThemeParams {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
    header_bg_color?: string;
    accent_text_color?: string;
    section_bg_color?: string;
    section_header_text_color?: string;
    subtitle_text_color?: string;
    destructive_text_color?: string;
}

export interface MainButtonAPI {
    setText(text: string): void;
    show(): void;
    hide(): void;
    onClick(handler: () => void): () => void;
    enable(): void;
    disable(): void;
}

export interface BackButtonAPI {
    show(): void;
    hide(): void;
    onClick(handler: () => void): () => void;
}

export type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
export type HapticNotificationType = "error" | "success" | "warning";

export interface HapticFeedbackAPI {
    impactOccurred(style: HapticImpactStyle): void;
    notificationOccurred(type: HapticNotificationType): void;
    selectionChanged(): void;
}

export interface TelegramWebAppState {
    isMini: boolean;
    initData: string | null;
    themeParams: TelegramThemeParams;
    mainButton: MainButtonAPI;
    backButton: BackButtonAPI;
    hapticFeedback: HapticFeedbackAPI;
    close(): void;
    ready(): void;
}

// ---------------------------------------------------------------------------
// Module-scoped no-op fallbacks
// ---------------------------------------------------------------------------
//
// Defined once at module load so they are referentially stable across
// renders — calling them on every render does not invalidate downstream
// `useEffect` deps. This is what makes Requirement 7.4 ("callers never
// need to null-check") actually true in practice.

const noop = (): void => {};
const noopReturningDisposer = (_handler: () => void): (() => void) => noop;

const noopMainButton: MainButtonAPI = {
    setText: noop,
    show: noop,
    hide: noop,
    onClick: noopReturningDisposer,
    enable: noop,
    disable: noop,
};

const noopBackButton: BackButtonAPI = {
    show: noop,
    hide: noop,
    onClick: noopReturningDisposer,
};

const noopHaptic: HapticFeedbackAPI = {
    impactOccurred: noop,
    notificationOccurred: noop,
    selectionChanged: noop,
};

const NO_OP_STATE: TelegramWebAppState = {
    isMini: false,
    initData: null,
    themeParams: {},
    mainButton: noopMainButton,
    backButton: noopBackButton,
    hapticFeedback: noopHaptic,
    close: noop,
    ready: noop,
};

// ---------------------------------------------------------------------------
// Telegram SDK shape we consume (kept narrow on purpose)
// ---------------------------------------------------------------------------

interface TelegramWebAppSDK {
    initData: string;
    themeParams: TelegramThemeParams;
    ready(): void;
    expand(): void;
    close(): void;
    onEvent(event: string, handler: () => void): void;
    offEvent(event: string, handler: () => void): void;
    MainButton: {
        setText(text: string): void;
        show(): void;
        hide(): void;
        onClick(handler: () => void): void;
        offClick(handler: () => void): void;
        enable(): void;
        disable(): void;
    };
    BackButton: {
        show(): void;
        hide(): void;
        onClick(handler: () => void): void;
        offClick(handler: () => void): void;
    };
    HapticFeedback?: {
        impactOccurred(style: HapticImpactStyle): void;
        notificationOccurred(type: HapticNotificationType): void;
        selectionChanged(): void;
    };
}

declare global {
    interface Window {
        Telegram?: { WebApp?: TelegramWebAppSDK };
    }
}

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

const TelegramWebAppContext = createContext<TelegramWebAppState>(NO_OP_STATE);

function getWebApp(): TelegramWebAppSDK | null {
    if (typeof window === "undefined") return null;
    return window.Telegram?.WebApp ?? null;
}

function stampThemeParams(params: TelegramThemeParams): string[] {
    if (typeof document === "undefined") return [];
    const stamped: string[] = [];
    for (const [key, value] of Object.entries(params)) {
        if (typeof value !== "string") continue;
        const cssVar = `--tg-theme-${key.replace(/_/gu, "-")}`;
        document.documentElement.style.setProperty(cssVar, value);
        stamped.push(cssVar);
    }
    return stamped;
}

function clearThemeParams(varNames: string[]): void {
    if (typeof document === "undefined") return;
    for (const v of varNames) {
        document.documentElement.style.removeProperty(v);
    }
}

function buildState(sdk: TelegramWebAppSDK): TelegramWebAppState {
    const mainButton: MainButtonAPI = {
        setText: (text) => sdk.MainButton.setText(text),
        show: () => sdk.MainButton.show(),
        hide: () => sdk.MainButton.hide(),
        onClick: (handler) => {
            sdk.MainButton.onClick(handler);
            return () => sdk.MainButton.offClick(handler);
        },
        enable: () => sdk.MainButton.enable(),
        disable: () => sdk.MainButton.disable(),
    };

    const backButton: BackButtonAPI = {
        show: () => sdk.BackButton.show(),
        hide: () => sdk.BackButton.hide(),
        onClick: (handler) => {
            sdk.BackButton.onClick(handler);
            return () => sdk.BackButton.offClick(handler);
        },
    };

    const hapticFeedback: HapticFeedbackAPI = sdk.HapticFeedback
        ? {
              impactOccurred: (style) => sdk.HapticFeedback?.impactOccurred(style),
              notificationOccurred: (type) => sdk.HapticFeedback?.notificationOccurred(type),
              selectionChanged: () => sdk.HapticFeedback?.selectionChanged(),
          }
        : noopHaptic;

    return {
        isMini: true,
        initData: sdk.initData ?? null,
        themeParams: sdk.themeParams ?? {},
        mainButton,
        backButton,
        hapticFeedback,
        close: () => sdk.close(),
        ready: () => sdk.ready(),
    };
}

export function TelegramWebAppProvider({ children }: { children: ReactNode }) {
    // The state itself is computed from the SDK on mount. Outside Telegram
    // we simply leave `NO_OP_STATE` in place forever.
    const [state, setState] = useState<TelegramWebAppState>(NO_OP_STATE);

    useEffect(() => {
        const sdk = getWebApp();
        if (!sdk) return;

        // ready() + expand() are idempotent per Telegram's docs.
        try {
            sdk.ready();
            sdk.expand();
        } catch {
            // Telegram clients prior to 6.1 may throw on expand(); ignore.
        }

        const stamped = stampThemeParams(sdk.themeParams ?? {});
        const stampedRef = { current: stamped };

        const onThemeChanged = () => {
            // Clear previously-stamped vars to avoid stale leftovers when
            // Telegram drops a parameter, then re-stamp the current set.
            clearThemeParams(stampedRef.current);
            stampedRef.current = stampThemeParams(sdk.themeParams ?? {});
            setState((prev) => ({
                ...prev,
                themeParams: { ...sdk.themeParams },
            }));
        };
        sdk.onEvent("themeChanged", onThemeChanged);

        setState(buildState(sdk));

        return () => {
            sdk.offEvent("themeChanged", onThemeChanged);
            clearThemeParams(stampedRef.current);
        };
    }, []);

    // The state object passed to the context is treated as a stable
    // reference between SDK events. We memoize on its own identity so the
    // provider doesn't churn consumers when an unrelated parent re-renders.
    const value = useMemo(() => state, [state]);

    return (
        <TelegramWebAppContext.Provider value={value}>{children}</TelegramWebAppContext.Provider>
    );
}

/**
 * Read the Telegram WebApp state. Always returns a stable object — outside
 * Telegram the no-op state is returned, so callers never have to null-check.
 */
export function useTelegramWebApp(): TelegramWebAppState {
    return useContext(TelegramWebAppContext);
}
