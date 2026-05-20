import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Onest } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";

import { CookieConsentBanner } from "@/components/cookie-consent";
import { PostHogProvider } from "@/components/posthog-provider";

import "./globals.css";

const sans = Inter({
    variable: "--font-sans",
    subsets: ["latin", "cyrillic"],
    display: "swap",
});

const mono = JetBrains_Mono({
    variable: "--font-mono",
    subsets: ["latin", "cyrillic"],
    display: "swap",
});

const displayNew = Onest({
    variable: "--font-display-new",
    subsets: ["latin", "latin-ext", "cyrillic"],
    weight: ["400", "500", "600", "700", "800", "900"],
    display: "swap",
});

export const metadata: Metadata = {
    title: "PiercerKZN — Студия пирсинга в Казани",
    description:
        "Единственная в Казани студия пирсинга с настоящей 3D-примеркой украшений. Выбери, примерь на модели, забронируй — оплата при визите наличными.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    const themeScript = `(function(){try{var s=localStorage.getItem('theme');var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}})();`;

    return (
        <html lang="ru" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
            </head>
            <body className={`${sans.variable} ${mono.variable} ${displayNew.variable}`}>
                {/* Suspense boundary required by `usePathname` / `useSearchParams`
                    inside `PostHogProvider`. */}
                <Suspense fallback={null}>
                    <PostHogProvider>
                        <NuqsAdapter>{children}</NuqsAdapter>
                        <CookieConsentBanner />
                    </PostHogProvider>
                </Suspense>
            </body>
        </html>
    );
}
