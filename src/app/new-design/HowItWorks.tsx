"use client";

import styles from "./page.module.css";
import JewelryShowcase from "./JewelryShowcase";
import BodyModelPreview from "./BodyModelPreview";
import ReserveSummary from "./ReserveSummary";
import Ch2Intro from "./Ch2Intro";

/**
 * HowItWorks — scroll-driven 3-chapter storytelling:
 *   Chapter 1: Jewelry Showcase — browse + preview jewelry in the glass ring
 *   Ch2Intro:  100vh spacer hosting the Ch1→Ch2 camera storyboard
 *              (fly back, tilt down, descend toward floor)
 *   Chapter 2: Body Model — select anchor points
 *   Chapter 3: Reserve — summary + CTA to book
 *
 * Each chapter is 100vh. The parent page reads scroll progress per
 * chapter and feeds it into WireframeRoom so the 3D scene reacts.
 */

interface HowItWorksProps {
    chapter1Ref: React.RefObject<HTMLDivElement | null>;
    ch2IntroRef: React.RefObject<HTMLDivElement | null>;
    chapter2Ref: React.RefObject<HTMLDivElement | null>;
    chapter3Ref: React.RefObject<HTMLDivElement | null>;
    activeJewelry: number;
    onJewelryChange: (index: number) => void;
    onNameChange: (name: string) => void;
    activeArea: string;
    onAreaChange: (areaId: string) => void;
    transitionProgress: React.RefObject<number>;
    swapDirection: React.RefObject<number>;
}

export default function HowItWorks({
    chapter1Ref,
    ch2IntroRef,
    chapter2Ref,
    chapter3Ref,
    activeJewelry,
    onJewelryChange,
    onNameChange,
    activeArea,
    onAreaChange,
    transitionProgress,
    swapDirection,
}: HowItWorksProps) {
    return (
        <section className={styles.howItWorks} aria-label="How It Works">
            <JewelryShowcase
                chapterRef={chapter1Ref}
                activeJewelry={activeJewelry}
                onJewelryChange={onJewelryChange}
                onNameChange={onNameChange}
                transitionProgress={transitionProgress}
                swapDirection={swapDirection}
            />
            <Ch2Intro sectionRef={ch2IntroRef} />
            <BodyModelPreview
                chapterRef={chapter2Ref}
                activeArea={activeArea}
                onAreaChange={onAreaChange}
            />
            <ReserveSummary chapterRef={chapter3Ref} activeJewelry={activeJewelry} />
        </section>
    );
}
