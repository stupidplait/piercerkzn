import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json(
        { status: "ok", time: new Date().toISOString() },
        { status: 200, headers: { "cache-control": "no-store" } }
    );
}
