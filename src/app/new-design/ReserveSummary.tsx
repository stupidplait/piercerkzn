"use client";

import styles from "./page.module.css";
import { useScrollReveal } from "./hooks/useScrollReveal";
import CountUp from "./components/CountUp";
import { JEWELRY_ITEMS } from "./JewelryShowcase";
import { SITE } from "@/lib/site";

function parsePrice(label: string): number {
    const digits = label.replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : 0;
}

/* The visitor's "set" is the active Ch1 piece + the next two in the
   roster — a small assemblage of three. This is the curation the
   studio will hold for 72 hours, and the dossier on the right names
   exactly what's reserved + how much. */
function pickThree(activeIndex: number) {
    const len = JEWELRY_ITEMS.length;
    const i = ((activeIndex % len) + len) % len;
    return [JEWELRY_ITEMS[i], JEWELRY_ITEMS[(i + 1) % len], JEWELRY_ITEMS[(i + 2) % len]];
}

interface ReserveSummaryProps {
    chapterRef: React.RefObject<HTMLDivElement | null>;
    activeJewelry?: number;
}

export default function ReserveSummary({ chapterRef, activeJewelry = 0 }: ReserveSummaryProps) {
    const { isVisible, progress } = useScrollReveal(chapterRef, { once: false });

    const items = pickThree(activeJewelry);
    const total = items.reduce((s, item) => s + parsePrice(item.price), 0);

    return (
        <div
            id="reserve"
            className={`${styles.chapter} ${styles.chapter3}`}
            ref={chapterRef}
            data-visible={isVisible ? "1" : "0"}
            style={{ "--reveal-progress": Math.min(1, progress * 2) } as React.CSSProperties}
        >
            {/* Bottom-left nameplate — chapter title + supporting line.
                Mirrors Ch1 and Ch2 nameplate character: kicker → rule →
                single Cyrillic verb → quiet body subhead. */}
            <div className={styles.nameplate}>
                <span className={styles.nameplateChapter}>Глава 03</span>
                <span className={styles.nameplateRule} aria-hidden="true" />
                <span className={styles.nameplateHeading}>ЗАБРОНИРУЙ</span>
                <span className={styles.nameplateSubhead}>
                    Удержим 72 часа.
                    <br />
                    Оплата в студии.
                </span>
            </div>

            {/* Bottom-right wireframe dossier — etched museum nameplate
                naming the visitor's curation. Total price → assemblage
                items → studio address → single ceremonial Telegram CTA.
                One action. The website ends in the chat thread, not a
                form. */}
            <aside className={styles.dossier} aria-label="Бронирование">
                <div className={styles.dossierTotal}>
                    <CountUp to={total} active={isVisible} duration={1800} />
                    <span className={styles.dossierTotalCurrency}>₽</span>
                </div>
                <span className={styles.dossierTotalLabel}>Сумма брони</span>

                <span className={styles.dossierRule} aria-hidden="true" />

                <ul className={styles.dossierItems}>
                    {items.map((item) => (
                        <li key={item.id} className={styles.dossierItem}>
                            <span className={styles.dossierItemTick} aria-hidden="true" />
                            <span className={styles.dossierItemName}>{item.name}</span>
                            <span className={styles.dossierItemPrice}>{item.price}</span>
                        </li>
                    ))}
                </ul>

                <span className={styles.dossierRule} aria-hidden="true" />

                <dl className={styles.dossierStudio}>
                    <dt className={styles.dossierStudioLabel}>Студия</dt>
                    <dd className={styles.dossierStudioValue}>{SITE.address}</dd>
                </dl>

                <a
                    className={styles.dossierCta}
                    href={SITE.telegram}
                    target="_blank"
                    rel="noreferrer noopener"
                >
                    <span className={styles.dossierCtaText}>Передать в Telegram</span>
                    <span className={styles.dossierCtaArrow} aria-hidden="true">
                        →
                    </span>
                </a>
            </aside>
        </div>
    );
}
