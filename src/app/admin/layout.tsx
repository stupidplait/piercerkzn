"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./layout.module.css";

// ── Inline SVG icons ───────────────────────────────────────────────────────

function IconGrid() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="1.5" y="1.5" width="5" height="5" rx="0.5" />
            <rect x="8.5" y="1.5" width="5" height="5" rx="0.5" />
            <rect x="1.5" y="8.5" width="5" height="5" rx="0.5" />
            <rect x="8.5" y="8.5" width="5" height="5" rx="0.5" />
        </svg>
    );
}

function IconGem() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polygon points="7.5,1.5 13,5.5 13,9.5 7.5,13.5 2,9.5 2,5.5" />
            <polyline points="2,5.5 7.5,8 13,5.5" />
            <line x1="7.5" y1="8" x2="7.5" y2="13.5" />
        </svg>
    );
}

function IconBox() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M7.5 1.5L13 4.5V10.5L7.5 13.5L2 10.5V4.5L7.5 1.5Z" />
            <polyline points="2,4.5 7.5,7.5 13,4.5" />
            <line x1="7.5" y1="7.5" x2="7.5" y2="13.5" />
        </svg>
    );
}

function IconCalendar() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="1.5" y="3" width="12" height="11" rx="1" />
            <line x1="5" y1="1.5" x2="5" y2="4.5" />
            <line x1="10" y1="1.5" x2="10" y2="4.5" />
            <line x1="1.5" y1="7" x2="13.5" y2="7" />
        </svg>
    );
}

function IconUsers() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="5.5" cy="5" r="2.5" />
            <path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
            <circle cx="11" cy="5" r="2" />
            <path d="M14 13c0-2-1.5-3.5-3-3.5" />
        </svg>
    );
}

function IconBookmark() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3.5 1.5H11.5V13.5L7.5 10.5L3.5 13.5V1.5Z" />
        </svg>
    );
}

function IconFileText() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M9 1.5H3.5A1 1 0 0 0 2.5 2.5V12.5A1 1 0 0 0 3.5 13.5H11.5A1 1 0 0 0 12.5 12.5V5L9 1.5Z" />
            <polyline points="9,1.5 9,5 12.5,5" />
            <line x1="5" y1="7.5" x2="10" y2="7.5" />
            <line x1="5" y1="10" x2="10" y2="10" />
        </svg>
    );
}

function IconBarChart() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <line x1="1.5" y1="13.5" x2="13.5" y2="13.5" />
            <rect x="2" y="9" width="2.5" height="4.5" />
            <rect x="6.25" y="5.5" width="2.5" height="8" />
            <rect x="10.5" y="2" width="2.5" height="11.5" />
        </svg>
    );
}

function IconSettings() {
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="7.5" cy="7.5" r="2" />
            <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.1 1.1M11 11l1.1 1.1M2.9 12.1l1.1-1.1M11 4l1.1-1.1" />
        </svg>
    );
}

// ── Nav items ──────────────────────────────────────────────────────────────

const NAV = [{ href: "/admin", label: "Главная", Icon: IconGrid, exact: true }];

const NAV_CATALOG = [
    { href: "/admin/products", label: "Украшения", Icon: IconGem },
    { href: "/admin/3d-assets", label: "3D-активы", Icon: IconBox },
];

const NAV_BOOKINGS = [
    { href: "/admin/appointments", label: "Записи", Icon: IconCalendar },
    { href: "/admin/clients", label: "Клиенты", Icon: IconUsers },
    { href: "/admin/reservations", label: "Брони", Icon: IconBookmark },
];

const NAV_CONTENT = [{ href: "/admin/content", label: "Публикации", Icon: IconFileText }];

const NAV_ANALYTICS = [{ href: "/admin/analytics", label: "Статистика", Icon: IconBarChart }];

const NAV_SYSTEM = [{ href: "/admin/settings", label: "Настройки", Icon: IconSettings }];

// ── Breadcrumb map ─────────────────────────────────────────────────────────

const BREAD: Record<string, string> = {
    "/admin": "Панель управления",
    "/admin/products": "Украшения",
    "/admin/products/new": "Новое украшение",
    "/admin/3d-assets": "3D-активы",
    "/admin/appointments": "Записи",
    "/admin/clients": "Клиенты",
    "/admin/reservations": "Брони",
    "/admin/content": "Публикации",
    "/admin/analytics": "Статистика",
    "/admin/settings": "Настройки",
};

function getBreadcrumb(pathname: string): string {
    if (BREAD[pathname]) return BREAD[pathname];
    if (pathname.startsWith("/admin/content/blog/")) return "Редактирование статьи";
    if (pathname.startsWith("/admin/content/aftercare/")) return "Редактирование гайда";
    if (pathname.startsWith("/admin/products/")) return "Редактирование украшения";
    if (pathname.startsWith("/admin/clients/")) return "Профиль клиента";
    if (pathname.startsWith("/admin/reservations/")) return "Детали брони";
    if (pathname.startsWith("/admin/appointments/")) return "Детали записи";
    return "Администрирование";
}

function isActive(href: string, pathname: string, exact?: boolean): boolean {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
}

// ── Layout ─────────────────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [theme, setTheme] = useState<"dark" | "light">("dark");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Read current theme
        const stored = localStorage.getItem("theme") as "dark" | "light" | null;
        const current =
            (document.documentElement.dataset.theme as "dark" | "light") || stored || "dark";
        setTheme(current);

        // Auth guard
        if (pathname !== "/admin/login" && localStorage.getItem("admin_auth") !== "1") {
            router.replace("/admin/login");
        }
    }, [pathname, router]);

    const toggleTheme = () => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        document.documentElement.dataset.theme = next;
        localStorage.setItem("theme", next);
    };

    // Don't render shell on login page
    if (pathname === "/admin/login") {
        return <>{children}</>;
    }

    if (!mounted) return null;

    const breadcrumb = getBreadcrumb(pathname);

    return (
        <div className={styles.adminShell}>
            {/* ── Sidebar ──────────────────────────── */}
            <aside className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <p className={styles.logoMark}>PIERCER·KZN</p>
                    <span className={styles.logoSub}>Admin Panel</span>
                </div>

                <nav className={styles.sidebarNav}>
                    {/* Main */}
                    {NAV.map(({ href, label, Icon, exact }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`${styles.sidebarItem} ${isActive(href, pathname, exact) ? styles.sidebarItemActive : ""}`}
                        >
                            <span className={styles.sidebarItemIcon}>
                                <Icon />
                            </span>
                            {label}
                        </Link>
                    ))}

                    {/* Каталог */}
                    <div className={styles.sidebarSection}>
                        <span className={styles.sidebarSectionTitle}>Каталог</span>
                        {NAV_CATALOG.map(({ href, label, Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`${styles.sidebarItem} ${isActive(href, pathname) ? styles.sidebarItemActive : ""}`}
                            >
                                <span className={styles.sidebarItemIcon}>
                                    <Icon />
                                </span>
                                {label}
                            </Link>
                        ))}
                    </div>

                    {/* Записи */}
                    <div className={styles.sidebarSection}>
                        <span className={styles.sidebarSectionTitle}>Записи</span>
                        {NAV_BOOKINGS.map(({ href, label, Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`${styles.sidebarItem} ${isActive(href, pathname) ? styles.sidebarItemActive : ""}`}
                            >
                                <span className={styles.sidebarItemIcon}>
                                    <Icon />
                                </span>
                                {label}
                            </Link>
                        ))}
                    </div>

                    {/* Контент */}
                    <div className={styles.sidebarSection}>
                        <span className={styles.sidebarSectionTitle}>Контент</span>
                        {NAV_CONTENT.map(({ href, label, Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`${styles.sidebarItem} ${isActive(href, pathname) ? styles.sidebarItemActive : ""}`}
                            >
                                <span className={styles.sidebarItemIcon}>
                                    <Icon />
                                </span>
                                {label}
                            </Link>
                        ))}
                    </div>

                    {/* Аналитика */}
                    <div className={styles.sidebarSection}>
                        <span className={styles.sidebarSectionTitle}>Аналитика</span>
                        {NAV_ANALYTICS.map(({ href, label, Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`${styles.sidebarItem} ${isActive(href, pathname) ? styles.sidebarItemActive : ""}`}
                            >
                                <span className={styles.sidebarItemIcon}>
                                    <Icon />
                                </span>
                                {label}
                            </Link>
                        ))}
                    </div>

                    {/* Система */}
                    <div className={styles.sidebarSection}>
                        <span className={styles.sidebarSectionTitle}>Система</span>
                        {NAV_SYSTEM.map(({ href, label, Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`${styles.sidebarItem} ${isActive(href, pathname) ? styles.sidebarItemActive : ""}`}
                            >
                                <span className={styles.sidebarItemIcon}>
                                    <Icon />
                                </span>
                                {label}
                            </Link>
                        ))}
                    </div>
                </nav>

                <div className={styles.sidebarFooter}>
                    <p className={styles.studioName}>PiercerKZN</p>
                    <div className={styles.studioStatus}>
                        <span className={styles.statusDot} />
                        <span className={styles.studioStatusText}>Онлайн</span>
                    </div>
                    <p className={styles.studioVersion}>v1.0 · Казань</p>
                </div>
            </aside>

            {/* ── Main area ────────────────────────── */}
            <div className={styles.mainArea}>
                <header className={styles.topbar}>
                    <span className={styles.topbarBread}>
                        PIERCER·KZN
                        <span className={styles.topbarBreadSep}>/</span>
                        {breadcrumb}
                    </span>
                    <div className={styles.topbarRight}>
                        <button
                            className={styles.themeToggle}
                            onClick={toggleTheme}
                            aria-label="Переключить тему"
                            title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                        >
                            {theme === "dark" ? "◐" : "◑"}
                        </button>
                        <span className={styles.adminBadge}>Admin</span>
                    </div>
                </header>

                <main className={styles.content}>{children}</main>
            </div>
        </div>
    );
}
