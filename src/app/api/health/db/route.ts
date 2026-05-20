import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const start = Date.now();
        await db.execute(sql`select 1`);
        return NextResponse.json(
            {
                status: "ok",
                db: "ok",
                latencyMs: Date.now() - start,
                time: new Date().toISOString(),
            },
            { status: 200, headers: { "cache-control": "no-store" } }
        );
    } catch (err) {
        return NextResponse.json(
            {
                status: "error",
                db: "fail",
                error: (err as Error).message,
                time: new Date().toISOString(),
            },
            { status: 503, headers: { "cache-control": "no-store" } }
        );
    }
}
