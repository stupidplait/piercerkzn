"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCartStore } from "@/stores/cart-store";

import styles from "./storefront-nav.module.css";

interface NavLink {
    href: string;
    label: string;
}

const NAV_LINKS: NavLink[] = [
    { href: "/catalog", label: "Каталог" },
    { href: "/looks", label: "Образы" },
    { href: "/about", label: "О студии" },
    { href: "/booking", label: "Запись" },
    { href: "/cart", label: "Корзина" },
];

const MENU_ID = "storefront-mobile-menu";

export function StorefrontNav() {
    const pathname = usePathname();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const burgerRef = useRef<HTMLButtonElement>(null);
    const totalItems = useCartStore((s) => s.totalItems());

    const closeMenu = useCallback(() => {
        setMenuOpen(false);
        burgerRef.current?.focus();
    }, []);

    const toggleMenu = useCallback(() => {
        setMenuOpen((prev) => !prev);
    }, []);

    // Close on Escape
    useEffect(() => {
        if (!menuOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                closeMenu();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [menuOpen, closeMenu]);

    // Close menu on route change
    useEffect(() => {
        setMenuOpen(false);
    }, [pathname]);

    const isActive = (href: string) => {
        if (href === "/") return pathname === "/";
        return pathname.startsWith(href);
    };

    return (
        <>
            {/* Desktop nav links */}
            <ul className={styles.navLinks}>
                {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                        <Link
                            href={link.href}
                            className={styles.navLink}
                            data-active={isActive(link.href) ? "1" : "0"}
                            aria-current={isActive(link.href) ? "page" : undefined}
                        >
                            {link.label}
                            {link.href === "/cart" && totalItems > 0 && (
                                <span
                                    className={styles.cartBadge}
                                    aria-label={`${totalItems} товаров в корзине`}
                                >
                                    {totalItems}
                                </span>
                            )}
                        </Link>
                    </li>
                ))}
            </ul>

            {/* Mobile burger button */}
            <button
                ref={burgerRef}
                className={styles.burger}
                onClick={toggleMenu}
                aria-expanded={menuOpen}
                aria-controls={MENU_ID}
                aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
                type="button"
            >
                <span className={styles.burgerLine} data-open={menuOpen ? "1" : "0"} />
                <span className={styles.burgerLine} data-open={menuOpen ? "1" : "0"} />
            </button>

            {/* Mobile menu overlay */}
            <div
                ref={menuRef}
                id={MENU_ID}
                className={styles.mobileMenu}
                data-open={menuOpen ? "1" : "0"}
                role="navigation"
                aria-label="Мобильная навигация"
            >
                <ul className={styles.mobileMenuList}>
                    {NAV_LINKS.map((link) => (
                        <li key={link.href}>
                            <Link
                                href={link.href}
                                className={styles.mobileMenuLink}
                                data-active={isActive(link.href) ? "1" : "0"}
                                aria-current={isActive(link.href) ? "page" : undefined}
                                onClick={closeMenu}
                            >
                                {link.label}
                                {link.href === "/cart" && totalItems > 0 && (
                                    <span
                                        className={styles.cartBadge}
                                        aria-label={`${totalItems} товаров в корзине`}
                                    >
                                        {totalItems}
                                    </span>
                                )}
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </>
    );
}
