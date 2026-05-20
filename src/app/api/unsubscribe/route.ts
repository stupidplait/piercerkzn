/**
 * Public unsubscribe endpoint for newsletter campaigns.
 *
 * GET  /api/unsubscribe?token=…
 *   Verifies the HMAC token, flips `customer.notificationMarketing=false`,
 *   then 302-redirects to `/unsubscribe?ok=1`. On any verification or
 *   lookup failure 302-redirects to `/unsubscribe?error=invalid`.
 *   Idempotent — repeated calls with valid tokens always 302 to `?ok=1`.
 *
 * POST /api/unsubscribe?token=…
 *   RFC 8058 one-click unsubscribe (mailbox MUA hits this with body
 *   `List-Unsubscribe=One-Click`). Same verification + flag-flip flow,
 *   but returns 200 on success and 400 on tampered/missing token.
 */
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customers, db } from "@/db";
import { verifyUnsubscribeToken } from "@/lib/newsletters/unsubscribe-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originFor(req: Request): string {
    return (
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.AUTH_URL ??
        new URL(req.url).origin
    ).replace(/\/$/u, "");
}

async function flipMarketingOptOut(customerId: string): Promise<boolean> {
    const updated = await db
        .update(customers)
        .set({ notificationMarketing: false, updatedAt: new Date() })
        .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
        .returning({ id: customers.id });
    return updated.length > 0;
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const origin = originFor(req);

    if (!token) {
        return NextResponse.redirect(`${origin}/unsubscribe?error=invalid`, 302);
    }

    const customerId = verifyUnsubscribeToken(token);
    if (!customerId) {
        return NextResponse.redirect(`${origin}/unsubscribe?error=invalid`, 302);
    }

    const ok = await flipMarketingOptOut(customerId);
    if (!ok) {
        return NextResponse.redirect(`${origin}/unsubscribe?error=invalid`, 302);
    }

    return NextResponse.redirect(`${origin}/unsubscribe?ok=1`, 302);
}

export async function POST(req: Request) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
        return new Response("invalid token", { status: 400 });
    }

    const customerId = verifyUnsubscribeToken(token);
    if (!customerId) {
        return new Response("invalid token", { status: 400 });
    }

    const ok = await flipMarketingOptOut(customerId);
    if (!ok) {
        return new Response("customer not found", { status: 400 });
    }

    return new Response("ok", { status: 200 });
}
