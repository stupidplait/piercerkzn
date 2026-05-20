import type { NextConfig } from "next";

// Strict-ish CSP. R3F + drei need `unsafe-inline` for inline shaders;
// PostHog/Resend/CDN domains added explicitly. Tighten further once we
// have nonce-based inline scripts in Phase 11.x.
const baseCspDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    // Scripts: Next.js inline runtime + PostHog SDK + Telegram WebApp SDK
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://eu.posthog.com https://*.posthog.com https://telegram.org",
    // Workers: blob: for R3F-spawned workers (Three.js loaders)
    "worker-src 'self' blob:",
    // Styles: inline allowed for Tailwind v4 generated CSS
    "style-src 'self' 'unsafe-inline'",
    // Images / 3D models: self + R2 CDN + inline data URIs
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    // Fonts: next/font serves them from /_next; allow data URIs for inlined ones
    "font-src 'self' data:",
    // Network: same-origin + analytics + Telegram bot OAuth callback host + blob for GLTFLoader textures
    "connect-src 'self' blob: https://eu.posthog.com https://*.posthog.com https://api.resend.com https://api.telegram.org",
    "object-src 'none'",
    "upgrade-insecure-requests",
];

const csp = [...baseCspDirectives, "frame-ancestors 'none'"].join("; ");

/**
 * Mini-App CSP: relaxes `frame-ancestors` for `/visualizer*` so the page
 * can render inside the Telegram WebApp iframe (`https://web.telegram.org`).
 * Everything else (script-src, connect-src, …) stays identical.
 *
 * Per `docs/02_TECH_STACK.md`: the Mini-App entry is `/visualizer?tgmini=1`,
 * launched from a BotFather `setMenuButton`. See `scripts/setup-telegram-menu.ts`.
 */
const visualizerCsp = [
    ...baseCspDirectives,
    "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
].join("; ");

const baseSecurityHeaders = [
    { key: "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
];

const visualizerHeaders = [
    { key: "Content-Security-Policy", value: visualizerCsp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Intentionally omit X-Frame-Options — frame-ancestors above is the
    // authoritative iframe policy and X-Frame-Options would override it.
    {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
];

const nextConfig: NextConfig = {
    reactCompiler: true,
    async headers() {
        return [
            // More-specific first — `/visualizer` paths get the relaxed
            // frame-ancestors so Telegram WebApp can iframe them.
            {
                source: "/visualizer/:path*",
                headers: visualizerHeaders,
            },
            {
                source: "/visualizer",
                headers: visualizerHeaders,
            },
            {
                source: "/:path*",
                headers: baseSecurityHeaders,
            },
        ];
    },
    async redirects() {
        return [
            {
                source: "/new-design",
                destination: "/",
                permanent: false,
            },
        ];
    },
};

export default nextConfig;
