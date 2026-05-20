"use client";

import { useEffect, useState } from "react";
import styles from "./layers.module.css";

const QUOTES = [
    { text: "«Ношу 2 года — как новое. Никаких реакций.»", who: "Анна, 24" },
    { text: "«Лёгкое, не цепляет волосы.»", who: "Карина, 30" },
    { text: "«Сделали аккуратно, бережно. Без боли.»", who: "Мария, 19" },
    { text: "«Прошло за 4 недели — как обещали.»", who: "Дима, 27" },
    { text: "«Вернулась за вторым проколом — рекомендую.»", who: "Лиля, 22" },
];

/**
 * 07 — Patron quotes drifting.
 *
 * A low-opacity Russian testimonial drifts in/out near the lower-left
 * background area. Cycles through a handful of quotes. Builds trust
 * silently without overwhelming the focal piece.
 */
export default function PatronQuotes() {
    const [idx, setIdx] = useState(0);

    useEffect(() => {
        const t = setInterval(() => {
            setIdx((i) => (i + 1) % QUOTES.length);
        }, 7000);
        return () => clearInterval(t);
    }, []);

    const q = QUOTES[idx];
    return (
        <div className={styles.quotes} aria-hidden="true">
            <p className={styles.quotesText} key={idx}>
                {q.text}
                <br />
                <span className={styles.quotesWho}>— {q.who}</span>
            </p>
        </div>
    );
}
