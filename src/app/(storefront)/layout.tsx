import { ChromeHeader } from "@/components/ChromeHeader";
import { SiteFooter } from "@/components/SiteFooter";

import { StorefrontNav } from "./_components/StorefrontNav";
import styles from "./storefront-layout.module.css";

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className={styles.layoutShell}>
            {/* Skip-to-content — first focusable element */}
            <a href="#main-content" className={styles.skipLink}>
                Перейти к содержимому
            </a>

            {/* Chrome header with hide-on-scroll behavior */}
            <ChromeHeader className={styles.nav}>
                <StorefrontNav />
            </ChromeHeader>

            {/* Main content area */}
            <main id="main-content" className={styles.main}>
                {children}
            </main>

            {/* Site footer */}
            <SiteFooter
                classes={{
                    siteFooter: styles.siteFooter,
                    footerCols: styles.footerCols,
                    footerDesc: styles.footerDesc,
                    footerLinks: styles.footerLinks,
                    footerH: styles.footerH,
                    footerWordmark: styles.footerWordmark,
                    footerBase: styles.footerBase,
                }}
            />
        </div>
    );
}
