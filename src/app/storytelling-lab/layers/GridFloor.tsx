"use client";

import styles from "./layers.module.css";

/** 02 — Perspective grid floor receding to horizon. */
export default function GridFloor() {
    return (
        <div className={styles.gridFloor} aria-hidden="true">
            <div className={styles.gridFloorPlane} />
            <div className={styles.gridFloorHorizon} />
        </div>
    );
}
