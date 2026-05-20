"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

/**
 * Cinematic transition overlay.
 *
 * Three layered effects driven by scrollPhase (0→1):
 *   • Portal scale — radial mask expands outward, simulating the camera
 *     punching forward through the hero ring into Chapter 1.
 *   • Particle dust — soft warm-tinted dots drift down, seeded as the
 *     wordmark dissolves.
 *   • Warm light — radial accent gradient "switches on" at p≈0.5, sells
 *     the "showcase lit up" beat.
 */
interface PortalTransitionProps {
    scrollPhase: React.RefObject<number>;
}

const PARTICLE_COUNT = 28;

export default function PortalTransition({ scrollPhase }: PortalTransitionProps) {
    const portalRef = useRef<HTMLDivElement | null>(null);
    const lightRef = useRef<HTMLDivElement | null>(null);
    const particlesRef = useRef<HTMLDivElement | null>(null);
    const [armed, setArmed] = useState(false);

    useEffect(() => {
        let raf = 0;
        const tick = () => {
            const p = scrollPhase.current ?? 0;
            if (!armed && p > 0.02) setArmed(true);

            // Portal — radial reveal from p=0.3 to p=1. clip-path circle
            // expands from 0% to 110% (slightly past the corner).
            const portalP = Math.max(0, Math.min(1, (p - 0.3) / 0.7));
            const portalScale = portalP * 110;
            const portalOpacity = armed ? Math.min(1, portalP * 1.4) : 0;

            if (portalRef.current) {
                portalRef.current.style.opacity = portalOpacity.toFixed(3);
                portalRef.current.style.clipPath = `circle(${portalScale.toFixed(1)}% at 50% 50%)`;
            }

            // Warm light — soft sigmoid switching on around p=0.5
            const lightP = 1 / (1 + Math.exp(-12 * (p - 0.5)));
            const lightOpacity = armed ? lightP * 0.7 : 0;

            if (lightRef.current) {
                lightRef.current.style.opacity = lightOpacity.toFixed(3);
            }

            // Particle layer — opacity bell curve, peaks ~p=0.55
            const particlesP = armed ? Math.max(0, Math.sin(Math.PI * p)) : 0;

            if (particlesRef.current) {
                particlesRef.current.style.opacity = particlesP.toFixed(3);
            }

            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [armed, scrollPhase]);

    return (
        <div className={styles.portalLayer} aria-hidden="true">
            <div ref={lightRef} className={styles.portalWarmLight} />
            <div ref={particlesRef} className={styles.portalParticles}>
                {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
                    <span
                        key={i}
                        className={styles.portalParticle}
                        style={{
                            // Deterministic but varied placements (sin/cos
                            // of i) — no Math.random so SSR/CSR match.
                            left: `${(50 + Math.sin(i * 1.7) * 42 + Math.cos(i * 0.8) * 5).toFixed(2)}%`,
                            top: `${(50 + Math.cos(i * 1.3) * 30 + Math.sin(i * 0.6) * 8).toFixed(2)}%`,
                            animationDelay: `${(i * 0.13).toFixed(2)}s`,
                            animationDuration: `${(3 + (i % 5) * 0.4).toFixed(2)}s`,
                        }}
                    />
                ))}
            </div>
            <div ref={portalRef} className={styles.portalRing} />
        </div>
    );
}
