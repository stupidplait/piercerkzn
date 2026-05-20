"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import FluidTrailEffect from "../new-design/FluidTrailEffect";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Parses a CSS color string (hex, rgb, rgba) into a THREE.Color
 * plus an alpha channel.
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
        const majorThick = subSize * 0.07;

        for (let i = 0; i <= divX; i++) {
            if (i % subsPerCell === 0) continue;
            const x = -hw + (i / divX) * width;
            minor.push(x, -hh, 0, x, hh, 0);
        }
        for (let j = 0; j <= divY; j++) {
            if (j % subsPerCell === 0) continue;
            const y = -hh + (j / divY) * height;
            minor.push(-hw, y, 0, hw, y, 0);
        }

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

        for (let i = subsPerCell; i < divX; i += subsPerCell) {
            for (let j = subsPerCell; j < divY; j += subsPerCell) {
                const cx = -hw + (i / divX) * width;
                const cy = -hh + (j / divY) * height;
                const z = 0.0015;
                crossLines.push(cx - arm, cy, z, cx + arm, cy, z);
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

    return (
        <group position={position} rotation={rotation}>
            <lineSegments geometry={minorGeom}>
                <lineBasicMaterial color={minorColor} transparent opacity={minorAlpha} fog />
            </lineSegments>
            <mesh geometry={majorGeom}>
                <meshBasicMaterial
                    color={majorColor}
                    transparent
                    opacity={majorAlpha}
                    side={THREE.DoubleSide}
                    fog
                />
            </mesh>
            <mesh geometry={edgeMajorGeom}>
                <meshBasicMaterial
                    color={majorColor}
                    transparent
                    opacity={majorAlpha * 0.25}
                    side={THREE.DoubleSide}
                    fog
                />
            </mesh>
            <lineSegments geometry={crossGeom}>
                <lineBasicMaterial color={crossColor} transparent opacity={crossAlpha} fog />
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

function GlassRing({
    z,
    mouseRef,
}: {
    z: number;
    mouseRef: React.RefObject<{ x: number; y: number }>;
}) {
    const ref = useRef<THREE.Mesh>(null);
    const accEuler = useRef({ x: 0, y: 0 });
    const prevMouse = useRef({ x: 0, y: 0 });
    const _mouseQ = useMemo(() => new THREE.Quaternion(), []);
    const _euler = useMemo(() => new THREE.Euler(), []);
    const _identityQ = useMemo(() => new THREE.Quaternion(), []);

    const geometry = useMemo(() => new THREE.TorusGeometry(1, 0.12, 128, 384), []);
    useEffect(() => () => geometry.dispose(), [geometry]);

    useFrame((_, delta) => {
        if (!ref.current) return;
        const dt = Math.min(delta, 0.05);
        const m = mouseRef.current;

        const vx = m.x - prevMouse.current.x;
        const vy = m.y - prevMouse.current.y;
        prevMouse.current.x = m.x;
        prevMouse.current.y = m.y;

        const dist = Math.sqrt(m.x * m.x + m.y * m.y);
        const distFactor = Math.max(0, 1 - dist * 0.8);
        const rotMag = 0.04 * distFactor;

        accEuler.current.x -= vy * rotMag;
        accEuler.current.y += vx * rotMag;

        const decay = 1 - dt;
        accEuler.current.x *= decay;
        accEuler.current.y *= decay;

        _euler.set(accEuler.current.x, accEuler.current.y, 0);
        _mouseQ.setFromEuler(_euler);

        ref.current.quaternion.premultiply(_mouseQ);
        ref.current.quaternion.slerp(_identityQ, dt * 1.5);
        ref.current.quaternion.normalize();
    });

    return (
        <mesh ref={ref} geometry={geometry} position={[0, 0, z]} scale={2}>
            <MeshTransmissionMaterial
                thickness={0.02}
                roughness={0}
                transmission={1}
                ior={1.25}
                chromaticAberration={0.4}
                envMapIntensity={0.15}
                backside
                backsideThickness={0.1}
                resolution={2048}
                samples={10}
            />
        </mesh>
    );
}

function ParallaxGroup({
    mouseRef,
    children,
}: {
    mouseRef: React.RefObject<{ x: number; y: number }>;
    children: React.ReactNode;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const pos = useRef({ x: 0, y: 0 });
    const vel = useRef({ x: 0, y: 0 });

    useFrame((_, delta) => {
        if (!groupRef.current) return;
        const dt = Math.min(delta, 0.05);
        const m = mouseRef.current;

        const tx = m.x * 0.55;
        const ty = m.y * 0.3;

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

export default function WireframeRoom({
    scopeRef,
    fontUrl,
    mouseRef,
}: {
    scopeRef: React.RefObject<HTMLElement | null>;
    fontUrl: string;
    mouseRef: React.RefObject<{ x: number; y: number }>;
}) {
    const colors = useThemeColors(scopeRef);

    const W = 20;
    const H = 12;
    const D = 34;

    const distToBack = 13;
    const cameraZ = -D + distToBack;
    const backDist = distToBack;

    return (
        <Canvas
            dpr={[1, 2]}
            camera={{
                fov: 60,
                position: [0, 0, cameraZ],
                near: 0.1,
                far: backDist + 20,
            }}
            onCreated={({ camera }) => {
                camera.lookAt(0, 0, -D);
            }}
            gl={{ antialias: true, alpha: true }}
            style={{ position: "absolute", inset: 0 }}
        >
            <color attach="background" args={[colors.bg.r, colors.bg.g, colors.bg.b]} />
            <ParallaxGroup mouseRef={mouseRef}>
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
                />
                <FaceGrid
                    width={W}
                    height={D}
                    position={[0, -H / 2, -D / 2]}
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
                />

                {/* Wordmark removed — the HTML headline overlay serves as
                the primary brand mark. The wireframe room + glass ring
                provide sufficient atmospheric depth without competing text. */}

                <directionalLight position={[0, 2, cameraZ + 3]} intensity={0.3} />
                <Environment resolution={256}>
                    <mesh scale={100}>
                        <sphereGeometry args={[1, 32, 32]} />
                        <meshBasicMaterial color="#000000" side={THREE.BackSide} />
                    </mesh>
                    <Lightformer
                        form="ring"
                        intensity={3}
                        position={[0, 8, 0]}
                        rotation={[Math.PI / 2, 0, 0]}
                        scale={[10, 10, 1]}
                        color="#ffffff"
                    />
                    <Lightformer
                        form="rect"
                        intensity={2}
                        position={[8, 2, 2]}
                        rotation={[0, -Math.PI / 2, 0]}
                        scale={[10, 10, 1]}
                        color="#fff4dd"
                    />
                    <Lightformer
                        form="rect"
                        intensity={1.5}
                        position={[-8, 2, 2]}
                        rotation={[0, Math.PI / 2, 0]}
                        scale={[10, 10, 1]}
                        color="#dce6ff"
                    />
                </Environment>

                <GlassRing z={cameraZ - 6} mouseRef={mouseRef} />
            </ParallaxGroup>
            <EffectComposer>
                <FluidTrailEffect mouseRef={mouseRef} isDark={colors.bg.r < 0.5} />
                <Bloom
                    luminanceThreshold={0.85}
                    luminanceSmoothing={0.3}
                    intensity={0.4}
                    mipmapBlur
                    levels={3}
                />
            </EffectComposer>
        </Canvas>
    );
}
