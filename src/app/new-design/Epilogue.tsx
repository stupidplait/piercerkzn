"use client";

import styles from "./page.module.css";
import { SITE } from "@/lib/site";

/**
 * Epilogue — the quiet afterimage between the climax (Ch3 ЗАБРОНИРУЙ)
 * and the site footer. Three brief columns: Студия / Пирсер / Уход.
 * No CTAs, no scroll-driven motion, no chapter heading. The 3D scene
 * stays at Ch3's dollied-back position so the visitor reads this in
 * front of the same room they just walked through.
 */
export default function Epilogue() {
    return (
        <section className={styles.epilogue} aria-label="После брони">
            <span className={styles.epilogueRule} aria-hidden="true" />

            <div className={styles.epilogueGrid}>
                <article className={styles.epilogueCol}>
                    <h3 className={styles.epilogueLabel}>Студия</h3>
                    <p className={styles.epilogueBody}>
                        {SITE.address}. С {SITE.foundedYear} года. Один стол, один пирсер, один
                        календарь — без сменных мастеров и мультибукинга.
                    </p>
                </article>

                <article className={styles.epilogueCol}>
                    <h3 className={styles.epilogueLabel}>Пирсер</h3>
                    <p className={styles.epilogueBody}>
                        Десять лет с титаном ASTM F136 и золотом. Стандарты APP. Только проверенные
                        процедуры — никаких пистолетов, никакой импровизации.
                    </p>
                </article>

                <article className={styles.epilogueCol}>
                    <h3 className={styles.epilogueLabel}>Уход</h3>
                    <p className={styles.epilogueBody}>
                        Стерильный физраствор два раза в день. Не трогай руками. Полное заживление —
                        8–16 недель в зависимости от зоны.
                    </p>
                </article>
            </div>
        </section>
    );
}
