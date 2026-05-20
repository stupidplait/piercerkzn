"use client";

/**
 * ScrollJewel (page12) — fixed-viewport jewel that flies out of the hero
 * window and follows the user as they scroll, with dramatic rotations and
 * morph transitions.
 *
 * Layout:
 *   The canvas lives in a position:fixed inset:0 overlay (pointer-events:none,
 *   z-index behind the nav pill but above body content). The parent hero
 *   window is not used for rendering — it renders only its frame / url bar.
 *
 * Motion:
 *   page progress r = scrollY / (docHeight - innerHeight)      (clamped 0..1)
 *   hero progress  h = scrollY / (innerHeight * 1.2)           (clamped 0..1)
 *
 *   While hero is on screen (h < 1), the jewel's world position is locked to
 *   the *centre of the hero window element* projected through the camera, so
 *   it appears pinned inside the window frame.
 *
 *   Past the hero (h == 1), the jewel flies to a parking world-position on
 *   the right of the viewport and *orbits* through a small figure-8 as the
 *   user scrolls further, while the whole group keeps tumbling and cycling
 *   through Ring → Stud → Hoop → Labret every ~20% of page scroll.
 */

import { useEffect, useMemo, useRef, Suspense } from "react";
import type { RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, ContactShadows } from "@react-three/drei";
import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    Points,
    PointsMaterial,
    Vector3,
} from "three";

type Zone = {
    /** Centre in viewport CSS pixels. */
    cx: number;
    cy: number;
    /** Top / bottom edges in viewport CSS pixels. */
    top: number;
    bottom: number;
    /** Height in viewport CSS pixels. */
    h: number;
    /** Variant index this zone owns (0..3). */
    variant: number;
};

type Metrics = {
    pageProgress: number; // 0..1 over the whole document
    heroProgress: number; // 0..1 over 1.2 * innerHeight
    /** viewport size (for scale hint) */
    vw: number;
    vh: number;
    /** Ordered detectors along the scroll journey:
     *  hero window → chapter 0..2 → footer park.
     *  The travelling jewel's owner is the zone whose centre is closest
     *  to viewport centre; when that changes, a scroll-gated handover
     *  runs (old fades in place, new slides down from above its zone). */
    zones: Zone[];
    /** Index of the zone whose centre is currently closest to viewport
     *  centre. -1 when no zone is in range yet (early page load). */
    primaryIdx: number;
    /** Absolute scroll Y and the per-compute() delta. A zero delta means
     *  the user paused scrolling; downstream emission + slide progress
     *  are gated on |delta| so the scene freezes. */
    scrollY: number;
    scrollDelta: number;
};

function useScrollMetrics(): {
    ref: RefObject<Metrics>;
    computeRef: RefObject<() => void>;
} {
    const ref = useRef<Metrics>({
        pageProgress: 0,
        heroProgress: 0,
        vw: 1,
        vh: 1,
        zones: [],
        primaryIdx: -1,
        scrollY: 0,
        scrollDelta: 0,
    });
    const computeRef = useRef<() => void>(() => {});
    useEffect(() => {
        let raf = 0;
        let running = true;
        let prevScrollY = window.scrollY;
        const compute = () => {
            const vw = window.innerWidth || 1;
            const vh = window.innerHeight || 1;
            const doc = Math.max(document.documentElement.scrollHeight - vh, 1);
            const y = window.scrollY;
            ref.current.pageProgress = Math.max(0, Math.min(1, y / doc));
            ref.current.heroProgress = Math.max(0, Math.min(1, y / (vh * 1.2)));
            ref.current.scrollDelta = y - prevScrollY;
            ref.current.scrollY = y;
            prevScrollY = y;

            // Collect the ordered zone rects along the scroll journey.
            // Order matters — handovers are decided by which zone is
            // closest to the viewport centre, so we walk them in the
            // natural page order.
            const zones: Zone[] = [];
            const pushRect = (el: HTMLElement, variant: number) => {
                const r = el.getBoundingClientRect();
                zones.push({
                    cx: r.left + r.width / 2,
                    cy: r.top + r.height / 2,
                    top: r.top,
                    bottom: r.bottom,
                    h: r.height,
                    variant,
                });
            };

            // 0 — Hero window (Ring)
            const win = document.querySelector("[data-jewel-target]") as HTMLElement | null;
            if (win) pushRect(win, 0);

            // 1..3 — Chapters (Stud / Hoop / Labret)
            const chapters = Array.from(
                document.querySelectorAll("[data-jewel-chapter]")
            ) as HTMLElement[];
            chapters.sort((a, b) => {
                const ai = Number(a.dataset.jewelChapter ?? 0);
                const bi = Number(b.dataset.jewelChapter ?? 0);
                return ai - bi;
            });
            chapters.forEach((el, i) => {
                // Variant map: chapter 0 → Stud(1), 1 → Hoop(2), 2 → Labret(3).
                pushRect(el, Math.min(3, i + 1));
            });

            // 4 — Footer park (Ring again, wraps the journey full circle)
            const park = document.querySelector("[data-jewel-park]") as HTMLElement | null;
            if (park) pushRect(park, 0);

            // Primary = zone whose centre is closest to the viewport
            // centre. No distance gate here — every moment of the page
            // has a nearest zone, and the handover machinery downstream
            // handles the fade when the jewel isn't quite in the zone
            // yet. This is what makes the scene feel continuous.
            let primaryIdx = -1;
            let bestDist = Infinity;
            const centre = vh / 2;
            for (let i = 0; i < zones.length; i++) {
                const d = Math.abs(zones[i].cy - centre);
                if (d < bestDist) {
                    bestDist = d;
                    primaryIdx = i;
                }
            }

            ref.current.zones = zones;
            ref.current.primaryIdx = primaryIdx;
            ref.current.vw = vw;
            ref.current.vh = vh;
        };
        // Expose the compute fn so the R3F useFrame can refresh metrics
        // synchronously just before reading them — this eliminates the
        // one-frame lag that caused visible "jumps" during fast scrolls.
        computeRef.current = compute;
        // Loop every rAF so metrics stay fresh even between scroll events —
        // this eliminates the visible "flick" that happened when the scroll
        // listener lagged a frame behind the R3F render loop.
        const loop = () => {
            if (!running) return;
            compute();
            raf = requestAnimationFrame(loop);
        };
        compute();
        raf = requestAnimationFrame(loop);
        window.addEventListener("resize", compute);
        return () => {
            running = false;
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", compute);
        };
    }, []);
    return { ref, computeRef };
}

function usePointer(): RefObject<{ x: number; y: number }> {
    const ref = useRef({ x: 0, y: 0 });
    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            ref.current.x = (e.clientX / w) * 2 - 1;
            ref.current.y = (e.clientY / h) * 2 - 1;
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        return () => window.removeEventListener("pointermove", onMove);
    }, []);
    return ref;
}

/* ── Variants ────────────────────────────────────────────────────── */
function Ring() {
    return (
        <group rotation={[0.35, 0.4, 0]}>
            <mesh castShadow receiveShadow>
                <torusGeometry args={[1.0, 0.22, 64, 180]} />
                <meshStandardMaterial
                    color="#e8c677"
                    metalness={1}
                    roughness={0.15}
                    envMapIntensity={1.4}
                />
            </mesh>
            <mesh position={[0, 1.0, 0]} castShadow>
                <icosahedronGeometry args={[0.3, 0]} />
                <meshStandardMaterial
                    color="#ffffff"
                    metalness={0.9}
                    roughness={0.05}
                    emissive="#ffeedd"
                    emissiveIntensity={0.25}
                    envMapIntensity={2}
                />
            </mesh>
        </group>
    );
}

function Stud() {
    return (
        <group rotation={[0.1, 0.5, 0]}>
            <mesh castShadow>
                <sphereGeometry args={[0.55, 48, 48]} />
                <meshStandardMaterial
                    color="#d9d9df"
                    metalness={1}
                    roughness={0.12}
                    envMapIntensity={1.6}
                />
            </mesh>
            <mesh position={[0, 0.65, 0]} castShadow>
                <octahedronGeometry args={[0.42, 0]} />
                <meshStandardMaterial
                    color="#b9e0ff"
                    metalness={0.7}
                    roughness={0.08}
                    emissive="#4fd1ff"
                    emissiveIntensity={0.3}
                />
            </mesh>
            <mesh position={[0, -0.55, 0]}>
                <cylinderGeometry args={[0.07, 0.07, 1.1, 20]} />
                <meshStandardMaterial color="#c9c9d0" metalness={1} roughness={0.2} />
            </mesh>
        </group>
    );
}

function Hoop() {
    return (
        <group rotation={[0.2, 0.8, 0]}>
            <mesh castShadow receiveShadow>
                <torusGeometry args={[1.1, 0.12, 48, 200]} />
                <meshStandardMaterial
                    color="#e3b9f0"
                    metalness={1}
                    roughness={0.18}
                    envMapIntensity={1.5}
                />
            </mesh>
            <mesh position={[1.1, 0, 0]} castShadow>
                <sphereGeometry args={[0.18, 32, 32]} />
                <meshStandardMaterial
                    color="#ffffff"
                    metalness={0.9}
                    roughness={0.04}
                    emissive="#ff7ee5"
                    emissiveIntensity={0.35}
                />
            </mesh>
        </group>
    );
}

function Labret() {
    return (
        <group rotation={[0.25, 0.3, 0]}>
            <mesh position={[0, 0.55, 0]} castShadow>
                <cylinderGeometry args={[0.55, 0.55, 0.08, 48]} />
                <meshStandardMaterial
                    color="#6d5aff"
                    metalness={0.9}
                    roughness={0.2}
                    emissive="#6d5aff"
                    emissiveIntensity={0.18}
                />
            </mesh>
            <mesh position={[0, 0.8, 0]} castShadow>
                <dodecahedronGeometry args={[0.28, 0]} />
                <meshStandardMaterial
                    color="#ffffff"
                    metalness={0.85}
                    roughness={0.06}
                    emissive="#ffffff"
                    emissiveIntensity={0.22}
                />
            </mesh>
            <mesh>
                <cylinderGeometry args={[0.08, 0.08, 1.2, 20]} />
                <meshStandardMaterial color="#c9c9d0" metalness={1} roughness={0.22} />
            </mesh>
            <mesh position={[0, -0.65, 0]} castShadow>
                <cylinderGeometry args={[0.35, 0.35, 0.07, 40]} />
                <meshStandardMaterial color="#c9c9d0" metalness={1} roughness={0.25} />
            </mesh>
        </group>
    );
}

/* ── Live stage ──────────────────────────────────────────────────── */
function LiveStage({
    metricsRef,
    computeRef,
    pointerRef,
}: {
    metricsRef: RefObject<Metrics>;
    computeRef: RefObject<() => void>;
    pointerRef: RefObject<{ x: number; y: number }>;
}) {
    // Each variant lives in its OWN group so we can position and fade
    // them independently — required for the handover slide where two
    // variants are on screen at once (outgoing at its zone, incoming
    // sliding down from above the new zone).
    const ringG = useRef<Group>(null);
    const studG = useRef<Group>(null);
    const hoopG = useRef<Group>(null);
    const labretG = useRef<Group>(null);
    const initedRef = useRef(false);

    // Cached world-space vector for projecting CSS -> NDC -> world
    const tmp = useMemo(() => new Vector3(), []);
    const { camera, size } = useThree();

    // Damped pointer parallax — avoids jittery 1:1 mouse tracking and gives
    // the jewel a soft, weighted feel when the cursor moves.
    const pxRef = useRef(0);
    const pyRef = useRef(0);

    // ── Travelling-scene handover state ──────────────────────────────
    // primaryIdx      index of the zone currently owning the jewel
    // outgoingIdx     previous owner during a handover (-1 when idle)
    // slideT          0..1 handover progress — ADVANCED BY SCROLL DELTA,
    //                 not by time. That's the key mechanic: pause the
    //                 scroll and the two jewels freeze in place, particle
    //                 emission stops, the slide suspends. Resume scroll
    //                 and everything continues.
    const primaryIdxRef = useRef(-1);
    const outgoingIdxRef = useRef(-1);
    const slideTRef = useRef(1);
    // Remember the outgoing zone's rect so the exiting jewel doesn't
    // teleport if the underlying `zones[]` array identity changes.
    const outgoingZoneRef = useRef<Zone | null>(null);

    // ── Particle pool (ring buffer, per-particle age + colour) ─────────
    // Emission is continuous during handovers gated on scroll velocity,
    // so we need a ring buffer rather than a one-shot burst. Each slot
    // carries its own age so a recycled slot fades in as a fresh spark.
    const PARTICLE_COUNT = 160;
    const PARTICLE_LIFE = 1.1;
    const particlePositions = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
    const particleVelocities = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
    const particleAges = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
    const particleBaseColors = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
    const particleColors = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
    const particleCursorRef = useRef(0);
    const burstPointsRef = useRef<Points | null>(null);

    const particleGeometry = useMemo(() => {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(particlePositions, 3));
        g.setAttribute("color", new BufferAttribute(particleColors, 3));
        // Park far off-screen until first emit so they don't flash at origin.
        for (let i = 0; i < particlePositions.length; i++) {
            particlePositions[i] = 9999;
        }
        for (let i = 0; i < particleAges.length; i++) {
            particleAges[i] = PARTICLE_LIFE + 1; // "dead"
        }
        return g;
    }, [particlePositions, particleColors, particleAges]);

    // Soft round sprite — 64px canvas with a radial gradient. The alpha
    // gradient turns the default square gl.POINTS into an actual glowing
    // spark. Combined with additive blending and per-particle vertex
    // colours we get per-spark fading without a shader.
    const sparkleTexture = useMemo(() => {
        if (typeof document === "undefined") return null;
        const sz = 64;
        const canvas = document.createElement("canvas");
        canvas.width = sz;
        canvas.height = sz;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        const grad = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
        grad.addColorStop(0.0, "rgba(255,255,255,1.00)");
        grad.addColorStop(0.25, "rgba(255,255,255,0.80)");
        grad.addColorStop(0.55, "rgba(255,255,255,0.25)");
        grad.addColorStop(1.0, "rgba(255,255,255,0.00)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, sz, sz);
        const tex = new CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }, []);
    const particleMaterial = useMemo(
        () =>
            new PointsMaterial({
                size: 0.22,
                sizeAttenuation: true,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                blending: AdditiveBlending,
                map: sparkleTexture ?? undefined,
                vertexColors: true,
            }),
        [sparkleTexture]
    );

    // Bright palette tuned for additive blending (pale cores keep their
    // colour when summed onto a dark background, saturated colours
    // clip to white).
    const VARIANT_COLORS = useMemo(() => ["#ffe0a3", "#cfe9ff", "#f4cffd", "#d9cfff"], []);

    // Reusable Color for hex parsing — avoid allocating per emit.
    const tmpColor = useMemo(() => new Color(), []);

    const emitParticles = (count: number, x: number, y: number, z: number, hex: string) => {
        tmpColor.set(hex);
        for (let n = 0; n < count; n++) {
            const i = particleCursorRef.current;
            particleCursorRef.current = (i + 1) % PARTICLE_COUNT;
            const ix = i * 3;
            particlePositions[ix + 0] = x;
            particlePositions[ix + 1] = y;
            particlePositions[ix + 2] = z;
            // Uniform random direction on a sphere, biased upward so the
            // cloud drifts like embers rather than a symmetric explosion.
            const theta = Math.random() * Math.PI * 2;
            const u = Math.random() * 2 - 1;
            const rad = Math.sqrt(1 - u * u);
            const speed = 0.8 + Math.random() * 1.6;
            particleVelocities[ix + 0] = rad * Math.cos(theta) * speed;
            particleVelocities[ix + 1] = rad * Math.sin(theta) * speed + 0.35;
            particleVelocities[ix + 2] = u * speed * 0.22;
            particleBaseColors[ix + 0] = tmpColor.r;
            particleBaseColors[ix + 1] = tmpColor.g;
            particleBaseColors[ix + 2] = tmpColor.b;
            // Start fully lit — the per-frame age fade writes the live
            // vertex colour.
            particleColors[ix + 0] = tmpColor.r;
            particleColors[ix + 1] = tmpColor.g;
            particleColors[ix + 2] = tmpColor.b;
            particleAges[i] = 0;
        }
        particleGeometry.attributes.position.needsUpdate = true;
        particleGeometry.attributes.color.needsUpdate = true;
    };

    useFrame((_, dt) => {
        // Refresh metrics synchronously so target positions use the scroll
        // value of the CURRENT frame, not the previous one.
        computeRef?.current?.();
        const m = metricsRef.current;
        if (!m) return;
        const page = m.pageProgress;
        const vh = m.vh;
        const zones = m.zones;
        const primaryIdx = m.primaryIdx;

        const projectCssToWorld = (cx: number, cy: number) => {
            const ndcX = (cx / size.width) * 2 - 1;
            const ndcY = -((cy / size.height) * 2 - 1);
            tmp.set(ndcX, ndcY, 0.5).unproject(camera);
            const dir = tmp.sub(camera.position).normalize();
            if (Math.abs(dir.z) < 1e-4) return null;
            const t = -camera.position.z / dir.z;
            return {
                x: camera.position.x + dir.x * t,
                y: camera.position.y + dir.y * t,
            };
        };

        const zoneScale = (h: number, factor: number) =>
            Math.max(0.45, Math.min(0.85, (h / vh) * factor));

        // ── Handover detection ───────────────────────────────────────
        // When the closest-to-centre zone changes, start a new handover.
        // If a handover is already running we override: commit whatever
        // WAS the incoming jewel to outgoing and begin a fresh slide with
        // the new zone. That keeps the scene coherent during fling
        // scrolls — the intermediate jewel is summarily discarded rather
        // than left half-slid.
        if (primaryIdx >= 0 && primaryIdx !== primaryIdxRef.current) {
            if (primaryIdxRef.current >= 0) {
                outgoingIdxRef.current = primaryIdxRef.current;
                outgoingZoneRef.current = zones[primaryIdxRef.current] ?? null;
                slideTRef.current = 0;
            } else {
                // First time we acquired a primary — no handover.
                outgoingIdxRef.current = -1;
                slideTRef.current = 1;
            }
            primaryIdxRef.current = primaryIdx;
        }

        // Advance slide only while the user is actually scrolling.
        // 280px of scroll per full handover feels about right — fast
        // enough to not drag on a normal read, slow enough that a
        // thumb-flick can still see both jewels coexist mid-way.
        const absDelta = Math.abs(m.scrollDelta);
        if (outgoingIdxRef.current >= 0) {
            slideTRef.current = Math.min(1, slideTRef.current + absDelta / 280);
            if (slideTRef.current >= 1) {
                outgoingIdxRef.current = -1;
                outgoingZoneRef.current = null;
            }
        }

        // ── Per-variant render state ────────────────────────────────
        // Pass-specific transforms. `jewelState[v]` is populated only
        // for the variant(s) we want visible this frame.
        type JewelState = {
            x: number;
            y: number;
            z: number;
            scale: number;
            opacity: number;
        };
        const jewelStates: (JewelState | null)[] = [null, null, null, null];

        // Primary jewel — at its zone's centre, with a scroll-gated
        // slide-in from above while handover is running.
        let primaryWorldX = 0;
        let primaryWorldY = 0;
        if (primaryIdx >= 0 && zones[primaryIdx]) {
            const pz = zones[primaryIdx];
            const pcxCss = pz.cx;
            // slideT=0 → start above zone by ~35 % of its height
            // slideT=1 → land at zone centre
            const slideT = slideTRef.current;
            const eased = slideT * slideT * (3 - 2 * slideT);
            const pcyCss = MathUtils.lerp(pz.top - pz.h * 0.35, pz.cy, eased);
            const w = projectCssToWorld(pcxCss, pcyCss);
            if (w) {
                primaryWorldX = w.x;
                primaryWorldY = w.y;
            }
            // Scale matched to the zone — hero/park slots are bigger
            // panels, chapter rows are tighter.
            const factor = pz.variant === 0 ? (primaryIdx === 0 ? 0.7 : 0.8) : 0.55;
            const scale = zoneScale(pz.h, factor);
            // Opacity fade-in over the first 25% of the slide (or 1
            // right away when no handover is running).
            const inOpacity =
                outgoingIdxRef.current < 0 ? 1 : MathUtils.smoothstep(slideT, 0.02, 0.28);
            jewelStates[pz.variant] = {
                x: primaryWorldX,
                y: primaryWorldY,
                z: 0,
                scale,
                opacity: inOpacity,
            };
        }

        // Outgoing jewel — stays on its zone centre, fades out.
        let outgoingWorldX = 0;
        let outgoingWorldY = 0;
        let outgoingOpacity = 0;
        let outgoingColor = VARIANT_COLORS[0];
        if (outgoingIdxRef.current >= 0 && outgoingZoneRef.current) {
            const oz = outgoingZoneRef.current;
            const w = projectCssToWorld(oz.cx, oz.cy);
            if (w) {
                outgoingWorldX = w.x;
                outgoingWorldY = w.y;
            }
            const factor = oz.variant === 0 ? 0.75 : 0.55;
            const scale = zoneScale(oz.h, factor);
            // Fade 1 → 0 across the full slide. Hold near-solid for the
            // first 15 % so it doesn't vanish before the incoming has
            // begun its entry.
            const t = slideTRef.current;
            outgoingOpacity = 1 - MathUtils.smoothstep(t, 0.1, 0.95);
            outgoingColor = VARIANT_COLORS[oz.variant];
            // Same-variant case: primary and outgoing are the same group.
            // Sum their opacities (they render in the same slot anyway;
            // the actual position is the primary's, which is correct).
            const existing = jewelStates[oz.variant];
            if (existing) {
                // Don't add — the primary position rules. Just keep
                // opacity maxed so it stays visible through the move.
                existing.opacity = Math.max(existing.opacity, outgoingOpacity);
            } else {
                jewelStates[oz.variant] = {
                    x: outgoingWorldX,
                    y: outgoingWorldY,
                    z: 0,
                    scale,
                    opacity: outgoingOpacity,
                };
            }
        }

        // ── Pointer-weighted tumble common to every variant ─────────
        const time = performance.now() / 1000;
        const rawPx = pointerRef.current?.x ?? 0;
        const rawPy = pointerRef.current?.y ?? 0;
        pxRef.current = MathUtils.damp(pxRef.current, rawPx, 5, dt);
        pyRef.current = MathUtils.damp(pyRef.current, rawPy, 5, dt);
        const px = pxRef.current;
        const py = pyRef.current;
        const scrollSpin = page * Math.PI * 0.6;
        const rotY = time * 0.25 + scrollSpin + px * 0.22;
        const rotX = Math.sin(time * 0.45) * 0.08 + page * Math.PI * 0.25 - py * 0.16;
        const rotZ = Math.sin(time * 0.3) * 0.08 + px * 0.04;

        // ── Apply to variant groups ─────────────────────────────────
        const variantRefs = [ringG, studG, hoopG, labretG];
        for (let v = 0; v < variantRefs.length; v++) {
            const g = variantRefs[v].current;
            if (!g) continue;
            const state = jewelStates[v];
            if (!state) {
                if (g.visible) g.visible = false;
                continue;
            }
            // First-frame snap so nothing "flies in" from origin.
            if (!initedRef.current) {
                g.position.set(state.x, state.y, state.z);
            } else {
                // Tiny damp so scale/position changes feel fluid even
                // when crossing sub-frame.
                g.position.x = MathUtils.damp(g.position.x, state.x, 18, dt);
                g.position.y = MathUtils.damp(g.position.y, state.y, 18, dt);
                g.position.z = MathUtils.damp(g.position.z, state.z, 18, dt);
            }
            g.scale.setScalar(state.scale);
            g.rotation.set(rotX, rotY, rotZ);
            g.visible = state.opacity > 0.01;
            g.traverse((obj) => {
                const mesh = obj as Mesh;
                if (mesh.isMesh) {
                    const mat = mesh.material as MeshStandardMaterial;
                    if (mat && "opacity" in mat) {
                        mat.transparent = state.opacity < 0.99;
                        mat.opacity = state.opacity;
                    }
                }
            });
        }
        initedRef.current = true;

        // ── Particle emission ───────────────────────────────────────
        // Continuous during handovers only, AND gated on scroll velocity.
        // This is what makes "pause scroll = no new sparks" work.
        if (outgoingIdxRef.current >= 0 && absDelta > 0.5) {
            // Capped at 8/frame so a fling doesn't exhaust the pool.
            const count = Math.min(8, Math.max(1, Math.ceil(absDelta / 3)));
            emitParticles(count, outgoingWorldX, outgoingWorldY, 0, outgoingColor);
        }

        // ── Particle integration ────────────────────────────────────
        // Age every live particle, integrate position, and write a faded
        // vertex colour (base * (1 - age/life)). Dead slots get parked
        // off-screen so they aren't drawn.
        const damping = Math.pow(0.88, dt * 60);
        let anyAlive = false;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const age = particleAges[i];
            if (age >= PARTICLE_LIFE) continue;
            anyAlive = true;
            const newAge = age + dt;
            particleAges[i] = newAge;
            const ix = i * 3;
            particlePositions[ix + 0] += particleVelocities[ix + 0] * dt;
            particlePositions[ix + 1] += particleVelocities[ix + 1] * dt;
            particlePositions[ix + 2] += particleVelocities[ix + 2] * dt;
            particleVelocities[ix + 0] *= damping;
            particleVelocities[ix + 1] *= damping;
            particleVelocities[ix + 2] *= damping;
            if (newAge >= PARTICLE_LIFE) {
                // Park the dead slot out of frustum so future vertex
                // colour writes don't briefly flash a black dot.
                particlePositions[ix + 0] = 9999;
                particlePositions[ix + 1] = 9999;
                particlePositions[ix + 2] = 9999;
                particleColors[ix + 0] = 0;
                particleColors[ix + 1] = 0;
                particleColors[ix + 2] = 0;
            } else {
                const n = newAge / PARTICLE_LIFE;
                // Soft head/tail: brighten fast, then long fade.
                const env = n < 0.12 ? n / 0.12 : 1 - (n - 0.12) / 0.88;
                const alpha = Math.max(0, env);
                particleColors[ix + 0] = particleBaseColors[ix + 0] * alpha;
                particleColors[ix + 1] = particleBaseColors[ix + 1] * alpha;
                particleColors[ix + 2] = particleBaseColors[ix + 2] * alpha;
            }
        }
        particleGeometry.attributes.position.needsUpdate = true;
        particleGeometry.attributes.color.needsUpdate = true;
        const pts = burstPointsRef.current;
        if (pts) pts.visible = anyAlive;
    });

    return (
        <>
            <group ref={ringG}>
                <Ring />
            </group>
            <group ref={studG}>
                <Stud />
            </group>
            <group ref={hoopG}>
                <Hoop />
            </group>
            <group ref={labretG}>
                <Labret />
            </group>
            <points
                ref={burstPointsRef}
                geometry={particleGeometry}
                material={particleMaterial}
                frustumCulled={false}
                visible={false}
            />
        </>
    );
}

function LiveScene() {
    const { ref: metricsRef, computeRef } = useScrollMetrics();
    const pointerRef = usePointer();
    return <LiveStage metricsRef={metricsRef} computeRef={computeRef} pointerRef={pointerRef} />;
}

export function ScrollJewel() {
    // Skip the entire canvas when the user prefers reduced motion.
    // This removes idle rAF cost, tumble, breathing, and GPU work.
    if (typeof window !== "undefined") {
        try {
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                return null;
            }
        } catch {
            /* noop */
        }
    }
    return (
        <div
            aria-hidden
            style={{
                position: "fixed",
                inset: 0,
                pointerEvents: "none",
                // Above section backgrounds so the jewel stays visible;
                // pointer-events:none + parking slot in the footer keep it
                // out of interactive / text regions.
                zIndex: 3,
            }}
        >
            <Canvas
                camera={{ position: [0, 0.4, 4.4], fov: 38 }}
                dpr={[1, 2]}
                style={{ pointerEvents: "none" }}
                gl={{
                    antialias: true,
                    alpha: true,
                    powerPreference: "high-performance",
                }}
            >
                <ambientLight intensity={0.45} />
                <spotLight
                    position={[5, 7, 5]}
                    intensity={70}
                    angle={0.45}
                    penumbra={1}
                    color="#ffd7a0"
                    castShadow
                />
                <spotLight
                    position={[-6, 3, -3]}
                    intensity={40}
                    angle={0.6}
                    penumbra={1}
                    color="#9a7cff"
                />
                <LiveScene />
                <Suspense fallback={null}>
                    <Environment preset="studio" />
                    <ContactShadows position={[0, -1.45, 0]} opacity={0.5} blur={2.6} scale={6} />
                </Suspense>
            </Canvas>
        </div>
    );
}
