"use client";

import { useTransition } from "react";
import { markNotificationReadAction } from "./mark-read-action";
import styles from "../notifications.module.css";

interface MarkAsReadButtonProps {
    notificationId: string;
}

export function MarkAsReadButton({ notificationId }: MarkAsReadButtonProps) {
    const [isPending, startTransition] = useTransition();

    const handleClick = () => {
        startTransition(async () => {
            await markNotificationReadAction(notificationId);
        });
    };

    return (
        <button
            onClick={handleClick}
            disabled={isPending}
            className={styles.markReadButton}
            type="button"
        >
            {isPending ? "..." : "Прочитано"}
        </button>
    );
}
