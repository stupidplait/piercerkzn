"use client";

import styles from "./page.module.css";

interface ChooseIntroProps {
    sectionRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * ChooseIntro — discrete 100vh section between hero and Chapter 1.
 *
 * Provides scroll space for the camera/ring/rotation transition. The
 * actual "ВЫБЕРИ" title is rendered *inside the 3D scene* (see
 * `AnimatedChooseText` in WireframeRoom.tsx) so it sits in front of
 * the podium and glows via the bloom pass — no DOM overlay needed.
 *
 * This component just needs to occupy 100vh of the document so the
 * timeline has room to play out, and expose a ref for activeChapter
 * tracking.
 */
export default function ChooseIntro({ sectionRef }: ChooseIntroProps) {
    return <section ref={sectionRef} className={styles.chooseIntroSpacer} aria-hidden="true" />;
}
