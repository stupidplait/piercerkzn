import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { db, appointments, appointmentServices, services } from "@/db";

import { CancelAppointmentButton } from "./_components/CancelAppointmentButton";
import styles from "./appointments.module.css";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const customerAppointments = await db
        .select({
            id: appointments.id,
            referenceNumber: appointments.referenceNumber,
            date: appointments.date,
            timeStart: appointments.timeStart,
            timeEnd: appointments.timeEnd,
            status: appointments.status,
            createdAt: appointments.createdAt,
        })
        .from(appointments)
        .where(eq(appointments.customerId, customerId))
        .orderBy(desc(appointments.date), desc(appointments.timeStart));

    // Fetch service names for all appointments
    const appointmentIds = customerAppointments.map((a) => a.id);
    let appointmentServiceMap: Record<string, string[]> = {};
    if (appointmentIds.length > 0) {
        const svcRows = await db
            .select({
                appointmentId: appointmentServices.appointmentId,
                serviceName: services.name,
            })
            .from(appointmentServices)
            .innerJoin(services, eq(appointmentServices.serviceId, services.id))
            .where(inArray(appointmentServices.appointmentId, appointmentIds));

        appointmentServiceMap = svcRows.reduce(
            (acc, row) => {
                if (!acc[row.appointmentId]) acc[row.appointmentId] = [];
                acc[row.appointmentId].push(row.serviceName);
                return acc;
            },
            {} as Record<string, string[]>
        );
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Мои записи</h1>

            {customerAppointments.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>У вас пока нет записей</p>
                    <Link href="/booking" className={styles.ctaLink}>
                        Записаться на приём
                    </Link>
                </div>
            ) : (
                <ul className={styles.list}>
                    {customerAppointments.map((apt) => {
                        const canCancel = canCancelAppointment(apt.date, apt.status);
                        return (
                            <li key={apt.id} className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <span className={styles.cardDate}>
                                        {formatDate(apt.date)} в {apt.timeStart?.slice(0, 5)}
                                        {apt.timeEnd ? `–${apt.timeEnd.slice(0, 5)}` : ""}
                                    </span>
                                    <span className={styles.statusBadge} data-status={apt.status}>
                                        {statusLabel(apt.status)}
                                    </span>
                                </div>
                                <p className={styles.cardService}>
                                    {appointmentServiceMap[apt.id]?.join(", ") || "—"}
                                </p>
                                <div className={styles.cardFooter}>
                                    <span className={styles.cardRef}>{apt.referenceNumber}</span>
                                    {canCancel && (
                                        <div className={styles.actions}>
                                            <CancelAppointmentButton appointmentId={apt.id} />
                                            <Link href="/booking" className={styles.rescheduleLink}>
                                                Перенести
                                            </Link>
                                        </div>
                                    )}
                                    {!canCancel && isUpcoming(apt.date, apt.status) && (
                                        <span className={styles.cancelNote}>
                                            Отмена недоступна менее чем за 24 часа. Свяжитесь со
                                            студией.
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// ── Helpers ──

function canCancelAppointment(dateStr: string | null, status: string | null): boolean {
    if (!dateStr) return false;
    if (status !== "pending" && status !== "confirmed") return false;
    const appointmentDate = new Date(dateStr + "T00:00:00+03:00");
    const now = new Date();
    const hoursUntil = (appointmentDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil > 24;
}

function isUpcoming(dateStr: string | null, status: string | null): boolean {
    if (!dateStr) return false;
    if (status !== "pending" && status !== "confirmed") return false;
    const appointmentDate = new Date(dateStr + "T00:00:00+03:00");
    return appointmentDate.getTime() > Date.now();
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00+03:00");
    return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Moscow",
    });
}

function statusLabel(status: string | null): string {
    const map: Record<string, string> = {
        pending: "Ожидает",
        confirmed: "Подтверждена",
        in_progress: "В процессе",
        completed: "Завершена",
        cancelled: "Отменена",
        no_show: "Неявка",
        rescheduled: "Перенесена",
    };
    return map[status ?? ""] ?? status ?? "—";
}
