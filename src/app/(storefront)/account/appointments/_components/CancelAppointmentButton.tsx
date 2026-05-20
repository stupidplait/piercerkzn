"use client";

import { useTransition, useState } from "react";
import { cancelAppointmentAction } from "./cancel-action";
import styles from "../appointments.module.css";

interface CancelAppointmentButtonProps {
    appointmentId: string;
}

export function CancelAppointmentButton({ appointmentId }: CancelAppointmentButtonProps) {
    const [isPending, startTransition] = useTransition();
    const [confirmed, setConfirmed] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const handleClick = () => {
        if (!confirmed) {
            setConfirmed(true);
            return;
        }
        startTransition(async () => {
            const result = await cancelAppointmentAction(appointmentId);
            if (result.ok) {
                setMessage("Запись отменена");
            } else {
                setMessage(result.error ?? "Ошибка при отмене");
            }
            setConfirmed(false);
        });
    };

    if (message) {
        return <span className={styles.cancelMessage}>{message}</span>;
    }

    return (
        <button
            onClick={handleClick}
            disabled={isPending}
            className={styles.cancelButton}
            type="button"
        >
            {isPending ? "Отмена..." : confirmed ? "Подтвердить отмену" : "Отменить"}
        </button>
    );
}
