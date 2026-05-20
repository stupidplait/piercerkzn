import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, customers } from "@/db";

import { SettingsForm } from "./_components/SettingsForm";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const [customer] = await db
        .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
            notificationEmail: customers.notificationEmail,
            notificationPush: customers.notificationPush,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

    if (!customer) {
        return (
            <div className={styles.page}>
                <h1 className={styles.pageTitle}>Настройки</h1>
                <p className={styles.errorText}>Профиль не найден</p>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Настройки</h1>
            <SettingsForm
                initialData={{
                    firstName: customer.firstName,
                    lastName: customer.lastName ?? "",
                    email: customer.email,
                    phone: customer.phone ?? "",
                    notificationEmail: customer.notificationEmail ?? true,
                    notificationPush: customer.notificationPush ?? false,
                }}
            />
        </div>
    );
}
