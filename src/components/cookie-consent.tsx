"use client";

/**
 * Cookie consent banner — two-toggle form (analytics + replay) backed by
 * `@/lib/consent`. Hidden once the user has decided; reappears if the
 * storage key bumps.
 *
 * Intentionally minimal styling: a fixed-bottom bar with a brief copy
 * block, two checkboxes, and Accept-All / Save-Choices / Reject-All
 * buttons. Pages that want a richer drawer can dispatch
 * `window.dispatchEvent(new Event("pkzn:open-consent"))` to re-open it.
 */
import { useEffect, useId, useState } from "react";

import {
    CONSENT_EVENT,
    readConsent,
    setConsent,
    subscribeConsent,
    type ConsentState,
} from "@/lib/consent";

const OPEN_EVENT = "pkzn:open-consent";

export function CookieConsentBanner() {
    const analyticsId = useId();
    const replayId = useId();
    const [state, setState] = useState<ConsentState>(() => readConsent());
    const [open, setOpen] = useState(false);
    const [analytics, setAnalytics] = useState(state.analytics);
    const [replay, setReplay] = useState(state.replay);

    useEffect(() => {
        // Initial read from external mutable state (localStorage). The
        // useState() initialisers above cover SSR; this effect picks up
        // a write that may have happened between mount and hydration.
        const s = readConsent();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(s);
        setAnalytics(s.analytics);
        setReplay(s.replay);
        setOpen(!s.decided);

        const unsub = subscribeConsent((next) => {
            setState(next);
            setAnalytics(next.analytics);
            setReplay(next.replay);
            if (next.decided) setOpen(false);
        });
        const openHandler = () => {
            const fresh = readConsent();
            setAnalytics(fresh.analytics);
            setReplay(fresh.replay);
            setOpen(true);
        };
        window.addEventListener(OPEN_EVENT, openHandler);
        return () => {
            unsub();
            window.removeEventListener(OPEN_EVENT, openHandler);
        };
    }, []);

    if (!open) return null;

    const onAcceptAll = () => {
        setConsent({ analytics: true, replay: true });
    };
    const onRejectAll = () => {
        setConsent({ analytics: false, replay: false });
    };
    const onSave = () => {
        setConsent({ analytics, replay });
    };

    return (
        <div
            role="dialog"
            aria-labelledby={`${analyticsId}-title`}
            aria-describedby={`${analyticsId}-desc`}
            data-pkzn-consent
            style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 9999,
                background: "var(--surface, #111)",
                color: "var(--text-on-surface, #fff)",
                borderTop: "1px solid var(--border, #2a2a2a)",
                padding: "1rem 1.25rem",
                fontSize: "0.95rem",
                lineHeight: 1.45,
                boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.25)",
            }}
        >
            <div
                style={{
                    maxWidth: "72rem",
                    margin: "0 auto",
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: "0.75rem",
                }}
            >
                <div>
                    <strong id={`${analyticsId}-title`}>Куки и аналитика</strong>
                    <p id={`${analyticsId}-desc`} style={{ margin: "0.25rem 0 0" }}>
                        Мы используем cookies, чтобы запоминать корзину и логин. Дополнительно мы
                        хотели бы собирать обезличенную статистику посещений (PostHog) и при вашем
                        согласии записывать сессии — это помогает улучшать сайт. Согласия
                        раздельные; их можно изменить в любой момент в подвале.
                    </p>
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: "1.25rem",
                        flexWrap: "wrap",
                        alignItems: "center",
                    }}
                >
                    <label
                        htmlFor={analyticsId}
                        style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}
                    >
                        <input
                            id={analyticsId}
                            type="checkbox"
                            checked={analytics}
                            onChange={(e) => setAnalytics(e.target.checked)}
                        />
                        <span>Аналитика (PostHog: посещения, web vitals)</span>
                    </label>
                    <label
                        htmlFor={replayId}
                        style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}
                    >
                        <input
                            id={replayId}
                            type="checkbox"
                            checked={replay}
                            onChange={(e) => setReplay(e.target.checked)}
                            disabled={!analytics}
                            title={!analytics ? "Сначала включите аналитику" : undefined}
                        />
                        <span>Запись сессий (опционально)</span>
                    </label>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button type="button" onClick={onAcceptAll} style={primaryBtn}>
                        Принять всё
                    </button>
                    <button type="button" onClick={onSave} style={secondaryBtn}>
                        Сохранить выбор
                    </button>
                    <button type="button" onClick={onRejectAll} style={textBtn}>
                        Отклонить всё
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Re-open the consent banner from anywhere (e.g. a "Cookie preferences"
 * link in the footer).
 */
export function openCookieConsent(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(OPEN_EVENT));
}

// ---------------------------------------------------------------------------
// Tiny inline styles — keep the banner self-contained so it works pre-CSS
// hydration. Real theming is fine to layer later via CSS modules.
// ---------------------------------------------------------------------------
const primaryBtn: React.CSSProperties = {
    border: "1px solid transparent",
    background: "var(--accent, #d6c79b)",
    color: "var(--accent-on, #111)",
    padding: "0.5rem 1rem",
    borderRadius: "0.4rem",
    cursor: "pointer",
    fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
    border: "1px solid var(--border, #2a2a2a)",
    background: "transparent",
    color: "inherit",
    padding: "0.5rem 1rem",
    borderRadius: "0.4rem",
    cursor: "pointer",
};
const textBtn: React.CSSProperties = {
    ...secondaryBtn,
    borderColor: "transparent",
    opacity: 0.8,
};

// Re-export so other components don't import from `@/lib/consent` directly.
export { CONSENT_EVENT };
