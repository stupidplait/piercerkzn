"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Effect, BlendFunction } from "postprocessing";
import { Uniform, Texture } from "three";
import { FluidSimulation } from "./FluidSimulation";

/* ================================================================
   GPU post-processing shader that combines:
   1. Fluid cursor trail (UV displacement + brightness)
   2. Reveal shockwave — a refractive expanding circle that:
      - Displaces UVs outward from center (lens bulge)
      - Applies heavy chromatic aberration at the wavefront
      - Mixes between black (preloader) and scene color
      - Creates the "born through glass" transition effect
   ================================================================ */

const fragmentShader = /* glsl */ `
uniform sampler2D uFluidTex;
uniform float uIsDark;

// Reveal shockwave uniforms
uniform float uRevealRadius;     // 0 = hidden, 1+ = fully revealed
uniform float uRevealStrength;   // displacement intensity (decays over time)
uniform float uRevealActive;     // 1.0 when reveal is in progress

void mainUv(inout vec2 uv) {
    // Fluid cursor trail displacement
    vec2 fluid = texture2D(uFluidTex, uv).xy;
    uv += fluid * 0.004;

    // Reveal shockwave — push content outside the expanding radius
    // outward with extreme force, creating a natural "wipe" effect.
    // No black mask needed — the stretching itself clears the content.
    if (uRevealActive > 0.0) {
        vec2 center = vec2(0.5);
        vec2 fromCenter = uv - center;
        float dist = length(fromCenter);
        vec2 dir = normalize(fromCenter + vec2(1e-6));

        float edge = uRevealRadius * 0.7;

        // Content OUTSIDE the expanding circle: push outward aggressively.
        // Strength increases with distance from the wavefront edge.
        float outsideness = smoothstep(edge - 0.02, edge + 0.15, dist);
        uv += dir * outsideness * uRevealStrength * 0.8;

        // Wavefront ring: refractive lens bulge at the transition edge
        float ringWidth = 0.06 + uRevealRadius * 0.05;
        float ring = exp(-pow((dist - edge) / ringWidth, 2.0));
        uv += dir * ring * uRevealStrength * 0.35;
    }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 fluid = texture2D(uFluidTex, uv).xy;
    float fluidsLength = length(fluid);

    // Fluid trail brightness
    float effect = fluidsLength * 1.5;
    float multiplier = mix(1.0 - effect * 0.15, 1.0 + effect, uIsDark);
    vec3 col = inputColor.rgb * multiplier;

    // Reveal shockwave chromatic aberration
    if (uRevealActive > 0.0) {
        vec2 center = vec2(0.5);
        vec2 fromCenter = uv - center;
        float dist = length(fromCenter);

        float edge = uRevealRadius * 0.7;
        float ringWidth = 0.06 + uRevealRadius * 0.05;
        float ring = exp(-pow((dist - edge) / ringWidth, 2.0));

        // RGB splitting at wavefront — sample ALL channels from inputBuffer
        // to avoid green tint from mixing raw/processed channels
        vec2 dir = normalize(fromCenter + vec2(1e-6));
        float caStrength = ring * uRevealStrength * 0.08;
        vec2 uvR = uv + dir * caStrength;
        vec2 uvB = uv - dir * caStrength;

        float rChannel = texture2D(inputBuffer, uvR).r;
        float gChannel = texture2D(inputBuffer, uv).g;
        float bChannel = texture2D(inputBuffer, uvB).b;
        col = vec3(rChannel, gChannel, bChannel) * multiplier;
    }

    outputColor = vec4(col, inputColor.a);
}
`;

class FluidTrailEffectImpl extends Effect {
    constructor(fluidTexture: Texture) {
        const uniforms = new Map<string, Uniform>([
            ["uFluidTex", new Uniform(fluidTexture)],
            ["uIsDark", new Uniform(1.0)],
            ["uRevealRadius", new Uniform(0.0)],
            ["uRevealStrength", new Uniform(0.0)],
            ["uRevealActive", new Uniform(0.0)],
        ]);
        super("FluidTrailEffect", fragmentShader, {
            blendFunction: BlendFunction.NORMAL,
            uniforms,
        });
    }

    set fluidTexture(tex: Texture) {
        this.uniforms.get("uFluidTex")!.value = tex;
    }

    set isDark(v: boolean) {
        this.uniforms.get("uIsDark")!.value = v ? 1.0 : 0.0;
    }

    set revealRadius(v: number) {
        this.uniforms.get("uRevealRadius")!.value = v;
    }

    set revealStrength(v: number) {
        this.uniforms.get("uRevealStrength")!.value = v;
    }

    set revealActive(v: boolean) {
        this.uniforms.get("uRevealActive")!.value = v ? 1.0 : 0.0;
    }
}

export interface FluidTrailHandle {
    burst: (intensity?: number, frames?: number) => void;
}

const FluidTrailEffect = forwardRef<
    FluidTrailHandle,
    { mouseRef: React.RefObject<{ x: number; y: number }>; isDark?: boolean; revealed?: boolean }
>(function FluidTrailEffect({ mouseRef, isDark = true, revealed = false }, ref) {
    const { gl } = useThree();
    const sim = useMemo(() => new FluidSimulation(), []);
    const effect = useMemo(() => new FluidTrailEffectImpl(sim.texture), [sim]);
    const prevMouse = useRef({ x: 0.5, y: 0.5 });
    const burstFired = useRef(false);
    const revealStart = useRef<number | null>(null);

    // Expose burst method via ref
    useImperativeHandle(
        ref,
        () => ({
            burst: (intensity?: number, frames?: number) => sim.burst(intensity, frames),
        }),
        [sim]
    );

    // Start reveal animation when revealed becomes true
    useEffect(() => {
        if (revealed && !burstFired.current) {
            burstFired.current = true;
            revealStart.current = performance.now();
            sim.burst(1.2, 60);
            effect.revealActive = true;
        }
    }, [revealed, sim, effect]);

    useEffect(() => {
        return () => sim.dispose();
    }, [sim]);

    useFrame((_, delta) => {
        const m = mouseRef.current;
        const dt = Math.min(delta, 0.05);

        // Map mouse from [-1,1] to [0,1] UV space
        const mx = m.x * 0.5 + 0.5;
        const my = m.y * 0.5 + 0.5;

        const vx = (mx - prevMouse.current.x) * 20;
        const vy = (my - prevMouse.current.y) * 20;
        prevMouse.current.x = mx;
        prevMouse.current.y = my;

        sim.setPointer(mx, my, vx, vy);
        sim.compute(gl, dt);

        // Drive reveal shockwave animation
        if (revealStart.current !== null) {
            const elapsed = (performance.now() - revealStart.current) / 1000;
            const duration = 1.8; // seconds — snappy, not laggy

            if (elapsed < duration) {
                const t = elapsed / duration;
                // Smooth ease-out for radius expansion
                const eased = 1 - Math.pow(1 - t, 3);

                // Radius goes from 0 to ~1.8 (overshoots viewport to fully clear)
                effect.revealRadius = eased * 1.8;

                // Displacement strength: starts strong, decays smoothly
                effect.revealStrength = (1 - eased) * 4.0;
            } else {
                // Reveal complete — disable shader path
                effect.revealRadius = 2.0;
                effect.revealStrength = 0;
                effect.revealActive = false;
                revealStart.current = null;
            }
        }

        // Update uniforms each frame
        effect.fluidTexture = sim.texture;
        effect.isDark = isDark;
    });

    return <primitive ref={null} object={effect} />;
});

export default FluidTrailEffect;
