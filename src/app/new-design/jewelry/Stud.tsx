"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AnchorData } from "../BodyModel";

/* Attachment convention: a jewelry piece's local +Z axis is the
   post's outward direction. Gem at +Z tip, post crosses skin along
   −Z into the body. Parent group's quaternion maps +Z onto the
   anchor's outward normal — same rule for studs, hoops, septum
   rings, labrets, barbells. */
const POST_AXIS = new THREE.Vector3(0, 0, 1);

interface StudProps {
    anchor: AnchorData;
    /* Scroll-driven Ch1→Ch2 transition phase. Stud ramps in during
       stage D (smoothstep 0.72 → 1.0) so it materializes alongside
       the body itself — the same scroll segment that brings the
       body up from horizontal to vertical. */
    ch2Phase?: React.RefObject<number>;
    /* The current jewelry slot. When this matches studIndex AND the
       body is materialized, the stud ramps to full scale. */
    activeJewelry: number;
    studIndex: number;
}

/**
 * Stud — first canonical piercing piece. Procedural geometry in
 * body-local meters (the GLTF is real-meter-scaled, so 0.001 = 1 mm).
 * Renders inside BodyModel's transform group so it inherits
 * MODEL_SCALE × CH2_SCALE_BOOST + sway + counter-rotation
 * automatically.
 *
 * Dimensions tuned for an ear-lobe stud:
 *   • post: 0.8 mm × 6 mm cylinder, 4 mm into body / 2 mm protruding
 *   • gem:  3 mm sphere at +5 mm (sits just outside the skin)
 *   • back: 2.5 mm flat disc at −3.5 mm (the butterfly back)
 */
export default function Stud({ anchor, ch2Phase, activeJewelry, studIndex }: StudProps) {
    const groupRef = useRef<THREE.Group>(null);
    const innerRef = useRef<THREE.Group>(null);
    const smoothScale = useRef(0);
    const _q = useMemo(() => new THREE.Quaternion(), []);
    const _n = useMemo(() => new THREE.Vector3(), []);

    /* Snap parent group's orientation onto the anchor normal —
       useLayoutEffect so alignment is applied before paint, no flash
       of mis-oriented stud when the user picks a new zone. */
    useLayoutEffect(() => {
        if (!groupRef.current) return;
        _n.set(anchor.normal[0], anchor.normal[1], anchor.normal[2]).normalize();
        _q.setFromUnitVectors(POST_AXIS, _n);
        groupRef.current.quaternion.copy(_q);
    }, [anchor.normal, _q, _n]);

    // Geometry built once, shared across all anchor switches.
    const { postGeom, gemGeom, backGeom } = useMemo(() => {
        const post = new THREE.CylinderGeometry(0.0008, 0.0008, 0.006, 12);
        post.rotateX(Math.PI / 2);
        post.translate(0, 0, -0.001);

        const gem = new THREE.SphereGeometry(0.003, 24, 24);
        gem.translate(0, 0, 0.005);

        const back = new THREE.CylinderGeometry(0.0025, 0.0025, 0.0006, 16);
        back.rotateX(Math.PI / 2);
        back.translate(0, 0, -0.0035);

        return { postGeom: post, gemGeom: gem, backGeom: back };
    }, []);

    useEffect(
        () => () => {
            postGeom.dispose();
            gemGeom.dispose();
            backGeom.dispose();
        },
        [postGeom, gemGeom, backGeom]
    );

    useFrame((_, delta) => {
        if (!innerRef.current) return;
        const dt = Math.min(delta, 0.05);
        const ph2 = ch2Phase?.current ?? 0;
        // Smoothstep 0.72 → 1.0 — same window as body materialization.
        const tD = (() => {
            const t = Math.max(0, Math.min(1, (ph2 - 0.72) / (1.0 - 0.72)));
            return t * t * (3 - 2 * t);
        })();
        const isStudPiece = activeJewelry === studIndex;
        const target = isStudPiece ? tD : 0;
        smoothScale.current = THREE.MathUtils.damp(smoothScale.current, target, 4, dt);
        const s = smoothScale.current;
        innerRef.current.scale.set(s, s, s);
        innerRef.current.visible = s > 0.001;
    });

    return (
        <group ref={groupRef} position={anchor.position}>
            <group ref={innerRef} scale={0}>
                <mesh geometry={postGeom}>
                    <meshPhysicalMaterial color="#dadde3" metalness={0.95} roughness={0.18} />
                </mesh>
                <mesh geometry={gemGeom}>
                    <meshPhysicalMaterial
                        color="#f5f6fa"
                        metalness={0.6}
                        roughness={0.05}
                        clearcoat={1}
                        clearcoatRoughness={0.05}
                    />
                </mesh>
                <mesh geometry={backGeom}>
                    <meshPhysicalMaterial color="#c9ccd2" metalness={0.95} roughness={0.25} />
                </mesh>
            </group>
        </group>
    );
}
