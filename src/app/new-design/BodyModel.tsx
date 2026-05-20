"use client";

import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";
import Stud from "./jewelry/Stud";

/* activeJewelry index that maps to "Пусета" in JewelryShowcase ROSTER.
   When the user picks Пусета, the Stud component renders on the
   active anchor; other indices keep showing the GlassPiece torus. */
const STUD_JEWELRY_INDEX = 3;

/* The exported gltf places the model's feet at y=0 (model-local), and
   the model is 1.8m tall. The chapter-2 podium top tier sits at world
   y=-2.25, so we offset by -2.25 to land the feet on the podium and
   scale up so the body fills enough of the frame that the jewelry
   reads as jewelry, not architecture. Both constants are exported so
   WireframeRoom can derive the matching scene-world anchor positions
   from a single source of truth. */
export const MODEL_Y_OFFSET = -2.25;
export const MODEL_SCALE = 4.0;

/* Ch2 multiplier on top of MODEL_SCALE. Body smooth-ramps to this
   when the chapter activates so head/neck/shoulders fill the frame
   for the close-up orbit. Combined: 4.0 × 2.6 = 10.4 effective. */
export const CH2_SCALE_BOOST = 2.6;

/* Anchor data in gltf-local coordinates: position (where the piercing
   sits on the skin) + normal (outward direction the post pokes out
   from the body). Positions copied verbatim from the GLTF empty
   nodes (anchor_ear_l_lobe, anchor_nose_l_nostril, anchor_lip_labret,
   anchor_brow_l) so the sign of every component matches the model's
   own coordinate system — the model faces +Z, so the ear lobe sits
   at z<0 (slightly behind the head's center plane), nose/lip/brow
   at z>0 (forward face). Normals are anatomical cardinals derived
   from each anchor's surface orientation.

   The +Z attachment convention: a jewelry piece's local +Z axis is
   the post's outward direction (gem at +Z tip, post crosses skin
   along -Z into the body). To attach, build a parent group whose
   quaternion maps +Z → anchor.normal via setFromUnitVectors. */
export interface AnchorData {
    position: [number, number, number];
    normal: [number, number, number];
}

const norm3 = (x: number, y: number, z: number): [number, number, number] => {
    const m = Math.hypot(x, y, z) || 1;
    return [x / m, y / m, z / m];
};

export const ANCHORS_LOCAL: Record<string, AnchorData> = {
    // anchor_ear_l_lobe — outward = +X (avatar's left), slightly back (-Z).
    ear_left: { position: [+0.0722, +1.634, -0.0149], normal: norm3(+1, 0, -0.1) },
    // mirror of ear_left across YZ plane.
    ear_right: { position: [-0.0722, +1.634, -0.0149], normal: norm3(-1, 0, -0.1) },
    // anchor_nose_l_nostril — outward of left nostril aims forward, down, and slightly out.
    nose: { position: [+0.004, +1.6532, +0.0961], normal: norm3(+0.5, -0.5, +0.7) },
    // anchor_lip_labret — below lower lip, post points forward + slightly down.
    lip: { position: [+0.0, +1.6059, +0.0822], normal: norm3(0, -0.4, +0.9) },
    // anchor_brow_l — left eyebrow, post points forward + up + slightly out.
    eyebrow: { position: [+0.035, +1.7174, +0.0764], normal: norm3(+0.3, +0.3, +0.9) },
    // No GLTF empty for navel — anatomical estimate, post forward.
    navel: { position: [+0.0, +1.0, +0.1], normal: norm3(0, 0, +1) },
};

/* Back-compat export: positions only. page12/ and new-design-copy/
   variants and WireframeRoom's BUST_ANCHORS still consume the
   positions-only shape. */
export const ANCHOR_DOTS_LOCAL: Record<string, [number, number, number]> = Object.fromEntries(
    Object.entries(ANCHORS_LOCAL).map(([k, a]) => [k, a.position])
) as Record<string, [number, number, number]>;

interface BodyModelProps {
    activeChapter?: React.RefObject<number>;
    /* Z position of the chapter-2 exhibit (same EXHIBIT_Z that
       WireframeBust used). Passed in so this file doesn't need to
       reach back into WireframeRoom for the constant. */
    exhibitZ: number;
    /* Currently selected piercing zone — the matching anchor dot
       pulses larger and fully saturated. Other dots stay small/dim. */
    activeArea: string;
    /* Currently selected jewelry index. When this matches
       STUD_JEWELRY_INDEX (Пусета), the Stud renders on the active
       anchor; otherwise it stays scaled to 0. */
    activeJewelry?: number;
    /* Scroll-driven Ch1→Ch2 transition phase (0 outside, 1 once Ch2
       fills viewport). Drives the body materialization: body fades
       in from prone (rotated -π/2 on X, lying back-up on the floor),
       rotates 90° to vertical, and scales up while the camera tilts
       from looking-down-at-floor to head-on. */
    ch2Phase?: React.RefObject<number>;
}

/* Smoothstep — eases the start and end of a [0,1] segment so the
   materialization rise+rotate flows instead of stepping. */
function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export default function BodyModel({
    activeChapter,
    exhibitZ,
    activeArea,
    activeJewelry = 0,
    ch2Phase,
}: BodyModelProps) {
    const groupRef = useRef<THREE.Group>(null);
    const innerRef = useRef<THREE.Group>(null);
    const smoothScale = useRef(0);
    const smoothRotX = useRef(-Math.PI / 2); // start lying down (back on floor)
    const counterRot = useRef(0);

    const { scene } = useGLTF("/model_v6.glb");

    useFrame((state, delta) => {
        if (!groupRef.current || !innerRef.current) return;
        const dt = Math.min(delta, 0.05);

        const ph2 = ch2Phase?.current ?? 0;

        // Materialization scale — ramps in during stage D (0.72 → 1.0)
        // so the body emerges as the camera completes its tilt-up.
        const matScale = smoothstep(0.72, 1.0, ph2);
        const targetScale = matScale * MODEL_SCALE * CH2_SCALE_BOOST;
        smoothScale.current = THREE.MathUtils.damp(smoothScale.current, targetScale, 4, dt);
        const s = smoothScale.current;
        groupRef.current.scale.set(s, s, s);

        // Lying-down → standing rotation. Inner group rotates from
        // -π/2 (lying back-up on floor, feet toward camera) to 0
        // (standing) during stage D. Combined with camera pitch-up,
        // the head sweeps cleanly into the close-up frame.
        const targetRotX = THREE.MathUtils.lerp(-Math.PI / 2, 0, matScale);
        smoothRotX.current = THREE.MathUtils.damp(smoothRotX.current, targetRotX, 4, dt);
        innerRef.current.rotation.x = smoothRotX.current;

        // Lateral sway — only once standing.
        const standingFactor = matScale; // 0 lying, 1 standing
        const sway = Math.sin(state.clock.elapsedTime * 0.4) * 0.05 * standingFactor;
        // Slow counter-rotation against camera orbit (only after fully
        // upright — same standing factor as sway).
        counterRot.current -= 0.02 * dt * standingFactor;
        groupRef.current.rotation.y = sway + counterRot.current;
    });

    const studAnchor = ANCHORS_LOCAL[activeArea] ?? ANCHORS_LOCAL.ear_left;

    return (
        <group ref={groupRef} position={[0, MODEL_Y_OFFSET, exhibitZ]} scale={0}>
            {/* innerRef rotates -π/2 → 0 on X during stage D so the
                body rises from horizontal (lying on floor) to vertical
                as the camera pitches up to head height. */}
            <group ref={innerRef}>
                <primitive object={scene} />
                {Object.entries(ANCHOR_DOTS_LOCAL).map(([key, pos], i) => (
                    <BodyAnchorDot
                        key={key}
                        position={pos}
                        isActive={key === activeArea}
                        activeChapter={activeChapter}
                        delay={i * 0.15}
                    />
                ))}
                <Stud
                    anchor={studAnchor}
                    ch2Phase={ch2Phase}
                    activeJewelry={activeJewelry}
                    studIndex={STUD_JEWELRY_INDEX}
                />
            </group>
        </group>
    );
}

/**
 * Small pulsing pink anchor dot rendered inside the BodyModel group, in
 * gltf-local coordinates (the parent group's MODEL_SCALE×2 propagates
 * automatically). The active dot is 1.6× larger with stronger pulse;
 * inactive dots stay small/dim, marking the zones without competing
 * with the active one.
 *
 * Geometry radius is in gltf-local meters (0.012 m ≈ 1.2 cm in real
 * proportions). After the parent's MODEL_SCALE=2 multiplier, the dot
 * appears as ~2.4 cm in scene units, comparable to the wireframe's
 * 0.04-unit dots.
 */
function BodyAnchorDot({
    position,
    isActive,
    activeChapter,
    delay,
}: {
    position: [number, number, number];
    isActive: boolean;
    activeChapter?: React.RefObject<number>;
    delay: number;
}) {
    const ref = useRef<THREE.Mesh>(null);
    const smoothActive = useRef(0);

    useFrame((state, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);

        // Visible only once Ch2 is active (the body model itself
        // gates rendering via its scale-0 outer group, but we still
        // want only the active dot to pulse, not idle in Ch1).
        const inChapter = (activeChapter?.current ?? 0) === 2;

        const targetActive = isActive && inChapter ? 1 : 0;
        smoothActive.current = THREE.MathUtils.damp(smoothActive.current, targetActive, 4, dt);

        const sizeMul = 1 + smoothActive.current * 0.6;
        const pulseAmp = 0.08 + smoothActive.current * 0.18;
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 2 + delay * 10) * pulseAmp;
        const s = pulse * sizeMul;
        ref.current.scale.set(s, s, s);
    });

    return (
        <mesh ref={ref} position={position}>
            {/* 0.0008 m body-local → ~8 mm at Ch2's MODEL_SCALE × boost
                of 10.4. Active pulse (~1.9×) makes the selected anchor
                ~15 mm — readable as a marker without dominating the
                close-up frame. */}
            <sphereGeometry args={[0.0008, 16, 16]} />
            <meshStandardMaterial
                color="#f06ba0"
                emissive="#f06ba0"
                emissiveIntensity={2}
                toneMapped={false}
            />
        </mesh>
    );
}

useGLTF.preload("/model_v6.glb");
