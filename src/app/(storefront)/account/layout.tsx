import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";

import { AccountSidebar } from "./_components/AccountSidebar";
import styles from "./account-layout.module.css";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();

    if (!session?.user) {
        // Reconstruct the originally requested account route for callbackUrl.
        // Next.js exposes the request path via x-invoke-path / next-url headers.
        const headersList = await headers();
        const pathname =
            headersList.get("x-invoke-path") ??
            headersList.get("next-url") ??
            headersList.get("x-url") ??
            "/account";
        const callbackUrl = encodeURIComponent(pathname);
        redirect(`/auth/login?callbackUrl=${callbackUrl}`);
    }

    return (
        <div className={styles.accountShell}>
            <aside className={styles.sidebar}>
                <h2 className={styles.sidebarTitle}>Личный кабинет</h2>
                <AccountSidebar />
            </aside>
            <div className={styles.content}>{children}</div>
        </div>
    );
}
