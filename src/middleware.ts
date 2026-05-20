/**
 * Edge middleware — Auth.js v5 route guards + centralised CORS preflight.
 *
 * Imports the edge-safe `auth.config.ts` only. The full `auth.ts` (with
 * Argon2 + Drizzle adapter) is intentionally NOT imported here — it would
 * pull native modules into the Edge bundle and break the build. Likewise
 * `lib/cors.ts` and `lib/env.ts` are edge-runtime safe (Web `Request`/
 * `Response`/`URL`/`Headers` only) so they can be bundled here without
 * pulling Node-only APIs into the edge runtime.
 *
 * Coarse policy (also enforced in callbacks.authorized of auth.config):
 *   /api/*      → OPTIONS short-circuits to `handlePreflight` (Req 7.5/7.6);
 *                 other methods fall through to `NextResponse.next()` so
 *                 route handlers run unchanged.
 *   /admin/*    → role === 'admin' | 'staff'
 *   /account/*  → any authenticated user
 *   everything else → public
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth.config";
import { handlePreflight } from "@/lib/cors";

// Phase 5 AC 5.9a — defence-in-depth TLS-version fallback.
// Primary enforcement is Cloudflare min_tls_version=1.2; this catches
// requests that bypass Cloudflare (direct origin access).
interface CfVisitor {
    scheme?: string;
    tls?: string;
}

export function parseCfVisitor(raw: string | null): CfVisitor | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as CfVisitor;
    } catch {
        return null;
    }
}

export function tlsAtLeast12(tls: string | undefined): boolean {
    if (!tls) return true; // unknown → fail-open
    const m = /^TLSv(\d+)\.(\d+)$/.exec(tls);
    if (!m) return true;
    return Number(m[1]) > 1 || (Number(m[1]) === 1 && Number(m[2]) >= 2);
}

const { auth } = NextAuth(authConfig);

export default auth((req) => {
    const { nextUrl } = req;
    const isAuth = !!req.auth;
    const role = req.auth?.user?.role;
    const path = nextUrl.pathname;

    // TLS version check (AC 5.9a)
    const cfV = parseCfVisitor(req.headers.get("cf-visitor"));
    if (cfV && !tlsAtLeast12(cfV.tls)) {
        return new NextResponse("upgrade required: TLS 1.2+", {
            status: 426,
            headers: { Upgrade: "TLS/1.2", Connection: "Upgrade" },
        });
    }

    // CORS preflight chokepoint for `/api/*` (Req 7.5, 7.6). Runs BEFORE
    // the auth gate so denied/allowed preflights never reach the protected
    // surface; the auth gate continues to apply only to `/admin/*` and
    // `/account/*` per the matcher ordering below.
    if (path.startsWith("/api/") && req.method === "OPTIONS") {
        return handlePreflight(req as unknown as Request);
    }

    if (path.startsWith("/admin")) {
        if (!isAuth) {
            // Admin has its own legacy login at /admin/login.
            const url = new URL("/admin/login", nextUrl);
            url.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
            return NextResponse.redirect(url);
        }
        if (role !== "admin" && role !== "staff") {
            return NextResponse.redirect(new URL("/", nextUrl));
        }
    }

    if (path.startsWith("/account")) {
        if (!isAuth) {
            const url = new URL("/auth/login", nextUrl);
            url.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
            return NextResponse.redirect(url);
        }
    }

    return NextResponse.next();
});

// Match the routes that need a session check PLUS `/api/*` so the
// centralised CORS preflight handler above can short-circuit OPTIONS for
// every API route (Req 7.5). `/admin/:path*` and `/account/:path*` are
// listed first to preserve the existing auth-gate behaviour for non-API
// routes — the auth gate body itself early-returns on OPTIONS via the
// `handlePreflight` short-circuit, so adding `/api/:path*` does not
// expand the auth gate's reach to API routes (it only enables the
// preflight short-circuit for them).
export const config = {
    matcher: ["/admin/:path*", "/account/:path*", "/api/:path*"],
};
