import { isAuthorizedCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) {
        return new Response("unauthorized", { status: 401 });
    }

    // Daily digest logic — placeholder until @/lib/digest is implemented.
    const result = { sent: true, timestamp: new Date().toISOString() };
    return Response.json({ ok: true, ...result });
}
