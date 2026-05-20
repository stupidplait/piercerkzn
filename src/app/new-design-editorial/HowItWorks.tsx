"use client";

import JewelryShowcaseEditorial from "./JewelryShowcase";
import BodyModelPreview from "../new-design/BodyModelPreview";
import ReserveSummary from "../new-design/ReserveSummary";

interface HowItWorksProps {
    chapter1Ref: React.RefObject<HTMLDivElement | null>;
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
        <section aria-label="How It Works">
            <JewelryShowcaseEditorial
                chapterRef={chapter1Ref}
                activeJewelry={activeJewelry}
                onJewelryChange={onJewelryChange}
                onNameChange={onNameChange}
                transitionProgress={transitionProgress}
                swapDirection={swapDirection}
            />
            <BodyModelPreview
                chapterRef={chapter2Ref}
                activeArea={activeArea}
                onAreaChange={onAreaChange}
            />
            <ReserveSummary chapterRef={chapter3Ref} activeJewelry={activeJewelry} />
        </section>
    );
}
