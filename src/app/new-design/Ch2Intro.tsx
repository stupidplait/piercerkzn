"use client";

import styles from "./page.module.css";

interface Ch2IntroProps {
    sectionRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Ch2Intro — 100vh spacer between Chapter 1 and Chapter 2. Same
 * pattern as ChooseIntro: just a scroll-space buffer. Doubles the
 * viewport range over which the Ch1→Ch2 camera storyboard plays
 * out (fly back → tilt down → descend toward floor) so the four
 * stages each get ~50vh instead of ~25vh, breathing room.
 *
 * No DOM content needed; the floor-zoom storyboard happens inside
 * the 3D scene (see CameraDolly's stage A→D in WireframeRoom.tsx).
 */
export default function Ch2Intro({ sectionRef }: Ch2IntroProps) {
    return <section ref={sectionRef} className={styles.chooseIntroSpacer} aria-hidden="true" />;
}
