"use server";

import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db, appointments } from "@/db";

export async function cancelAppointmentAction(
    appointmentId: string
): Promise<{ ok: boolean; error?: string }> {
    const session = await auth();
    if (!session?.user?.customerId) {
        return { ok: false, error: "Не авторизован" };
    }

    const customerId = session.user.customerId;

    // Fetch the appointment
    const [appointment] = await db
        .select({
            id: appointments.id,
            date: appointments.date,
            status: appointments.status,
            customerId: appointments.customerId,
        })
        .from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.customerId, customerId)))
        .limit(1);

    if (!appointment) {
        return { ok: false, error: "Запись не найдена" };
    }

    if (appointment.status !== "pending" && appointment.status !== "confirmed") {
        return { ok: false, error: "Эту запись нельзя отменить" };
    }

    // Check 24h rule
    const appointmentDate = new Date(appointment.date + "T00:00:00+03:00");
    const now = new Date();
    const hoursUntil = (appointmentDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil <= 24) {
        return {
            ok: false,
            error: "Отмена недоступна менее чем за 24 часа до записи. Свяжитесь со студией.",
        };
    }

    // Cancel the appointment
    await db
        .update(appointments)
        .set({
            status: "cancelled",
            cancelledAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(appointments.id, appointmentId));

    revalidatePath("/account/appointments");
    revalidatePath("/account");

    return { ok: true };
}
