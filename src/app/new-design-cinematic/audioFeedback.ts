"use client";

/**
 * Subtle audio feedback using Web Audio API.
 * Synthesizes a short, soft "tick" — no external audio files needed.
 *
 * Respects prefers-reduced-motion: if the user has reduced motion
 * enabled, sound feedback is also suppressed (vestibular sensitivity
 * often correlates with audio sensitivity).
 *
 * Usage: playSwapTick()
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    // Respect reduced motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch {
            return null;
        }
    }
    return ctx;
}

/**
 * Plays a subtle "tick" sound — a very short sine burst at ~3400Hz
 * with rapid exponential decay. Volume is kept low (0.08) so it
 * functions as feedback, not distraction.
 */
export function playSwapTick(): void {
    const ac = getContext();
    if (!ac) return;

    // Resume context if suspended (autoplay policy)
    if (ac.state === "suspended") {
        ac.resume().catch(() => {});
    }

    const now = ac.currentTime;

    // Oscillator: short sine pulse
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(3400, now);
    // Slight pitch drop for organic feel
    osc.frequency.exponentialRampToValueAtTime(2800, now + 0.06);

    // Gain: fast attack, rapid decay
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.004); // 4ms attack
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06); // 60ms decay

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start(now);
    osc.stop(now + 0.08);
}
