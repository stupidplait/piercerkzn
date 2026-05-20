"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "../account-layout.module.css";

interface AccountNavLink {
    href: string;
    label: string;
}

const ACCOUNT_NAV_LINKS: AccountNavLink[] = [
    { href: "/account", label: "Обзор" },
    { href: "/account/appointments", label: "Записи" },
    { href: "/account/reservations", label: "Брони" },
    { href: "/account/wishlist", label: "Избранное" },
    { href: "/account/reviews", label: "Отзывы" },
    { href: "/account/aftercare", label: "Уход" },
    { href: "/account/notifications", label: "Уведомления" },
    { href: "/account/settings", label: "Настройки" },
];

export function AccountSidebar() {
    const pathname = usePathname();

    const isActive = (href: string) => {
        if (href === "/account") return pathname === "/account";
        return pathname.startsWith(href);
    };

    return (
        <nav aria-label="Навигация личного кабинета">
            <ul className={styles.navList}>
                {ACCOUNT_NAV_LINKS.map((link) => (
                    <li key={link.href}>
                        <Link
                            href={link.href}
                            className={styles.navLink}
                            data-active={isActive(link.href) ? "1" : "0"}
                            aria-current={isActive(link.href) ? "page" : undefined}
                        >
                            {link.label}
                        </Link>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
