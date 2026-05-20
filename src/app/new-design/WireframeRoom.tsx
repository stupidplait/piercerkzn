"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Edges, Environment, Lightformer, MeshTransmissionMaterial, Text } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import FluidTrailEffect from "./FluidTrailEffect";
import BodyModel, {
    ANCHORS_LOCAL,
    ANCHOR_DOTS_LOCAL,
    CH2_SCALE_BOOST,
    MODEL_SCALE,
    MODEL_Y_OFFSET,
} from "./BodyModel";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Detects prefers-reduced-motion at mount. Returns true if the user
 * has requested reduced motion (accessibility / vestibular disorders).
 */
function useReducedMotion(): boolean {
    // Use ref to avoid re-rendering the entire Canvas subtree when
    // prefers-reduced-motion changes at runtime (very rare event).
    const ref = useRef(false);
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
        ref.current = mql.matches;
        forceUpdate((n) => n + 1);
        const onChange = (e: MediaQueryListEvent) => {
            ref.current = e.matches;
            forceUpdate((n) => n + 1);
        };
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, []);
    return ref.current;
}

/**
 * Fires onReady after N rendered frames. Must be placed INSIDE a
 * Suspense boundary so it only mounts once suspended assets (fonts)
 * have loaded — this way it naturally combines "assets loaded" with
 * "GPU warmed up" into a single signal.
 */
function ReadinessSignal({ onReady, frames = 5 }: { onReady: () => void; frames?: number }) {
    const count = useRef(0);
    const fired = useRef(false);
    useFrame(() => {
        if (fired.current) return;
        count.current++;
        if (count.current >= frames) {
            fired.current = true;
            onReady();
        }
    });
    return null;
}

/**
 * Camera dolly — animates camera.position.z from a zoomed-in
 * starting position (closer to the torus) to the resting pull-back
 * position when `revealed` becomes true. Creates a cinematic
 * "emergence" where the viewer starts inside the scene and the
 * camera pulls out to reveal the full corridor.
 * Uses MathUtils.damp for smooth exponential decay (no overshoot).
 */
const DOLLY_OFFSET = -6; // units CLOSER at start (negative = toward back wall)
const DOLLY_LAMBDA = 1.5; // moderate decay — slower than default, still responsive
const FOV_START = 50; // narrow FOV at start (zoomed in)
const FOV_OVERSHOOT = 62; // briefly wider than rest (cinematic breathing)
const FOV_END = 60; // normal FOV at rest
const FOV_OVERSHOOT_DURATION = 0.5; // seconds to hold overshoot before settling

/* Chapter-1 pull-back — the camera dollies BACK away from the exhibit
   as the user scrolls hero→Chapter 1, revealing the full room around
   the fixed exhibit at the back. Hero is the intimate close-up of the
   exhibit; Chapter 1 is the wide gallery shot that contextualises it. */
const PULLBACK_DISTANCE = 16; // chapter 1 pullback — camera Z increases by this
const PULLBACK_CHAPTER_2 = 22; // chapter 2 pullback — bit further back than chapter 1
// so the zoom-out continues across chapters rather than
// lurching forward when leaving Chapter 1
const PULLBACK_CHAPTER_3 = 26; // chapter 3 pullback — final dolly back so the entire
// room frames the climax. Visitor sees the corridor
// they came through, the podium, the dossier in front.
/* EXHIBIT_Z sits *behind* the hero camera (-21) and *in front of* the
   chapter-1 camera (-5). In hero it's behind the lens (invisible);
   as the camera pulls back past z=-12 the podium organically comes
   into view in the lower half of frame. Tuned close to the chapter-1
   camera (distance 7) so the exhibit reads prominently without the
   need for a fade animation. */
const EXHIBIT_Z = -12;
const HERO_RING_Z = -27; // hero floating-ring position — close to camera for original size

/* Ring drifts back from HERO_RING_Z to EXHIBIT_Z as user scrolls hero→Ch1
   so it lands on the podium when the camera arrives at the wide gallery
   shot. Hero ring stays at original close-up size; chapter 1 ring sits
   on the exhibit. */

/* Ease-out cubic — fast initial burst, decelerating finish. Combined with
   the dolly damping below this gives a snappy, "very fast" feel at the
   start of the motion that settles cleanly into the final composition. */
function flyEasing(sp: number): number {
    const t = Math.max(0, Math.min(1, sp));
    return 1 - Math.pow(1 - t, 3);
}

/* Ch2 close-up framing constants. Head world Y derived from
   MODEL_Y_OFFSET + (head local Y) × MODEL_SCALE × CH2_SCALE_BOOST.
   With head local Y = 1.65 m: -2.25 + 1.65 × 4 × 2.6 = 14.91. */
const CH2_HEAD_LOCAL_Y = 1.65;
const CH2_ORBIT_RADIUS = 3.2;
const CH2_ORBIT_SPEED = 0.18; // rad/s — ~10°/s, post-storyboard
const CH2_FOV = 28; // narrow → portrait compression, walls outside cone

/* Smoothstep — eases the start and end of every keyframe segment so
   the multi-stage camera move flows instead of stepping. */
function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function CameraDolly({
    restZ,
    revealed,
    scrollPhase,
    ch2Phase,
    activeChapter,
    ch2T,
    reducedMotion = false,
    roomH,
}: {
    restZ: number;
    revealed: boolean;
    scrollPhase?: React.RefObject<number>;
    ch2Phase?: React.RefObject<number>;
    activeChapter?: React.RefObject<number>;
    ch2T?: React.RefObject<number>;
    reducedMotion?: boolean;
    roomH: number;
}) {
    const posZ = useRef(restZ + DOLLY_OFFSET);
    const posY = useRef(0);
    const fov = useRef(FOV_START);
    const revealedTime = useRef<number | null>(null);
    const _lookAt = useMemo(() => new THREE.Vector3(0, 0, 0), []);

    // Smooth lookAt Y for the floor-tilt transition
    const smoothLookAtY = useRef(0);
    const smoothLookAtZ = useRef(-34);

    useFrame(({ camera, clock }, delta) => {
        const dt = Math.min(delta, 0.05);
        const dollyLambda = reducedMotion ? DOLLY_LAMBDA * 20 : DOLLY_LAMBDA;
        const sp = scrollPhase?.current ?? 0;
        const ac = activeChapter?.current ?? 0;
        const ph2 = ch2Phase?.current ?? 0;

        // FOV overshoot then settle to FOV_END across all chapters.
        if (revealed && revealedTime.current === null) {
            revealedTime.current = performance.now();
        }
        const timeSinceReveal =
            revealedTime.current !== null ? (performance.now() - revealedTime.current) / 1000 : 0;
        const fovBase = revealed
            ? timeSinceReveal > FOV_OVERSHOOT_DURATION
                ? FOV_END
                : FOV_OVERSHOOT
            : FOV_START;

        // Hero / Ch1 pull-back baseline — used for stage A (start of
        // Ch2 transition) so the storyboard begins from wherever Ch1
        // settled.
        const pullbackT = Math.min(1, sp * 2);
        const ch1Pullback = ac === 0 ? flyEasing(pullbackT) * PULLBACK_DISTANCE : PULLBACK_DISTANCE;
        const ch1Z = revealed ? restZ + ch1Pullback : restZ + DOLLY_OFFSET;

        // Floor world Y (the camera will tip down to look at this).
        const floorY = -roomH / 2;
        // Head world Y once body is at full Ch2 scale.
        const headY = MODEL_Y_OFFSET + CH2_HEAD_LOCAL_Y * MODEL_SCALE * CH2_SCALE_BOOST;

        // ───────────────────────────────────────────────────────
        // Ch1 → Ch2 multi-stage storyboard, locked to scroll (ph2).
        // Stages A→D play out in the FIRST HALF of ph2 (0 → 0.5) so
        // the camera is already settled at the floor close-up by the
        // time Ch2Intro is centered. The remaining ph2 0.5 → 1.0 is
        // a held floor view — Ch2Intro reads as a "pause on the floor"
        // beat before the 2D grid slides up at Ch2's start.
        //
        //   stage A (0.00 → 0.10): camera flies further back from Ch1.
        //   stage B (0.10 → 0.22): tilt straight DOWN at the floor.
        //   stage C (0.22 → 0.36): descend toward the floor.
        //   stage D (0.36 → 0.50): final settle, gentle zoom.
        //   held    (0.50 → 1.00): camera stays at D values. Walls
        //                          fully faded; ring visible below
        //                          on the podium from the bird's-eye.
        //
        // Camera X stays at 0; Z stays at A_Z throughout B→D. Only
        // Y and pitch (lookAt) change after stage A.
        // ───────────────────────────────────────────────────────

        // Stage A — extra pull-back beyond Ch1, but kept INSIDE the
        // room so the camera's straight-down gaze in stage B catches
        // actual floor (the floor only extends from Z=-34 to Z=0).
        const A_Z = restZ + PULLBACK_DISTANCE + 2; // ≈ -3 — near front of room
        const A_Y = 0;
        const tA = smoothstep(0, 0.1, ph2);
        const stageA_Z = THREE.MathUtils.lerp(ch1Z, A_Z, tA);
        const stageA_Y = A_Y;

        // Stage B — tilt straight DOWN at the floor under the camera.
        const B_LOOK_Y = floorY + 0.2;
        const tB = smoothstep(0.1, 0.22, ph2);

        // Stage C — gentle descent. Less aggressive than before so
        // multiple major cells stay readable in frame.
        const C_Y = floorY + 9; // 9 units above floor (was 7)
        const C_FOV = 56; // wider (was 50)
        const tC = smoothstep(0.22, 0.36, ph2);

        // Stage D — final settle. Camera ~7 units above floor — close
        // enough to read the grid pattern, far enough that the 2D
        // grid hand-off has a similar cell density.
        const D_Y = floorY + 7; // 7 units above floor (was 5)
        const D_FOV = 52; // gentle narrowing (was 46)
        const tD = smoothstep(0.36, 0.5, ph2);

        // Compose camera position. X is locked at 0 across all stages.
        // Z stays at the flown-back A_Z. Only Y descends from B onward.
        let camY = stageA_Y;
        const camZ = stageA_Z;
        let lookY = 0;
        let lookZ = -34;
        let targetFov = fovBase;

        // Stage A → B — only the lookAt pitches down. Crucially the
        // lookAt's Z must equal the camera's Z so the gaze is straight
        // down (not forward toward the podium).
        lookY = THREE.MathUtils.lerp(lookY, B_LOOK_Y, tB);
        lookZ = THREE.MathUtils.lerp(lookZ, camZ, tB);

        // Stage B → C — descend
        camY = THREE.MathUtils.lerp(camY, C_Y, tC);
        targetFov = THREE.MathUtils.lerp(targetFov, C_FOV, tC);
        // lookAt's Z continues tracking camera Z so gaze stays straight down.
        lookZ = THREE.MathUtils.lerp(lookZ, camZ, tC);

        // Stage C → D — final descent + tighter FOV
        camY = THREE.MathUtils.lerp(camY, D_Y, tD);
        targetFov = THREE.MathUtils.lerp(targetFov, D_FOV, tD);
        lookZ = THREE.MathUtils.lerp(lookZ, camZ, tD);

        posZ.current = THREE.MathUtils.damp(posZ.current, camZ, dollyLambda, dt);
        posY.current = THREE.MathUtils.damp(posY.current, camY, 2.5, dt);
        camera.position.set(0, posY.current, posZ.current);

        // For straight-down gaze, lookAt.z must equal the actual
        // (damped) camera.z, not the target — otherwise during the
        // damping there's a slight angle. Use camera.position.z.
        const finalLookZ = THREE.MathUtils.lerp(-34, posZ.current, Math.max(tB, tC, tD));
        smoothLookAtY.current = THREE.MathUtils.damp(smoothLookAtY.current, lookY, 2.5, dt);
        smoothLookAtZ.current = THREE.MathUtils.damp(smoothLookAtZ.current, finalLookZ, 2.5, dt);
        _lookAt.set(0, smoothLookAtY.current, smoothLookAtZ.current);
        camera.lookAt(_lookAt);

        fov.current = THREE.MathUtils.damp(fov.current, targetFov, dollyLambda * 0.8, dt);
        if ("fov" in camera) {
            (camera as THREE.PerspectiveCamera).fov = fov.current;
            (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
    });
    return null;
}

/**
 * ChapterFade — derives the wall-fade ref from the scroll-driven
 * ch2Phase. Walls start fading when the camera tilts down to look
 * at the floor (stage B→C, ph2 = 0.45) and are fully gone by stage
 * D's midpoint (ph2 = 0.85). This locks wall visibility to scroll
 * progress instead of the discrete activeChapter snap.
 */
function ChapterFade({
    ch2Phase,
    ch2T,
}: {
    ch2Phase?: React.RefObject<number>;
    ch2T: React.RefObject<number>;
}) {
    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.05);
        const ph2 = ch2Phase?.current ?? 0;
        // Walls fade across stages B → end of C (camera tilts down +
        // descends). Done by ph2 ≈ 0.36 so the held floor view past
        // 0.5 has no wall remnants.
        const t = Math.max(0, Math.min(1, (ph2 - 0.1) / (0.36 - 0.1)));
        const target = t * t * (3 - 2 * t); // smoothstep
        ch2T.current = THREE.MathUtils.damp(ch2T.current, target, 4, dt);
    });
    return null;
}

/**
 * PinkRimLight — directional light gated by ch2Phase stage D. Reads
 * as a magenta catchlight on cheekbone + jewelry during the Ch2
 * close-up. Intensity ramps in only after the body has materialized
 * so the rim sweep coincides with the body becoming visible.
 */
function PinkRimLight({ ch2Phase }: { ch2Phase?: React.RefObject<number> }) {
    const ref = useRef<THREE.DirectionalLight>(null);
    useFrame(() => {
        if (!ref.current) return;
        const ph2 = ch2Phase?.current ?? 0;
        const t = Math.max(0, Math.min(1, (ph2 - 0.72) / (1.0 - 0.72)));
        const eased = t * t * (3 - 2 * t);
        ref.current.intensity = eased * 0.8;
    });
    return (
        <directionalLight
            ref={ref}
            position={[3, 16, EXHIBIT_Z + 4]}
            color="#f06ba0"
            intensity={0}
        />
    );
}

/* RoomRotation removed — walls are now static, no scroll-driven rotation */

/**
 * Parses a CSS color string (hex, rgb, rgba) into a THREE.Color
 * plus an alpha channel. THREE.Color itself ignores rgba alpha.
 */
function parseCssColor(
    input: string,
    fallback: { hex: string; alpha: number }
): { color: THREE.Color; alpha: number } {
    if (!input) {
        return {
            color: new THREE.Color(fallback.hex),
            alpha: fallback.alpha,
        };
    }

    const trimmed = input.trim();

    // 8-digit hex: #RRGGBBAA (some browsers return CSS rgba() vars in this form)
    const hex8 = trimmed.match(/^#([0-9a-f]{8})$/i);
    if (hex8) {
        const r = parseInt(hex8[1].slice(0, 2), 16) / 255;
        const g = parseInt(hex8[1].slice(2, 4), 16) / 255;
        const b = parseInt(hex8[1].slice(4, 6), 16) / 255;
        const a = parseInt(hex8[1].slice(6, 8), 16) / 255;
        return { color: new THREE.Color(r, g, b), alpha: a };
    }

    const rgbaMatch = trimmed.match(
        /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i
    );
    if (rgbaMatch) {
        const r = Number(rgbaMatch[1]) / 255;
        const g = Number(rgbaMatch[2]) / 255;
        const b = Number(rgbaMatch[3]) / 255;
        const a = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1;
        return { color: new THREE.Color(r, g, b), alpha: a };
    }

    try {
        return { color: new THREE.Color(trimmed), alpha: 1 };
    } catch {
        return {
            color: new THREE.Color(fallback.hex),
            alpha: fallback.alpha,
        };
    }
}

function FaceGrid({
    width,
    height,
    cellSize = 2,
    minorColor,
    minorAlpha,
    majorColor,
    majorAlpha,
    crossColor,
    crossAlpha,
    position,
    rotation,
    fadeOutRef,
}: {
    width: number;
    height: number;
    cellSize?: number;
    minorColor: THREE.Color;
    minorAlpha: number;
    majorColor: THREE.Color;
    majorAlpha: number;
    crossColor: THREE.Color;
    crossAlpha: number;
    position: [number, number, number];
    rotation?: [number, number, number];
    /* When set, multiplies all alphas by (1 - fadeOutRef.current) each
       frame. Used to fade walls out in Ch2 while leaving the floor
       (which doesn't pass this ref) at full alpha. */
    fadeOutRef?: React.RefObject<number>;
}) {
    const subsPerCell = 5;
    const divX = Math.round(width / cellSize) * subsPerCell;
    const divY = Math.round(height / cellSize) * subsPerCell;

    const { minorGeom, majorGeom, edgeMajorGeom, crossGeom } = useMemo(() => {
        const minor: number[] = [];
        const majorVerts: number[] = [];
        const edgeMajorVerts: number[] = [];
        const crossLines: number[] = [];
        const hw = width / 2;
        const hh = height / 2;
        const subSize = width / divX;
        const arm = subSize * 0.18;
        // Major line half-thickness for mesh quads
        const majorThick = subSize * 0.07;

        // Minor lines (thin lineSegments)
        for (let i = 0; i <= divX; i++) {
            const isEdge = i === 0 || i === divX;
            if (i % subsPerCell === 0 && !isEdge) continue; // skip interior majors, keep edges
            const x = -hw + (i / divX) * width;
            minor.push(x, -hh, 0, x, hh, 0);
        }
        for (let j = 0; j <= divY; j++) {
            const isEdge = j === 0 || j === divY;
            if (j % subsPerCell === 0 && !isEdge) continue;
            const y = -hh + (j / divY) * height;
            minor.push(-hw, y, 0, hw, y, 0);
        }

        // Major lines — split into interior and edge
        for (let i = 0; i <= divX; i += subsPerCell) {
            const x = -hw + (i / divX) * width;
            const isEdge = i === 0 || i === divX;
            const target = isEdge ? edgeMajorVerts : majorVerts;
            target.push(
                x - majorThick,
                -hh,
                0.001,
                x + majorThick,
                -hh,
                0.001,
                x + majorThick,
                hh,
                0.001,
                x - majorThick,
                -hh,
                0.001,
                x + majorThick,
                hh,
                0.001,
                x - majorThick,
                hh,
                0.001
            );
        }
        for (let j = 0; j <= divY; j += subsPerCell) {
            const y = -hh + (j / divY) * height;
            const isEdge = j === 0 || j === divY;
            const target = isEdge ? edgeMajorVerts : majorVerts;
            target.push(
                -hw,
                y - majorThick,
                0.001,
                hw,
                y - majorThick,
                0.001,
                hw,
                y + majorThick,
                0.001,
                -hw,
                y - majorThick,
                0.001,
                hw,
                y + majorThick,
                0.001,
                -hw,
                y + majorThick,
                0.001
            );
        }

        // + marks at interior intersections only (skip edges to avoid arms extending past walls)
        for (let i = subsPerCell; i < divX; i += subsPerCell) {
            for (let j = subsPerCell; j < divY; j += subsPerCell) {
                const cx = -hw + (i / divX) * width;
                const cy = -hh + (j / divY) * height;
                const z = 0.0015;
                // Horizontal arm
                crossLines.push(cx - arm, cy, z, cx + arm, cy, z);
                // Vertical arm
                crossLines.push(cx, cy - arm, z, cx, cy + arm, z);
            }
        }

        const minG = new THREE.BufferGeometry();
        minG.setAttribute("position", new THREE.Float32BufferAttribute(minor, 3));
        const majG = new THREE.BufferGeometry();
        majG.setAttribute("position", new THREE.Float32BufferAttribute(majorVerts, 3));
        const edgG = new THREE.BufferGeometry();
        edgG.setAttribute("position", new THREE.Float32BufferAttribute(edgeMajorVerts, 3));
        const crsG = new THREE.BufferGeometry();
        crsG.setAttribute("position", new THREE.Float32BufferAttribute(crossLines, 3));
        return { minorGeom: minG, majorGeom: majG, edgeMajorGeom: edgG, crossGeom: crsG };
    }, [width, height, divX, divY]);

    useEffect(() => {
        return () => {
            minorGeom.dispose();
            majorGeom.dispose();
            edgeMajorGeom.dispose();
            crossGeom.dispose();
        };
    }, [minorGeom, majorGeom, edgeMajorGeom, crossGeom]);

    const minorMatRef = useRef<THREE.LineBasicMaterial>(null);
    const majorMatRef = useRef<THREE.MeshBasicMaterial>(null);
    const edgeMatRef = useRef<THREE.MeshBasicMaterial>(null);
    const crossMatRef = useRef<THREE.LineBasicMaterial>(null);

    useFrame(() => {
        if (!fadeOutRef) return;
        const mult = 1 - fadeOutRef.current;
        if (minorMatRef.current) minorMatRef.current.opacity = minorAlpha * mult;
        if (majorMatRef.current) majorMatRef.current.opacity = majorAlpha * mult;
        if (edgeMatRef.current) edgeMatRef.current.opacity = majorAlpha * 0.25 * mult;
        if (crossMatRef.current) crossMatRef.current.opacity = crossAlpha * mult;
    });

    return (
        <group position={position} rotation={rotation}>
            <lineSegments geometry={minorGeom}>
                <lineBasicMaterial
                    ref={minorMatRef}
                    color={minorColor}
                    transparent
                    opacity={minorAlpha}
                    fog
                />
            </lineSegments>
            <mesh geometry={majorGeom}>
                <meshBasicMaterial
                    ref={majorMatRef}
                    color={majorColor}
                    transparent
                    opacity={majorAlpha}
                    side={THREE.DoubleSide}
                    fog
                />
            </mesh>
            <mesh geometry={edgeMajorGeom}>
                <meshBasicMaterial
                    ref={edgeMatRef}
                    color={majorColor}
                    transparent
                    opacity={majorAlpha * 0.25}
                    side={THREE.DoubleSide}
                    fog
                />
            </mesh>
            <lineSegments geometry={crossGeom}>
                <lineBasicMaterial
                    ref={crossMatRef}
                    color={crossColor}
                    transparent
                    opacity={crossAlpha}
                    fog
                />
            </lineSegments>
        </group>
    );
}

type ParsedColors = {
    bg: THREE.Color;
    minor: THREE.Color;
    minorAlpha: number;
    major: THREE.Color;
    majorAlpha: number;
    crossColor: THREE.Color;
    crossAlpha: number;
};

function useThemeColors(scopeRef: React.RefObject<HTMLElement | null>): ParsedColors {
    const [raw, setRaw] = useState({
        bg: "#080808",
        minor: "rgba(255,255,255,0.55)",
        major: "rgba(255,255,255,0.95)",
    });

    useEffect(() => {
        const el = scopeRef.current;
        if (!el) return;

        const read = () => {
            const styles = getComputedStyle(el);
            setRaw({
                bg: styles.getPropertyValue("--bg").trim() || "#080808",
                minor: styles.getPropertyValue("--grid-minor").trim() || "rgba(255,255,255,0.55)",
                major: styles.getPropertyValue("--grid-major").trim() || "rgba(255,255,255,0.95)",
            });
        };

        read();
        const observer = new MutationObserver(read);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, [scopeRef]);

    return useMemo(() => {
        const bg = parseCssColor(raw.bg, { hex: "#080808", alpha: 1 }).color;
        // Boost alphas compared to the CSS values — WebGL anti-aliased
        // lines render thinner than CSS borders, so need more opacity
        // to feel equivalent.
        const m = parseCssColor(raw.minor, {
            hex: "#ffffff",
            alpha: 0.55,
        });
        const M = parseCssColor(raw.major, {
            hex: "#ffffff",
            alpha: 0.95,
        });
        return {
            bg,
            minor: m.color,
            minorAlpha: Math.min(1, m.alpha * 0.5 + 0.02),
            major: M.color,
            majorAlpha: Math.min(1, M.alpha * 0.4 + 0.05),
            crossColor: M.color,
            crossAlpha: Math.min(1, M.alpha * 1.5 + 0.06),
        };
    }, [raw]);
}

/**
 * GlassPiece — unified glass mesh for ring (index 0) and jewelry (1-6).
 * Uses MeshTransmissionMaterial with Bayer dither dissolve.
 * Scroll-driven quaternion slerp + mouse-follow rotation for all pieces.
 * activeJewelry=0 → ring torus, 1-6 → jewelry piece.
 * Dither transition swaps geometry at midpoint (tp > 0.5).
 *
 * Cinematic enhancements:
 * - Scroll-triggered breathing (±3% scale oscillation synced to scroll velocity)
 * - Entry stagger on first Chapter 1 visit (elastic scale-in)
 * - Static chromatic aberration at 0.4 (velocity reactivity removed — read as demo, not exhibit)
 * - Idle auto-rotation after 8s of no input (0.5°/s gentle spin + breathe)
 */
function GlassPiece({
    z,
    mouseRef,
    pointerActiveRef,
    scrollPhase,
    ch2Phase,
    activeChapter,
    activeJewelry = 0,
    activeArea = "ear_left",
    transitionProgress,
    swapDirection,
    scrollVelocity,
    reducedMotion = false,
}: {
    z: number;
    mouseRef: React.RefObject<{ x: number; y: number }>;
    pointerActiveRef: React.RefObject<boolean>;
    scrollPhase?: React.RefObject<number>;
    ch2Phase?: React.RefObject<number>;
    activeChapter?: React.RefObject<number>;
    activeJewelry?: number;
    activeArea?: string;
    transitionProgress?: React.RefObject<number>;
    swapDirection?: React.RefObject<number>;
    scrollVelocity?: React.RefObject<number>;
    reducedMotion?: boolean;
}) {
    const ref = useRef<THREE.Mesh>(null);

    // Mouse-follow rotation
    const smoothMouse = useRef({ x: 0, y: 0 });
    const prevSmooth = useRef({ x: 0, y: 0 });
    const accEuler = useRef({ x: 0, y: 0 });
    const _mouseQ = useMemo(() => new THREE.Quaternion(), []);
    const _euler = useMemo(() => new THREE.Euler(), []);
    const _scrollQ = useMemo(() => new THREE.Quaternion(), []);
    const _scrollEuler = useMemo(() => new THREE.Euler(), []);

    // All geometries: index 0 = torus ring, 1-6 = jewelry
    const geometries = useMemo(() => PIECE_GEOMETRIES.map((fn) => fn()), []);
    useEffect(() => () => geometries.forEach((g) => g?.dispose()), [geometries]);

    // Dither uniform for Bayer dissolve
    const ditherProgress = useRef({ value: 0.0 });
    const matRef = useRef<any>(null);
    const obcChained = useRef(false);

    // Chain Bayer dither onto MeshTransmissionMaterial's onBeforeCompile
    useEffect(() => {
        const mat = matRef.current;
        if (!mat || obcChained.current) return;
        const orig = mat.onBeforeCompile?.bind(mat);
        mat.onBeforeCompile = (shader: any, renderer: any) => {
            if (orig) orig(shader, renderer);
            shader.uniforms.uDither = ditherProgress.current;
            shader.fragmentShader = "uniform float uDither;\n" + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <dithering_fragment>",
                /* glsl */ `
                if (uDither > 0.001) {
                    vec2 px = mod(gl_FragCoord.xy, 4.0);
                    vec2 q4 = step(2.0, px);
                    float b4 = (1.0 - q4.y) * q4.x * 2.0 + q4.y * (3.0 - q4.x * 2.0);
                    vec2 q2 = step(1.0, mod(px, 2.0));
                    float b2 = (1.0 - q2.y) * q2.x * 2.0 + q2.y * (3.0 - q2.x * 2.0);
                    float threshold = (b4 * 4.0 + b2) / 16.0;
                    if (uDither > threshold) discard;
                }
                #include <dithering_fragment>
                `
            );
        };
        const origKey = mat.customProgramCacheKey?.bind(mat);
        mat.customProgramCacheKey = () => (origKey ? origKey() : "") + "-piece-dither";
        mat.needsUpdate = true;
        obcChained.current = true;
    }, []);

    // Track piece index for geometry swapping
    const prevJewelry = useRef(activeJewelry);
    const swappedThisCycle = useRef(false);
    useEffect(() => {
        if (activeJewelry !== prevJewelry.current) {
            swappedThisCycle.current = false;
            prevJewelry.current = activeJewelry;
        }
    }, [activeJewelry]);

    // Smooth state
    const smoothScale = useRef(2);
    const smoothOpacity = useRef(1);
    const smoothScrollRotX = useRef(0);
    const smoothScrollRotY = useRef(0);

    // C1: Entry stagger — first Chapter 1 visit gets elastic scale-in
    const hasEnteredChapter1 = useRef(false);
    const entryScale = useRef(0); // 0→1 elastic ease on first visit

    // D3: Idle auto-rotation
    const lastInputTime = useRef(performance.now());
    const idleAngle = useRef(0);
    const smoothIdleStrength = useRef(0);

    // A1: Breathing — smooth scroll velocity for breathing pulse
    const smoothBreathVel = useRef(0);

    // Directional slide removed — the arc motion during jewelry
    // swaps looked wacky. Using only Bayer dither dissolve now.
    // Hero→exhibit z drift — ring travels back onto the podium as the
    // user scrolls into Chapter 1. Initialised at HERO_RING_Z so the
    // first frame shows the ring at hero size.
    const smoothZ = useRef(HERO_RING_Z);

    // Ch2 boost mirror — same damped ramp as BodyModel's `boost` so the
    // anchor world position tracks the body's growing scale during the
    // chapter transition. Avoids duplicating boost as a shared ref by
    // recomputing locally with identical inputs (activeChapter + λ=2).
    const boostMirror = useRef(1);

    // Quaternion target for normal alignment in Ch2.
    const _alignQ = useMemo(() => new THREE.Quaternion(), []);
    const _alignNormal = useMemo(() => new THREE.Vector3(), []);
    const POST_AXIS = useMemo(() => new THREE.Vector3(0, 0, 1), []);

    useFrame((state, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);
        const tp = transitionProgress?.current ?? 0;
        const sv = scrollVelocity?.current ?? 0;
        const elapsed = state.clock.elapsedTime;
        const ac = activeChapter?.current ?? 0;
        const sp = scrollPhase?.current ?? 0;
        const ph2 = ch2Phase?.current ?? 0;

        // Swap geometry at transition midpoint
        if (!swappedThisCycle.current && tp > 0.5) {
            const idx = Math.max(0, Math.min(activeJewelry, geometries.length - 1));
            ref.current.geometry = geometries[idx];
            swappedThisCycle.current = true;
            // Reset idle rotation to prevent slerp fight after swap
            idleAngle.current = 0;
            smoothIdleStrength.current = 0;
            lastInputTime.current = performance.now();
        }

        // ── Dither ──
        ditherProgress.current.value = tp;

        // ── C1: Entry stagger on first Chapter 1 visit ──
        // Only animate scale-in if ring was actually hidden (from ch2+).
        // Coming from hero (ch0) the ring is already visible — skip stagger.
        if (ac === 1 && !hasEnteredChapter1.current) {
            hasEnteredChapter1.current = true;
            entryScale.current = smoothScale.current > 0.1 ? 1 : 0;
        }
        if (hasEnteredChapter1.current && entryScale.current < 1) {
            // Elastic ease-out: overshoot then settle
            entryScale.current = Math.min(1, entryScale.current + dt * 2.5);
        }
        const entryFactor = hasEnteredChapter1.current
            ? entryScale.current < 1
                ? (1 - Math.pow(1 - entryScale.current, 3)) *
                  (1 + 0.08 * Math.sin(entryScale.current * Math.PI * 2))
                : 1
            : 1;

        // ── A1: Scroll-triggered breathing ──
        smoothBreathVel.current = THREE.MathUtils.damp(smoothBreathVel.current, sv, 4, dt);
        // Breathing: gentle sine oscillation, amplitude scales with scroll velocity
        // Skip when reduced-motion is active
        const idleBreath = reducedMotion ? 0 : Math.sin(elapsed * 1.5) * 0.015;
        const scrollBreath = reducedMotion
            ? 0
            : Math.sin(elapsed * 3) * smoothBreathVel.current * 0.03;
        const breathFactor = 1 + idleBreath + scrollBreath;

        // ── Body materialization mirror ──
        // BodyModel ramps its scale on smoothstep(0.72, 1.0, ch2Phase).
        // Mirror that here so the anchor world position tracks the
        // growing body. Outside Ch2 (ph2 = 0) effective body scale is
        // 0 (body invisible); inside it grows to 10.4 by ph2 = 1.
        const matT = (() => {
            const t = Math.max(0, Math.min(1, (ph2 - 0.72) / (1.0 - 0.72)));
            return t * t * (3 - 2 * t);
        })();
        boostMirror.current = THREE.MathUtils.damp(
            boostMirror.current,
            matT, // 0 → 1 during stage D
            4,
            dt
        );
        const ch2T = boostMirror.current;
        const effBodyScale = ch2T * MODEL_SCALE * CH2_SCALE_BOOST;

        // ── Scale ──
        // Ch0/1: 2× hero/exhibit size — the ring stays at its natural
        // drift position (HERO_RING_Z → EXHIBIT_Z) throughout Ch1 and
        // the Ch1→Ch2 storyboard. As the camera tilts down to look at
        // the floor, the ring sits visibly on the podium below — part
        // of the world, not faded out.
        // Ch3+: hidden (the chapter handles its own composition).
        const onBust = ch2T > 0.01;
        const visible = ac <= 2;
        const scalePulse = 1 - tp * 0.25;
        const targetScale = !visible ? 0 : 2 * scalePulse;
        const lambda = !visible ? 3 : onBust ? 4 : 8;
        smoothScale.current = THREE.MathUtils.damp(smoothScale.current, targetScale, lambda, dt);
        const s = smoothScale.current * breathFactor * entryFactor;
        ref.current.scale.set(s, s, s);

        // ── Visibility (skip FBO when fully hidden) ──
        ref.current.visible = s > 0.01 && ditherProgress.current.value < 0.99;

        // ── Position ──
        // Ch0/1: drift z hero→exhibit synchronised with camera pull-back;
        //        x stays 0; y baseline lifts above podium top tier + bob.
        // Ch2:   travel to the active anchor on the wireframe bust. The
        //        piece "lands" on the chosen zone (lobe / helix / septum
        //        / lip / eyebrow / navel) like an installed piercing.
        const transitT = Math.min(1, sp * 2);
        const driftT = flyEasing(transitT);
        const ch01TargetZ = HERO_RING_Z + driftT * (EXHIBIT_Z - HERO_RING_Z);
        const ch01BaseY = driftT * 0.45;
        const bobY = reducedMotion ? 0 : Math.sin(elapsed * 0.9) * 0.06;

        // Effective body scale this frame — used to project body-local
        // anchor coords into world space so the jewelry tracks the
        // growing body during stage D.
        const anchorData = BUST_ANCHORS_LOCAL[activeArea] ?? BUST_ANCHORS_LOCAL.ear_left;
        const [ax, ay, az] = anchorData.position;
        const ch2TargetX = BUST_POSITION[0] + ax * effBodyScale;
        const ch2TargetY = BUST_POSITION[1] + MODEL_Y_OFFSET + ay * effBodyScale;
        const ch2TargetZ = BUST_POSITION[2] + az * effBodyScale;

        const targetPosX = onBust ? ch2TargetX : 0;
        const targetPosY = onBust ? ch2TargetY : ch01BaseY + bobY;
        const targetPosZ = onBust ? ch2TargetZ : ch01TargetZ;

        smoothZ.current = THREE.MathUtils.damp(smoothZ.current, targetPosZ, DOLLY_LAMBDA, dt);
        ref.current.position.z = smoothZ.current;
        ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, targetPosX, 2, dt);
        ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, targetPosY, 2, dt);

        // ── Opacity ──
        const targetOpacity = visible ? 1 : 0;
        smoothOpacity.current = THREE.MathUtils.damp(smoothOpacity.current, targetOpacity, 5, dt);
        const mat = ref.current.material as any;
        if (mat && "opacity" in mat) {
            mat.opacity = smoothOpacity.current;
            mat.transparent = smoothOpacity.current < 0.99;
        }

        // Chromatic aberration is held at the static 0.4 value declared
        // on MeshTransmissionMaterial — the previous scroll-velocity-reactive
        // spike was cut as it read as WebGL-demo flair rather than exhibit.

        // ── Scroll-driven rotation (two-phase) ──
        // X rotates linearly across the entire hero→Chapter-1 scroll —
        // 180° by sp=0.5 (at ВЫБЕРИ), another 180° by sp=1 (at Ch 1),
        // total 360°. Y stays still during the first half, then rotates
        // a full 360° during the second half (ВЫБЕРИ → Chapter 1).
        const targetRotX = sp * Math.PI * 2; // 0 → 360°
        const targetRotY = Math.max(0, (sp - 0.5) * 2) * Math.PI * 2; // 0 → 360° (sp 0.5→1)
        smoothScrollRotX.current = THREE.MathUtils.damp(
            smoothScrollRotX.current,
            targetRotX,
            5,
            dt
        );
        smoothScrollRotY.current = THREE.MathUtils.damp(
            smoothScrollRotY.current,
            targetRotY,
            5,
            dt
        );

        // Idle auto-rotation removed — read as WebGL-demo flair
        // rather than exhibit. Confident exhibits don't fidget when
        // the viewer pauses. Refs (idleAngle, smoothIdleStrength,
        // lastInputTime) are kept zero/idle so the slerp expression
        // below stays a no-op without changing its shape.
        const active = pointerActiveRef.current;

        // ── Mouse-follow rotation ──
        const targetX = active ? mouseRef.current.x : 0;
        const targetY = active ? mouseRef.current.y : 0;
        const lerpRate = active ? 8 : 2;
        const t = 1 - Math.exp(-lerpRate * dt);
        smoothMouse.current.x += (targetX - smoothMouse.current.x) * t;
        smoothMouse.current.y += (targetY - smoothMouse.current.y) * t;
        const vx = smoothMouse.current.x - prevSmooth.current.x;
        const vy = smoothMouse.current.y - prevSmooth.current.y;
        prevSmooth.current.x = smoothMouse.current.x;
        prevSmooth.current.y = smoothMouse.current.y;
        const sx = smoothMouse.current.x;
        const sy = smoothMouse.current.y;
        const dist = Math.sqrt(sx * sx + sy * sy);
        const distFactor = Math.max(0, 1 - dist * 1.5);
        const rotMag = 0.04 * distFactor;
        accEuler.current.x -= vy * rotMag;
        accEuler.current.y += vx * rotMag;
        const decay = 1 - dt;
        accEuler.current.x *= decay;
        accEuler.current.y *= decay;

        _euler.set(accEuler.current.x, accEuler.current.y, 0);
        _mouseQ.setFromEuler(_euler);
        ref.current.quaternion.premultiply(_mouseQ);

        // Slerp toward scroll-driven rotation target (+ idle rotation Y offset)
        _scrollEuler.set(
            smoothScrollRotX.current,
            smoothScrollRotY.current + idleAngle.current * smoothIdleStrength.current,
            0
        );
        _scrollQ.setFromEuler(_scrollEuler);
        // Gentle slerp — lower factor prevents snapping/fighting
        ref.current.quaternion.slerp(_scrollQ, dt * 2.0);
        ref.current.quaternion.normalize();

        // ── Normal alignment in Ch2 ──
        // Slerp toward the orientation that maps +Z onto the anchor's
        // outward normal. Weighted by ch2T so leaving Ch2 returns
        // smoothly to scroll/idle-driven rotation. The Ch1→Ch2
        // transition reads as the ring "settling" onto the anchor.
        if (ch2T > 0.01) {
            _alignNormal
                .set(anchorData.normal[0], anchorData.normal[1], anchorData.normal[2])
                .normalize();
            _alignQ.setFromUnitVectors(POST_AXIS, _alignNormal);
            ref.current.quaternion.slerp(_alignQ, ch2T * dt * 6);
            ref.current.quaternion.normalize();
        }
    });

    return (
        <mesh ref={ref} geometry={geometries[0]} position={[0, 0, z]} scale={2}>
            <MeshTransmissionMaterial
                ref={matRef}
                thickness={0.02}
                roughness={0}
                transmission={1}
                ior={1.25}
                chromaticAberration={0}
                envMapIntensity={0.15}
                backside
                backsideThickness={0.1}
                resolution={
                    typeof window !== "undefined" && window.devicePixelRatio > 1.5 ? 2048 : 1024
                }
                samples={10}
            />
        </mesh>
    );
}

/**
 * B2: Floating dust motes / glass shards that catch the spotlight.
 * Simple Points geometry with slow drift, parallax-aware.
 */
const MOTE_COUNT = 40;
function DustMotes({
    z,
    activeChapter,
    scrollVelocity,
}: {
    z: number;
    activeChapter?: React.RefObject<number>;
    scrollVelocity?: React.RefObject<number>;
}) {
    const pointsRef = useRef<THREE.Points>(null);
    const smoothOpacity = useRef(0);

    const { positions, speeds } = useMemo(() => {
        const pos = new Float32Array(MOTE_COUNT * 3);
        const spd = new Float32Array(MOTE_COUNT);
        for (let i = 0; i < MOTE_COUNT; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 8;
            pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
            pos[i * 3 + 2] = z + (Math.random() - 0.5) * 4;
            spd[i] = 0.1 + Math.random() * 0.3;
        }
        return { positions: pos, speeds: spd };
    }, [z]);

    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        return g;
    }, [positions]);

    useFrame((state, delta) => {
        if (!pointsRef.current) return;
        const dt = Math.min(delta, 0.05);
        const elapsed = state.clock.elapsedTime;

        const visible = (activeChapter?.current ?? 0) <= 1;
        smoothOpacity.current = THREE.MathUtils.damp(smoothOpacity.current, visible ? 1 : 0, 3, dt);

        // Scroll velocity makes particles scatter more and glow brighter
        const sv = scrollVelocity?.current ?? 0;
        const baseOpacity = 0.35 + sv * 0.2; // 0.35 → 0.55 at max scroll
        (pointsRef.current.material as THREE.PointsMaterial).opacity =
            smoothOpacity.current * baseOpacity;

        // Amplify position offset with scroll energy
        const energyMul = 1 + sv * 3; // 1× idle → 4× at max scroll

        const pos = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < MOTE_COUNT; i++) {
            const s = speeds[i];
            pos.array[i * 3 + 1] += Math.sin(elapsed * s + i) * dt * 0.08 * energyMul;
            pos.array[i * 3] += Math.cos(elapsed * s * 0.7 + i * 2) * dt * 0.04 * energyMul;
            // Wraparound: reset motes that drift out of view
            if (pos.array[i * 3 + 1] > 4) pos.array[i * 3 + 1] = -4 + Math.random();
            if (pos.array[i * 3 + 1] < -4) pos.array[i * 3 + 1] = 4 - Math.random();
            if (pos.array[i * 3] > 5) pos.array[i * 3] = -5 + Math.random();
            if (pos.array[i * 3] < -5) pos.array[i * 3] = 5 - Math.random();
        }
        pos.needsUpdate = true;
    });

    return (
        <points ref={pointsRef} geometry={geometry}>
            <pointsMaterial
                color="#fffdf5"
                size={0.03}
                transparent
                opacity={0}
                sizeAttenuation
                depthWrite={false}
            />
        </points>
    );
}

/**
 * B3: Exhibition spotlight that shifts color temperature based on scroll.
 * Cool white (#fff8ee) on hero → warm gold (#e1b24a) in Chapter 1.
 */
function ExhibitionLight({ z, scrollPhase }: { z: number; scrollPhase?: React.RefObject<number> }) {
    const spotRef = useRef<THREE.SpotLight>(null);
    const pointRef = useRef<THREE.PointLight>(null);
    const coolColor = useMemo(() => new THREE.Color("#fff8ee"), []);
    const warmColor = useMemo(() => new THREE.Color("#f06ba0"), []);
    const _color = useMemo(() => new THREE.Color(), []);

    useFrame(() => {
        // Blend 0→1 based on scroll phase (0 = hero, 1 = deep in chapter 1)
        const sp = scrollPhase?.current ?? 0;
        const blend = Math.min(1, sp * 2); // fully warm by scrollPhase=0.5
        _color.copy(coolColor).lerp(warmColor, blend * 0.4); // max 40% warm shift
        if (spotRef.current) spotRef.current.color.copy(_color);
        if (pointRef.current) pointRef.current.color.copy(_color);
    });

    return (
        <>
            <spotLight
                ref={spotRef}
                position={[0, 8, z]}
                angle={0.35}
                penumbra={0.8}
                intensity={4}
                distance={20}
                color="#fff8ee"
                castShadow={false}
            />
            <pointLight
                ref={pointRef}
                position={[0, 5, z - 4]}
                intensity={0.6}
                color="#ffe4c4"
                distance={18}
            />
        </>
    );
}

/**
 * C3: Mouse proximity bloom — dynamically adjusts bloom intensity
 * based on cursor proximity to center. Closer cursor = stronger bloom.
 * Must be used inside EffectComposer.
 */
function ProximityBloom({
    mouseRef,
    baseIntensity = 0.4,
    maxIntensity = 0.8,
    transitionProgress,
}: {
    mouseRef: React.RefObject<{ x: number; y: number }>;
    baseIntensity?: number;
    maxIntensity?: number;
    transitionProgress?: React.RefObject<number>;
}) {
    const bloomRef = useRef<any>(null);
    const smoothIntensity = useRef(baseIntensity);

    useFrame((_, delta) => {
        if (!bloomRef.current) return;
        const dt = Math.min(delta, 0.05);
        const mx = mouseRef.current.x;
        const my = mouseRef.current.y;
        const dist = Math.sqrt(mx * mx + my * my);
        // Proximity: 0 at center, 1 at edges
        const proximity = Math.max(0, 1 - dist * 1.5); // strong at center, fades past 66%
        // P2: Bloom spike during jewelry swap transitions
        const tp = transitionProgress?.current ?? 0;
        const swapBoost = tp * 0.5; // up to +0.5 intensity during swap peak
        const target = baseIntensity + proximity * (maxIntensity - baseIntensity) + swapBoost;
        smoothIntensity.current = THREE.MathUtils.damp(smoothIntensity.current, target, 5, dt);
        bloomRef.current.intensity = smoothIntensity.current;
    });

    return (
        <Bloom
            ref={bloomRef}
            luminanceThreshold={0.85}
            luminanceSmoothing={0.3}
            intensity={baseIntensity}
            mipmapBlur
            levels={3}
        />
    );
}

/* BackdropText removed — ВЫБЕРИ section no longer exists */

/* JewelryNameText removed — was permanently invisible (baseOpacity=0)
   and wasting GPU resources (font atlas + useFrame every tick). */

/**
 * CylinderGrid — wraps a cylinder of the given radius/height with the
 * same major + minor + cross pattern the room walls use (`FaceGrid`).
 *
 * Mirrors FaceGrid's approach precisely:
 *   • minor lines  → 1px lineSegments at every subSize
 *   • major lines  → triangle-mesh strips of `majorThick` width
 *                    (so they actually look thicker than minors, the
 *                    way the wall majors do)
 *   • cross marks  → small lineSegment + shapes at major intersections
 *
 * Vertical major strips are oriented along the cylinder's tangent at
 * each radial; horizontal major rings are 2D bands around the cylinder
 * at each major height.
 */
function CylinderGrid({
    radius,
    height,
    cellSize = 2,
    subsPerCell = 5,
    ringSegments = 64,
    minorColor,
    minorAlpha,
    majorColor,
    majorAlpha,
    crossColor,
    crossAlpha,
}: {
    radius: number;
    height: number;
    cellSize?: number;
    subsPerCell?: number;
    ringSegments?: number;
    minorColor: THREE.Color;
    minorAlpha: number;
    majorColor: THREE.Color;
    majorAlpha: number;
    crossColor: THREE.Color;
    crossAlpha: number;
}) {
    const { minorGeom, majorGeom, crossGeom } = useMemo(() => {
        const minor: number[] = [];
        const major: number[] = [];
        const cross: number[] = [];
        const halfH = height / 2;

        const subSize = cellSize / subsPerCell;
        // FaceGrid uses majorThick = subSize * 0.07; mirror that exactly
        // so major-line thickness matches the corridor walls' look.
        const majorThick = subSize * 0.07;
        const armLength = subSize * 0.18;

        const circumference = Math.PI * 2 * radius;
        // Round divX to a multiple of subsPerCell so major lines land
        // cleanly on cellSize boundaries without alignment drift.
        const rawDivX = Math.max(subsPerCell, Math.round(circumference / subSize));
        const divX = Math.round(rawDivX / subsPerCell) * subsPerCell;
        const divY = Math.max(1, Math.round(height / subSize));

        // Helper: push two triangles forming a quad with the given 4 verts.
        const pushQuad = (
            target: number[],
            ax: number,
            ay: number,
            az: number,
            bx: number,
            by: number,
            bz: number,
            cx: number,
            cy: number,
            cz: number,
            dx: number,
            dy: number,
            dz: number
        ) => {
            target.push(ax, ay, az, bx, by, bz, cx, cy, cz);
            target.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
        };

        // ── Minor lines ──
        // Verticals: every minor index that isn't a major.
        for (let i = 0; i < divX; i++) {
            if (i % subsPerCell === 0) continue;
            const a = (i / divX) * Math.PI * 2;
            const x = Math.cos(a) * radius;
            const z = Math.sin(a) * radius;
            minor.push(x, -halfH, z, x, halfH, z);
        }
        // Horizontal rings: every minor row that isn't an edge or major.
        for (let j = 0; j <= divY; j++) {
            const isEdge = j === 0 || j === divY;
            if (isEdge || j % subsPerCell === 0) continue;
            const y = -halfH + (j / divY) * height;
            for (let i = 0; i < ringSegments; i++) {
                const a1 = (i / ringSegments) * Math.PI * 2;
                const a2 = ((i + 1) / ringSegments) * Math.PI * 2;
                minor.push(
                    Math.cos(a1) * radius,
                    y,
                    Math.sin(a1) * radius,
                    Math.cos(a2) * radius,
                    y,
                    Math.sin(a2) * radius
                );
            }
        }

        // ── Major mesh strips ──
        // Vertical majors: thin rectangular strips on the cylinder
        // surface, oriented along the tangent direction.
        for (let i = 0; i < divX; i += subsPerCell) {
            const a = (i / divX) * Math.PI * 2;
            const cx0 = Math.cos(a) * radius;
            const cz0 = Math.sin(a) * radius;
            // Tangent vector × majorThick = perpendicular offset along
            // the cylinder surface for line thickness.
            const tx = -Math.sin(a) * majorThick;
            const tz = Math.cos(a) * majorThick;
            pushQuad(
                major,
                cx0 - tx,
                -halfH,
                cz0 - tz, // lower-left
                cx0 + tx,
                -halfH,
                cz0 + tz, // lower-right
                cx0 + tx,
                halfH,
                cz0 + tz, // upper-right
                cx0 - tx,
                halfH,
                cz0 - tz // upper-left
            );
        }
        // Horizontal major rings: bands of quads around the cylinder
        // at each major height, including top + bottom rims.
        for (let j = 0; j <= divY; j++) {
            const isEdge = j === 0 || j === divY;
            const isMajor = isEdge || j % subsPerCell === 0;
            if (!isMajor) continue;
            const yC = -halfH + (j / divY) * height;
            const yLow = yC - majorThick;
            const yHigh = yC + majorThick;
            for (let i = 0; i < ringSegments; i++) {
                const a1 = (i / ringSegments) * Math.PI * 2;
                const a2 = ((i + 1) / ringSegments) * Math.PI * 2;
                const x1 = Math.cos(a1) * radius,
                    z1 = Math.sin(a1) * radius;
                const x2 = Math.cos(a2) * radius,
                    z2 = Math.sin(a2) * radius;
                pushQuad(
                    major,
                    x1,
                    yLow,
                    z1, // lower a1
                    x2,
                    yLow,
                    z2, // lower a2
                    x2,
                    yHigh,
                    z2, // upper a2
                    x1,
                    yHigh,
                    z1 // upper a1
                );
            }
        }

        // ── Cross marks at interior major intersections ──
        for (let i = 0; i < divX; i += subsPerCell) {
            const a = (i / divX) * Math.PI * 2;
            const ccx = Math.cos(a) * radius;
            const ccz = Math.sin(a) * radius;
            const tx = -Math.sin(a) * armLength;
            const tz = Math.cos(a) * armLength;
            for (let j = subsPerCell; j < divY; j += subsPerCell) {
                const cy = -halfH + (j / divY) * height;
                // Horizontal (tangential) arm.
                cross.push(ccx - tx, cy, ccz - tz, ccx + tx, cy, ccz + tz);
                // Vertical arm.
                cross.push(ccx, cy - armLength, ccz, ccx, cy + armLength, ccz);
            }
        }

        const makeBuffer = (verts: number[]) => {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
            return geom;
        };

        return {
            minorGeom: makeBuffer(minor),
            majorGeom: makeBuffer(major),
            crossGeom: makeBuffer(cross),
        };
    }, [radius, height, cellSize, subsPerCell, ringSegments]);

    useEffect(
        () => () => {
            minorGeom.dispose();
            majorGeom.dispose();
            crossGeom.dispose();
        },
        [minorGeom, majorGeom, crossGeom]
    );

    return (
        <>
            <lineSegments geometry={minorGeom}>
                <lineBasicMaterial
                    color={minorColor}
                    transparent
                    opacity={minorAlpha}
                    depthWrite={false}
                />
            </lineSegments>
            {/* Major as triangle mesh — visibly thicker than the
                minor lineSegments, matching FaceGrid's wall pattern. */}
            <mesh geometry={majorGeom}>
                <meshBasicMaterial
                    color={majorColor}
                    transparent
                    opacity={majorAlpha}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                />
            </mesh>
            <lineSegments geometry={crossGeom}>
                <lineBasicMaterial
                    color={crossColor}
                    transparent
                    opacity={crossAlpha}
                    depthWrite={false}
                />
            </lineSegments>
        </>
    );
}

/**
 * Podium — pedestal anchored to the room floor at EXHIBIT_Z. Solid
 * dark cylinders matching the scene background, with `<CylinderGrid>`
 * overlays drawing the *same* major + minor + cross pattern the
 * corridor walls use. cellSize matches the walls (2) so the podium's
 * grid character is consistent with the rest of the room.
 *
 * Single column (merging the old column + bottom tier into one
 * piece) plus a smaller top-tier display surface. Group origin at
 * world y=-3.0; column extends from world y=-6 (floor) to y=-2.6,
 * top tier from y=-2.6 to y=-2.25.
 */
function Podium({
    z,
    bgColor,
    minorColor,
    minorAlpha,
    majorColor,
    majorAlpha,
    crossColor,
    crossAlpha,
}: {
    z: number;
    bgColor: THREE.Color;
    minorColor: THREE.Color;
    minorAlpha: number;
    majorColor: THREE.Color;
    majorAlpha: number;
    crossColor: THREE.Color;
    crossAlpha: number;
}) {
    /* cellSize=1 (vs the walls' 2): the podium cylinder is much smaller
       than the wall planes, so halving the cell size keeps the *visible
       pattern density* in line with what the walls show — more cells,
       more cross marks, more legible grid character. Major thickness
       and cross-arm length scale with cellSize automatically. */
    const gridProps = {
        cellSize: 1,
        minorColor,
        minorAlpha,
        majorColor,
        majorAlpha,
        crossColor,
        crossAlpha,
    };
    return (
        <group position={[0, -3.0, z]}>
            {/* Column — merged column + bottom tier, 2.0 radius × 3.4
                tall, sits on the floor. */}
            <mesh position={[0, -1.3, 0]}>
                <cylinderGeometry args={[2.0, 2.0, 3.4, 64, 1]} />
                <meshBasicMaterial color={bgColor} />
            </mesh>
            <group position={[0, -1.3, 0]}>
                <CylinderGrid radius={2.0} height={3.4} {...gridProps} />
            </group>

            {/* Top tier — 1.5 radius × 0.35 tall, display surface. */}
            <mesh position={[0, 0.575, 0]}>
                <cylinderGeometry args={[1.5, 1.5, 0.35, 64, 1]} />
                <meshBasicMaterial color={bgColor} />
            </mesh>
            <group position={[0, 0.575, 0]}>
                <CylinderGrid radius={1.5} height={0.35} {...gridProps} />
            </group>
        </group>
    );
}

/**
 * Wordmark "PIERCERKZN" — fades in place and recedes into depth as the
 * user scrolls into chapter 1. No horizontal slide — the brand dissolves
 * where it stood, with a subtle Z push-back so it reads as receding rather
 * than fading flat.
 */
function AnimatedWordmark({
    baseZ,
    color,
    fontUrl,
    scrollPhase,
}: {
    baseZ: number;
    color: THREE.Color;
    fontUrl: string;
    scrollPhase?: React.RefObject<number>;
}) {
    const ref = useRef<any>(null);
    const smoothOpacity = useRef(1);
    const smoothX = useRef(0);

    useFrame((_, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);

        const p = scrollPhase?.current ?? 0;
        // Smoothstep-fade in the first ~10vh of scroll. scrollPhase
        // now ramps 0→1 across hero+ChooseIntro→Chapter-1 (2 viewports
        // of scroll), so 10vh = 0.05 phase units. The brand exits
        // before the user has barely begun scrolling.
        const t = Math.max(0, Math.min(1, p / 0.05));
        const smoothT = t * t * (3 - 2 * t);
        const targetOpacity = 1 - smoothT;
        const targetX = 0;

        smoothOpacity.current = THREE.MathUtils.damp(smoothOpacity.current, targetOpacity, 5, dt);
        smoothX.current = THREE.MathUtils.damp(smoothX.current, targetX, 3.5, dt);

        ref.current.position.x = smoothX.current;
        // Z push-back: wordmark dissolves "into depth" rather than just fading flat
        ref.current.position.z = baseZ - p * 0.6;
        if (ref.current.material) {
            ref.current.material.opacity = Math.max(0, smoothOpacity.current);
        }
        ref.current.visible = smoothOpacity.current > 0.01;
    });

    return (
        <Text
            ref={ref}
            position={[0, 0, baseZ]}
            fontSize={3.0}
            letterSpacing={0.02}
            color={color}
            anchorX="center"
            anchorY="middle"
            font={fontUrl}
            sdfGlyphSize={128}
            fillOpacity={1}
        >
            PIERCERKZN
            <meshBasicMaterial color={color} transparent opacity={1} />
        </Text>
    );
}

/**
 * AnimatedChooseText — "ВЫБЕРИ" rendered as a 3D Text mesh between
 * the camera and the exhibit ring. Reads as a floating chapter-divider
 * title sitting *in front of* the ring rather than behind it, framing
 * the exhibit beneath. Glows via toneMapped=false + HDR-pushed colour
 * (the existing bloom pass picks it up).
 *
 * Visibility is a wide beat centred on the ChooseIntro apex (sp=0.5):
 *   • fade-in:   sp 0.25 → 0.42  (smoothstep ramp-up)
 *   • full vis:  sp 0.42 → 0.58  (solid hold)
 *   • fade-out:  sp 0.58 → 0.75  (smoothstep ramp-down + z push-back)
 *
 * Fade vocabulary matches AnimatedWordmark (PIERCERKZN): pure opacity
 * + z push-back into depth on exit. No X slide, no transparent toggle,
 * no ref mutation of fillOpacity. The only reactively-driven property
 * is the meshBasicMaterial's opacity (transparent: true always).
 */
function AnimatedChooseText({
    z,
    color,
    fontUrl,
    scrollPhase,
}: {
    z: number;
    color: THREE.Color;
    fontUrl: string;
    scrollPhase?: React.RefObject<number>;
}) {
    const ref = useRef<any>(null);
    const smoothOpacity = useRef(0);
    const smoothX = useRef(-12);

    // HDR-pushed colour so toneMapped=false + bloom yields a glowing
    // luminous look without changing the hue from PIERCERKZN's tone.
    const brightColor = useMemo(() => color.clone().multiplyScalar(1.6), [color]);

    useFrame((_, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);
        const p = scrollPhase?.current ?? 0;

        // Wide visibility band centred on sp=0.5 (ChooseIntro apex).
        // Smoothstep on both ramps so entry/exit have the same gentle
        // shape as PIERCERKZN's fade.
        const inT = Math.max(0, Math.min(1, (p - 0.25) / 0.17));
        const outT = Math.max(0, Math.min(1, (p - 0.58) / 0.17));
        const fadeIn = inT * inT * (3 - 2 * inT);
        const fadeOut = outT * outT * (3 - 2 * outT);
        const targetOpacity = fadeIn * (1 - fadeOut);

        // Horizontal slide: enter from left (-12 → 0) during fade-in,
        // exit to right (0 → +12) during fade-out. fadeIn and fadeOut
        // never overlap (their windows are sp 0.25-0.42 and 0.58-0.75),
        // so the lerp pieces compose cleanly.
        const targetX = THREE.MathUtils.lerp(-12, 0, fadeIn) + fadeOut * 12;

        smoothOpacity.current = THREE.MathUtils.damp(smoothOpacity.current, targetOpacity, 6, dt);
        smoothX.current = THREE.MathUtils.damp(smoothX.current, targetX, 5, dt);

        ref.current.position.x = smoothX.current;
        const op = Math.max(0, smoothOpacity.current);
        // Drive opacity through the meshBasicMaterial only. Material is
        // `transparent: true` from initial render so toggling it never
        // recompiles — the fade is continuous, not flickery.
        if (ref.current.material) {
            ref.current.material.opacity = op;
        }
        ref.current.visible = op > 0.001;
    });

    return (
        <Text
            ref={ref}
            position={[-12, 0.0, z]}
            // Sits in front of the ring's exhibit position (z=-12) at
            // z=-10, with y=+1.0 lifting it above the ring as a chapter
            // title floating over the exhibit. fontSize 1.4 is sized to
            // fit the frame at ~5 units distance from the Ch1 camera.
            fontSize={1.4}
            letterSpacing={0.04}
            color={brightColor}
            anchorX="center"
            anchorY="middle"
            font={fontUrl}
            sdfGlyphSize={128}
            fillOpacity={1}
        >
            ВЫБЕРИ
            <meshBasicMaterial color={brightColor} transparent opacity={0} toneMapped={false} />
        </Text>
    );
}

/**
 * AnimatedFloorText — "ПРИМЕРЬ" rendered flat on the floor at the
 * spot directly under the Ch2-storyboard camera. Mirrors the ВЫБЕРИ
 * choreography: slide in from the left, hold centered, slide out to
 * the right, with smoothstep fades on each ramp.
 *
 * Visibility band keyed to ch2Phase (the held-floor portion of the
 * Ch2Intro storyboard, after stages A→D have completed):
 *   • slide in:  ph2 0.42 → 0.58
 *   • hold:      ph2 0.58 → 0.85
 *   • slide out: ph2 0.85 → 1.00
 *
 * Bright Bone-Ink color so the type reads on the dark museum floor.
 */
function AnimatedFloorText({
    floorY,
    z,
    fontUrl,
    ch2Phase,
}: {
    floorY: number;
    z: number;
    fontUrl: string;
    ch2Phase?: React.RefObject<number>;
}) {
    const ref = useRef<any>(null);
    const smoothOpacity = useRef(0);
    const smoothX = useRef(-12);

    const inkColor = useMemo(() => new THREE.Color("#f0f0f0"), []);

    useFrame((_, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);
        const p = ch2Phase?.current ?? 0;

        const inT = Math.max(0, Math.min(1, (p - 0.42) / 0.16));
        const outT = Math.max(0, Math.min(1, (p - 0.85) / 0.15));
        const fadeIn = inT * inT * (3 - 2 * inT);
        const fadeOut = outT * outT * (3 - 2 * outT);
        const targetOpacity = fadeIn * (1 - fadeOut);

        // Slide left → center → right (mirrors ВЫБЕРИ's choreography).
        const targetX = THREE.MathUtils.lerp(-12, 0, fadeIn) + fadeOut * 12;

        smoothOpacity.current = THREE.MathUtils.damp(smoothOpacity.current, targetOpacity, 6, dt);
        smoothX.current = THREE.MathUtils.damp(smoothX.current, targetX, 5, dt);

        const op = Math.max(0, smoothOpacity.current);
        ref.current.position.x = smoothX.current;
        if (ref.current.material) {
            ref.current.material.opacity = op;
        }
        ref.current.outlineOpacity = op;
        ref.current.fillOpacity = op;
        ref.current.visible = op > 0.001;
    });

    return (
        <Text
            ref={ref}
            position={[-12, floorY + 0.02, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={2.0}
            letterSpacing={0.08}
            color={inkColor}
            anchorX="center"
            anchorY="middle"
            font={fontUrl}
            sdfGlyphSize={128}
            fillOpacity={0}
            outlineOpacity={0}
        >
            ПРИМЕРЬ
            <meshBasicMaterial color={inkColor} transparent opacity={0} />
        </Text>
    );
}

/**
 * SceneBackgroundTransition — keeps the scene background damped toward
 * the dark Steel Atelier room color across all chapters. The previous
 * Ch2 light-theme flip was retired so the studio reads as one continuous
 * dark space; the bust on the podium is the new exhibit, not a new world.
 */
function SceneBackgroundTransition({
    darkBg,
}: {
    darkBg: THREE.Color;
    activeChapter?: React.RefObject<number>;
}) {
    const smoothR = useRef(darkBg.r);
    const smoothG = useRef(darkBg.g);
    const smoothB = useRef(darkBg.b);

    useFrame(({ scene }, delta) => {
        const dt = Math.min(delta, 0.05);

        smoothR.current = THREE.MathUtils.damp(smoothR.current, darkBg.r, 2.5, dt);
        smoothG.current = THREE.MathUtils.damp(smoothG.current, darkBg.g, 2.5, dt);
        smoothB.current = THREE.MathUtils.damp(smoothB.current, darkBg.b, 2.5, dt);

        if (scene.background instanceof THREE.Color) {
            scene.background.setRGB(smoothR.current, smoothG.current, smoothB.current);
        }
    });

    return null;
}

function ParallaxGroup({
    mouseRef,
    pointerActiveRef,
    ch2Phase,
    children,
}: {
    mouseRef: React.RefObject<{ x: number; y: number }>;
    pointerActiveRef: React.RefObject<boolean>;
    ch2Phase?: React.RefObject<number>;
    children: React.ReactNode;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const pos = useRef({ x: 0, y: 0 });
    const vel = useRef({ x: 0, y: 0 });
    // Smoothed target — prevents spring jolts when pointer leaves.
    const smoothTarget = useRef({ x: 0, y: 0 });

    useFrame((_, delta) => {
        if (!groupRef.current) return;
        const dt = Math.min(delta, 0.05);
        const m = mouseRef.current;

        // Parallax fades out across Ch2 entry — by ph2 = 0.4 (just
        // before stage D / floor close-up) the camera is fully static.
        // The clinical "single careful piercer" voice doesn't react
        // to mouse jitter once the viewer has settled into the floor.
        const ph2 = ch2Phase?.current ?? 0;
        const parallaxStrength = 1 - smoothstep(0.0, 0.4, ph2);

        // Raw target: follow mouse when active, return to center when outside
        const active = pointerActiveRef.current;
        const rawTx = active ? m.x * 0.55 * parallaxStrength : 0;
        const rawTy = active ? m.y * 0.3 * parallaxStrength : 0;

        // Smooth the target itself to prevent spring jolts
        const tLerp = 1 - Math.exp(-(active ? 6 : 2) * dt);
        smoothTarget.current.x += (rawTx - smoothTarget.current.x) * tLerp;
        smoothTarget.current.y += (rawTy - smoothTarget.current.y) * tLerp;

        const tx = smoothTarget.current.x;
        const ty = smoothTarget.current.y;

        // Damped spring: F = -k*(pos - target) - c*vel
        // Underdamped (ratio ~0.63) for subtle overshoot → organic feel
        const k = 18;
        const c = 6;

        const ax = -k * (pos.current.x - tx) - c * vel.current.x;
        const ay = -k * (pos.current.y - ty) - c * vel.current.y;

        vel.current.x += ax * dt;
        vel.current.y += ay * dt;
        pos.current.x += vel.current.x * dt;
        pos.current.y += vel.current.y * dt;

        groupRef.current.position.x = pos.current.x;
        groupRef.current.position.y = pos.current.y;
    });

    return <group ref={groupRef}>{children}</group>;
}

/**
 * Procedural jewelry piece that materializes inside the glass ring.
 * Uses different geometries per index to represent different jewelry types.
 * Transitions: old piece slides out with fade, new piece slides in.
 */
/** Stylized procedural jewelry geometries — recognisable piercing types. */

/** Merge sub-geometries after normalising to non-indexed so attributes are compatible. */
function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const ni = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(ni);
    // Dispose temporaries that toNonIndexed created
    ni.forEach((g, i) => {
        if (g !== geos[i]) g.dispose();
    });
    return merged!;
}

function makeCrossEarring(): THREE.BufferGeometry {
    // Substantial hoop ring at top (ear hook)
    const hoop = new THREE.TorusGeometry(0.09, 0.018, 24, 48);
    hoop.translate(0, 0.32, 0);
    // Small bail loop connecting hoop to cross
    const bail = new THREE.TorusGeometry(0.025, 0.01, 12, 16, Math.PI);
    bail.rotateZ(Math.PI);
    bail.translate(0, 0.22, 0);
    // Rectangular cross pendant — flat bars, slightly tapered
    const armW = 0.038; // bar width
    const armD = 0.016; // bar depth (flat)
    const vBar = new THREE.BoxGeometry(armW, 0.32, armD);
    vBar.translate(0, 0.0, 0);
    const hBar = new THREE.BoxGeometry(0.2, armW, armD);
    hBar.translate(0, 0.08, 0);
    const g = mergeNonIndexed([hoop, bail, vBar, hBar]);
    g.scale(3.5, 3.5, 3.5);
    return g;
}

function makeLabret(): THREE.BufferGeometry {
    const shaft = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 16);
    const ball = new THREE.SphereGeometry(0.065, 24, 24);
    ball.translate(0, 0.175 + 0.06, 0);
    const disc = new THREE.CylinderGeometry(0.06, 0.06, 0.015, 24);
    disc.translate(0, -0.175, 0);
    const g = mergeNonIndexed([shaft, ball, disc]);
    // Lay sideways (like septum ring)
    g.rotateX(Math.PI / 2);
    g.scale(3.4, 3.4, 3.4);
    return g;
}

function makeHoopEarring(): THREE.BufferGeometry {
    const hoop = new THREE.TorusGeometry(0.22, 0.025, 24, 64);
    // Small clasp ball
    const clasp = new THREE.SphereGeometry(0.04, 16, 16);
    clasp.translate(0.22, 0, 0);
    const g = mergeNonIndexed([hoop, clasp]);
    g.scale(4.0, 4.0, 4.0);
    return g;
}

function makeStudEarring(): THREE.BufferGeometry {
    // Faceted gem (octahedron = diamond-like)
    const gem = new THREE.OctahedronGeometry(0.1, 0);
    gem.translate(0, 0.06, 0);
    // Decorative bezel ring around gem
    const bezel = new THREE.TorusGeometry(0.11, 0.015, 8, 24);
    bezel.rotateX(Math.PI / 2);
    bezel.translate(0, 0.06, 0);
    // Post
    const post = new THREE.CylinderGeometry(0.02, 0.02, 0.22, 12);
    post.translate(0, -0.11, 0);
    // Butterfly back
    const backDisc = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 16);
    backDisc.translate(0, -0.22, 0);
    const g = mergeNonIndexed([gem, bezel, post, backDisc]);
    // Lay sideways (like septum ring)
    g.rotateX(Math.PI / 2);
    g.scale(4.5, 4.5, 4.5);
    return g;
}

function makeBarbell(): THREE.BufferGeometry {
    const bar = new THREE.CylinderGeometry(0.022, 0.022, 0.45, 16);
    bar.rotateZ(Math.PI / 2); // horizontal
    const ballL = new THREE.SphereGeometry(0.06, 20, 20);
    ballL.translate(-0.225, 0, 0);
    const ballR = new THREE.SphereGeometry(0.06, 20, 20);
    ballR.translate(0.225, 0, 0);
    const g = mergeNonIndexed([bar, ballL, ballR]);
    g.scale(3.9, 3.9, 3.9);
    return g;
}

function makeSeptumRing(): THREE.BufferGeometry {
    // Horseshoe / circular barbell — half-torus with ball ends
    const curve = new THREE.TorusGeometry(0.18, 0.025, 20, 32, Math.PI);
    // Ball ends at each tip of the half-torus
    const ballA = new THREE.SphereGeometry(0.05, 16, 16);
    ballA.translate(-0.18, 0, 0);
    const ballB = new THREE.SphereGeometry(0.05, 16, 16);
    ballB.translate(0.18, 0, 0);
    const g = mergeNonIndexed([curve, ballA, ballB]);
    g.scale(4.9, 4.9, 4.9);
    return g;
}

function makeRingTorus(): THREE.BufferGeometry {
    return new THREE.TorusGeometry(1, 0.12, 128, 384);
}

/* Aligned 1:1 with ROSTER in JewelryShowcase.tsx so activeJewelry=N
   shows the same piece in 3D as the rolodex names. The hero floating
   torus IS the first carousel item ("Кольцо"). makeHoopEarring is
   no longer used (the hoop entry was dropped from the roster). */
const PIECE_GEOMETRIES = [
    makeRingTorus, // 0: Кольцо (hero ring)
    makeCrossEarring, // 1: Крест-серьга
    makeLabret, // 2: Лабрет
    makeStudEarring, // 3: Пусета
    makeBarbell, // 4: Штанга
    makeSeptumRing, // 5: Септум
];

/**
 * Anchor positions + normals for the chapter-2 exhibit, in body-local
 * coordinates. GlassPiece computes the world target each frame by
 * scaling these by the current effective body scale (MODEL_SCALE ×
 * boost) and adding BUST_POSITION + MODEL_Y_OFFSET. This matches
 * BodyModel's transform exactly so the jewelry tracks the body when
 * the Ch2 boost ramps in/out.
 */
const BUST_ANCHORS_LOCAL = ANCHORS_LOCAL;

const BUST_POSITION: [number, number, number] = [0, 0, EXHIBIT_Z];

/* Legacy positions-only world map — only consumed by the dead
   WireframeBust component (BodyModel replaced it). Kept so the file
   typechecks; all live code paths read BUST_ANCHORS_LOCAL. */
const BUST_ANCHORS: Record<string, [number, number, number]> = Object.fromEntries(
    Object.entries(ANCHORS_LOCAL).map(([key, a]) => [
        key,
        [
            a.position[0] * MODEL_SCALE,
            MODEL_Y_OFFSET + a.position[1] * MODEL_SCALE,
            a.position[2] * MODEL_SCALE,
        ] as [number, number, number],
    ])
);

/**
 * Wireframe head-and-shoulders bust with anchor dots at the six body
 * piercing zones. Sits centered on the same exhibit pedestal that
 * carried the jewelry in Chapter 1 — a literal museum bust on its
 * stand, signalling continuity rather than a scene change.
 *
 * Visible when Chapter 2 is active; scales 0→1 with damped lerp.
 */
function WireframeBust({
    activeChapter,
    activeArea,
    color,
    opacity,
}: {
    activeChapter?: React.RefObject<number>;
    activeArea: string;
    color: THREE.Color;
    opacity: number;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const smoothScale = useRef(0);

    // Profile silhouette — frontal head + neck + shoulders + chest taper.
    const bustGeom = useMemo(() => {
        // Head: oval, top at y=+1.5, sides at y=+0.6, bottom at y=-0.2
        const head: [number, number, number][] = [];
        const segs = 28;
        for (let i = 0; i <= segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const x = Math.sin(t) * 0.62;
            const y = 0.7 + Math.cos(t) * 0.85;
            head.push([x, y, 0]);
        }

        // Neck: two parallel verticals from head bottom (y=-0.15) to
        // shoulder line (y=-1.0).
        const neckLeft: [number, number, number][] = [
            [-0.32, -0.15, 0],
            [-0.32, -1.0, 0],
        ];
        const neckRight: [number, number, number][] = [
            [0.32, -0.15, 0],
            [0.32, -1.0, 0],
        ];

        // Shoulders + chest taper: from shoulder ends out to ~±2.0 then
        // sloping down to chest taper at (±0.4, -2.5).
        const shoulders: [number, number, number][] = [
            [-0.32, -1.0, 0],
            [-1.4, -1.2, 0],
            [-2.0, -1.5, 0],
            [-1.5, -2.1, 0],
            [-0.6, -2.4, 0],
            [0.6, -2.4, 0],
            [1.5, -2.1, 0],
            [2.0, -1.5, 0],
            [1.4, -1.2, 0],
            [0.32, -1.0, 0],
        ];

        const verts: number[] = [];
        const pushLine = (a: [number, number, number], b: [number, number, number]) => {
            verts.push(...a, ...b);
        };

        for (let i = 0; i < head.length - 1; i++) pushLine(head[i], head[i + 1]);
        pushLine(neckLeft[0], neckLeft[1]);
        pushLine(neckRight[0], neckRight[1]);
        for (let i = 0; i < shoulders.length - 1; i++) pushLine(shoulders[i], shoulders[i + 1]);

        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        return geom;
    }, []);

    useEffect(() => () => bustGeom.dispose(), [bustGeom]);

    useFrame((state, delta) => {
        if (!groupRef.current) return;
        const dt = Math.min(delta, 0.05);

        const visible = (activeChapter?.current ?? 0) === 2;
        const targetScale = visible ? 1 : 0;
        smoothScale.current = THREE.MathUtils.damp(smoothScale.current, targetScale, 3, dt);

        const s = smoothScale.current;
        groupRef.current.scale.set(s, s, s);

        // Gentle lateral sway — clinical, not lifelike. Half the amplitude
        // of the previous ear sway so the bust reads as a still exhibit.
        groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.05;
    });

    return (
        <group ref={groupRef} position={BUST_POSITION} scale={0}>
            <lineSegments geometry={bustGeom}>
                <lineBasicMaterial color={color} transparent opacity={opacity} />
            </lineSegments>
            {Object.entries(BUST_ANCHORS).map(([key, pos], i) => (
                <AnchorDot
                    key={key}
                    position={pos}
                    delay={i * 0.15}
                    activeChapter={activeChapter}
                    isActive={key === activeArea}
                />
            ))}
        </group>
    );
}

/**
 * Pulsing accent anchor dot. The active anchor is rendered larger and
 * fully saturated; inactive anchors stay small and dim, marking the
 * available zones without competing with the active one.
 */
function AnchorDot({
    position,
    delay,
    activeChapter,
    isActive,
}: {
    position: [number, number, number];
    delay: number;
    activeChapter?: React.RefObject<number>;
    isActive: boolean;
}) {
    const ref = useRef<THREE.Mesh>(null);
    const smoothScale = useRef(0);
    const smoothActive = useRef(0);

    useFrame((state, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);

        const visible = (activeChapter?.current ?? 0) === 2;
        const targetScale = visible ? 1 : 0;
        smoothScale.current = THREE.MathUtils.damp(smoothScale.current, targetScale, 2, dt);

        const targetActive = isActive ? 1 : 0;
        smoothActive.current = THREE.MathUtils.damp(smoothActive.current, targetActive, 4, dt);

        // Active anchor is 1.6× the inactive size with stronger pulse.
        const sizeMul = 1 + smoothActive.current * 0.6;
        const pulseAmp = 0.08 + smoothActive.current * 0.18;
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 2 + delay * 10) * pulseAmp;
        const s = smoothScale.current * pulse * sizeMul;
        ref.current.scale.set(s, s, s);
    });

    return (
        <mesh ref={ref} position={position} scale={0}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshStandardMaterial
                color="#f06ba0"
                emissive="#f06ba0"
                emissiveIntensity={2}
                toneMapped={false}
            />
        </mesh>
    );
}

export default function WireframeRoom({
    scopeRef,
    fontUrl,
    mouseRef,
    pointerActiveRef,
    onReady,
    revealed = false,
    scrollPhase,
    ch2Phase,
    ch2BodyPhase,
    activeChapter,
    activeJewelry = 0,
    activeArea = "ear_left",
    transitionProgress,
    swapDirection,
    scrollVelocity,
}: {
    scopeRef: React.RefObject<HTMLElement | null>;
    fontUrl: string;
    mouseRef: React.RefObject<{ x: number; y: number }>;
    pointerActiveRef: React.RefObject<boolean>;
    onReady?: () => void;
    revealed?: boolean;
    scrollPhase?: React.RefObject<number>;
    /* Scroll-driven Ch1→Ch2 transition phase (0 outside, 1 once Ch2
       fills viewport). Drives the multi-stage camera storyboard +
       body materialization. */
    ch2Phase?: React.RefObject<number>;
    /* Scroll-driven progress through Ch2 itself (0 at top, 1 at
       bottom). Drives the 3D-canvas→2D-grid hand-off. */
    ch2BodyPhase?: React.RefObject<number>;
    activeChapter?: React.RefObject<number>;
    activeJewelry?: number;
    activeArea?: string;
    transitionProgress?: React.RefObject<number>;
    swapDirection?: React.RefObject<number>;
    scrollVelocity?: React.RefObject<number>;
}) {
    const colors = useThemeColors(scopeRef);
    const reducedMotion = useReducedMotion();

    // Shared Ch2 transition ramp (0 outside, 1 inside Ch2). Updated
    // by <ChapterFade/> each frame; consumed by CameraDolly, FaceGrid
    // walls, the pink rim light, and any other Ch2-reactive piece.
    const ch2T = useRef(0);

    // Room dimensions (arbitrary units).
    const W = 20;
    const H = 12;
    const D = 34;
    /* Floor depth — extends further forward than the room so when
       the camera flies back to A_Z (~-3) and tilts straight down at
       stage D, the gaze cone still hits floor on both sides instead
       of cutting off into void at z > 0. Floor center stays at
       z = -D/2 = -17, so the back stays anchored to the back wall;
       the extra length (FLOOR_DEPTH - D) extends FORWARD past the
       room's front edge, into the area the camera occupies. */
    const FLOOR_DEPTH = 60;
    const FLOOR_Z_CENTER = (-D + (FLOOR_DEPTH - D)) / 2; // shift forward by half the extension

    // Distance from camera to back wall.
    // At FOV 60°, viewport half-height = distance * tan(30°). For
    // the full back wall to fit with a touch of overflow (so walls
    // are visible converging toward it), distance needs to be
    // ~slightly less than H/(2*tan(30°)) ≈ 10.4. Pushed a bit
    // further so the corridor is clearly readable.
    const distToBack = 13;
    const cameraZ = -D + distToBack;
    const backDist = distToBack;

    return (
        <Canvas
            dpr={[1, 2]}
            camera={{
                fov: FOV_START,
                position: [0, 0, cameraZ + DOLLY_OFFSET],
                near: 0.1,
                far: backDist + 30,
            }}
            onCreated={({ camera }) => {
                // Camera sits close to the back wall and looks TOWARD it
                // (i.e. further along -Z). Without this, r3f points the
                // camera at the origin, so the back wall ends up behind
                // the camera and the corridor appears reversed.
                camera.lookAt(0, 0, -D);
            }}
            gl={{ antialias: true, alpha: true }}
            style={{ position: "absolute", inset: 0 }}
        >
            <ChapterFade ch2Phase={ch2Phase} ch2T={ch2T} />
            <CameraDolly
                restZ={cameraZ}
                revealed={revealed}
                scrollPhase={scrollPhase}
                ch2Phase={ch2Phase}
                activeChapter={activeChapter}
                ch2T={ch2T}
                reducedMotion={reducedMotion}
                roomH={H}
            />
            {/* Scene background matches the CSS theme bg. This is
                critical for MeshTransmissionMaterial: the glass
                refracts by sampling the scene into its own back-buffer,
                and between our wireframe lines there is no geometry.
                Without this <color/>, empty space samples as black,
                making the ring look dark. With it, the glass refracts
                the same bone-paper / dark-navy color the user sees
                behind the canvas, so it reads as truly transparent. */}
            <color attach="background" args={[colors.bg.r, colors.bg.g, colors.bg.b]} />
            {/* Smooth dark→light background transition for Ch2 */}
            <SceneBackgroundTransition darkBg={colors.bg} activeChapter={activeChapter} />
            <ParallaxGroup
                mouseRef={mouseRef}
                pointerActiveRef={pointerActiveRef}
                ch2Phase={ch2Phase}
            >
                {/* Room walls — fade out in Ch2 (fadeOutRef={ch2T}) so the
                close-up orbit reads as a portrait against pure background.
                Floor is the one exception — no fadeOutRef — so the orbit
                still has a ground reference. */}
                <FaceGrid
                    width={W}
                    height={H}
                    position={[0, 0, -D]}
                    minorColor={colors.minor}
                    minorAlpha={colors.minorAlpha}
                    majorColor={colors.major}
                    majorAlpha={colors.majorAlpha}
                    crossColor={colors.crossColor}
                    crossAlpha={colors.crossAlpha}
                    fadeOutRef={ch2T}
                />
                {/* Floor — kept full alpha in Ch2 (no fadeOutRef). Depth
                is extended (FLOOR_DEPTH > D) and shifted forward so
                the camera's straight-down gaze at stage D still hits
                floor instead of cutting off into void past z=0. */}
                <FaceGrid
                    width={W}
                    height={FLOOR_DEPTH}
                    position={[0, -H / 2, FLOOR_Z_CENTER]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    minorColor={colors.minor}
                    minorAlpha={colors.minorAlpha}
                    majorColor={colors.major}
                    majorAlpha={colors.majorAlpha}
                    crossColor={colors.crossColor}
                    crossAlpha={colors.crossAlpha}
                />
                <FaceGrid
                    width={W}
                    height={D}
                    position={[0, H / 2, -D / 2]}
                    rotation={[Math.PI / 2, 0, 0]}
                    minorColor={colors.minor}
                    minorAlpha={colors.minorAlpha}
                    majorColor={colors.major}
                    majorAlpha={colors.majorAlpha}
                    crossColor={colors.crossColor}
                    crossAlpha={colors.crossAlpha}
                    fadeOutRef={ch2T}
                />
                <FaceGrid
                    width={D}
                    height={H}
                    position={[-W / 2, 0, -D / 2]}
                    rotation={[0, Math.PI / 2, 0]}
                    minorColor={colors.minor}
                    minorAlpha={colors.minorAlpha}
                    majorColor={colors.major}
                    majorAlpha={colors.majorAlpha}
                    crossColor={colors.crossColor}
                    crossAlpha={colors.crossAlpha}
                    fadeOutRef={ch2T}
                />
                <FaceGrid
                    width={D}
                    height={H}
                    position={[W / 2, 0, -D / 2]}
                    rotation={[0, -Math.PI / 2, 0]}
                    minorColor={colors.minor}
                    minorAlpha={colors.minorAlpha}
                    majorColor={colors.major}
                    majorAlpha={colors.majorAlpha}
                    crossColor={colors.crossColor}
                    crossAlpha={colors.crossAlpha}
                    fadeOutRef={ch2T}
                />

                {/* Wordmark lives in the 3D scene so the glass ring in
                front of it physically refracts the letters. Sits just
                in front of the back wall, same layer as the corridor's
                vanishing point. Wrapped in Suspense because drei's
                <Text/> suspends while its font atlas loads — without a
                boundary, the suspension would unmount the entire Canvas
                subtree and render nothing. */}
                <Suspense fallback={null}>
                    <AnimatedWordmark
                        baseZ={-D + 3}
                        color={colors.major}
                        fontUrl={fontUrl}
                        scrollPhase={scrollPhase}
                    />

                    {/* ВЫБЕРИ — chapter divider title between hero and
                    Chapter 1. Placed at z=-10 — closer to the camera
                    than the ring's exhibit position (z=-12) so the
                    text reads as a floating title *in front of* the
                    ring, not behind it. y=+1.0 lifts it above the
                    ring so the two don't overlap. */}
                    <AnimatedChooseText
                        z={-10}
                        color={colors.major}
                        fontUrl={fontUrl}
                        scrollPhase={scrollPhase}
                    />

                    {/* ПРИМЕРЬ — Ch2Intro held-floor title. Laid flat on
                    the floor at z=-3 (directly under the storyboard
                    camera's straight-down gaze at stage D), so it's
                    legible on the floor close-up. Slides in / out
                    horizontally on the ch2Phase 0.42→0.58→1.00 band. */}
                    <AnimatedFloorText
                        floorY={-H / 2}
                        z={-3}
                        fontUrl={fontUrl}
                        ch2Phase={ch2Phase}
                    />

                    {onReady && <ReadinessSignal onReady={onReady} />}
                </Suspense>

                {/* Lighting for the glass piece. Synthetic bright-white
                environment with Lightformers for crisp highlights.
                Cinematic top spotlight with scroll-driven temperature shift. */}
                <directionalLight position={[0, 2, cameraZ + 3]} intensity={0.3} />
                <ExhibitionLight z={cameraZ - 6} scrollPhase={scrollPhase} />
                <PinkRimLight ch2Phase={ch2Phase} />
                <Environment resolution={256}>
                    {/* Fully enclosing bright sphere \u2014 any reflection ray
                    that misses a lightformer hits this and gets bright
                    white instead of black void. */}
                    <mesh scale={100}>
                        <sphereGeometry args={[1, 32, 32]} />
                        <meshBasicMaterial color="#000000" side={THREE.BackSide} />
                    </mesh>
                    {/* Bright top hemisphere rim \u2014 cinematic exhibition key */}
                    <Lightformer
                        form="ring"
                        intensity={5}
                        position={[0, 8, 0]}
                        rotation={[Math.PI / 2, 0, 0]}
                        scale={[6, 6, 1]}
                        color="#fffdf5"
                    />
                    {/* Warm side key */}
                    <Lightformer
                        form="rect"
                        intensity={2}
                        position={[8, 2, 2]}
                        rotation={[0, -Math.PI / 2, 0]}
                        scale={[10, 10, 1]}
                        color="#fff4dd"
                    />
                    {/* Cool fill */}
                    <Lightformer
                        form="rect"
                        intensity={1.5}
                        position={[-8, 2, 2]}
                        rotation={[0, Math.PI / 2, 0]}
                        scale={[10, 10, 1]}
                        color="#dce6ff"
                    />
                </Environment>

                {/* Podium — permanent fixture at EXHIBIT_Z, rooted to the
                room floor. Sits behind the hero camera (invisible) and
                in front of the chapter-1 camera (visible). The camera
                pull-back reveals it organically — no fade animation.
                Solid dark cylinders matching the scene bg, with the
                full minor+major+cross grid pattern matching the walls. */}
                <Podium
                    z={EXHIBIT_Z}
                    bgColor={colors.bg}
                    minorColor={colors.minor}
                    minorAlpha={colors.minorAlpha}
                    majorColor={colors.major}
                    majorAlpha={colors.majorAlpha}
                    crossColor={colors.crossColor}
                    crossAlpha={colors.crossAlpha}
                />

                {/* Glass piece — ring (index 0) or jewelry (1-6). Starts at
                HERO_RING_Z (close, original hero size) and drifts back
                to EXHIBIT_Z as the camera pulls back, so by Chapter 1
                the piece sits on the podium. Drift is handled inside
                GlassPiece's useFrame. */}
                <GlassPiece
                    z={HERO_RING_Z}
                    mouseRef={mouseRef}
                    pointerActiveRef={pointerActiveRef}
                    scrollPhase={scrollPhase}
                    ch2Phase={ch2Phase}
                    activeChapter={activeChapter}
                    activeJewelry={activeJewelry}
                    activeArea={activeArea}
                    transitionProgress={transitionProgress}
                    swapDirection={swapDirection}
                    scrollVelocity={scrollVelocity}
                    reducedMotion={reducedMotion}
                />

                {/* Dust motes drift in the hero focal area so they're visible
                as atmosphere around the floating ring. Stay there during
                Chapter 1 too — distant background haze behind the exhibit. */}
                <DustMotes
                    z={HERO_RING_Z}
                    activeChapter={activeChapter}
                    scrollVelocity={scrollVelocity}
                />

                {/* Chapter-2 body — full GLTF figure on the podium with
                anchor dots + dedicated stud. The body's materialization
                ramp is keyed to ch2Phase 0.72→1.0. Visible during the
                Ch1→Ch2 storyboard's earlier stages (before the camera
                tilts down past it). */}
                <Suspense fallback={null}>
                    <BodyModel
                        activeChapter={activeChapter}
                        exhibitZ={EXHIBIT_Z}
                        activeArea={activeArea}
                        activeJewelry={activeJewelry}
                        ch2Phase={ch2Phase}
                    />
                </Suspense>
            </ParallaxGroup>
            <EffectComposer>
                <FluidTrailEffect
                    mouseRef={mouseRef}
                    isDark={colors.bg.r < 0.5}
                    revealed={revealed}
                />
                <ProximityBloom
                    mouseRef={mouseRef}
                    baseIntensity={0.4}
                    maxIntensity={0.8}
                    transitionProgress={transitionProgress}
                />
            </EffectComposer>
        </Canvas>
    );
}
