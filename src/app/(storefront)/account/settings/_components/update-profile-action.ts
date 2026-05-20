"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db, customers } from "@/db";

interface UpdateProfileInput {
    firstName: string;
    lastName: string | null;
    email: string;
    phone: string | null;
    notificationEmail: boolean;
    notificationPush: boolean;
}

export async function updateProfileAction(
    input: UpdateProfileInput
): Promise<{ ok: boolean; error?: string }> {
    const session = await auth();
    if (!session?.user?.customerId) {
        return { ok: false, error: "Не авторизован" };
    }

    const customerId = session.user.customerId;

    // Validate
    if (!input.firstName || input.firstName.length < 1 || input.firstName.length > 50) {
        return { ok: false, error: "Имя должно быть от 1 до 50 символов" };
    }

    if (input.lastName && input.lastName.length > 50) {
        return { ok: false, error: "Фамилия не более 50 символов" };
    }

    if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
        return { ok: false, error: "Введите корректный email" };
    }

    // Russian phone format validation
    if (input.phone && !/^(\+7|8)\d{10}$/.test(input.phone)) {
        return { ok: false, error: "Введите телефон в формате +7XXXXXXXXXX" };
    }

    // Check email uniqueness (if changed)
    const [existing] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.email, input.email))
        .limit(1);

    if (existing && existing.id !== customerId) {
        return { ok: false, error: "Этот email уже используется другим аккаунтом" };
    }

    // Update
    await db
        .update(customers)
        .set({
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            notificationEmail: input.notificationEmail,
            notificationPush: input.notificationPush,
            updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId));

    revalidatePath("/account/settings");

    return { ok: true };
}
