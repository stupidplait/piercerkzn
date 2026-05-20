/**
 * GET /api/admin/inquiries/[id] — full inquiry with reply thread.
 */
import { asc, eq } from "drizzle-orm";

import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { db, inquiries, inquiryReplies } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    try {
        const [row] = await db.select().from(inquiries).where(eq(inquiries.id, id)).limit(1);
        if (!row) return notFound("Сообщение не найдено");

        const replies = await db
            .select({
                id: inquiryReplies.id,
                content: inquiryReplies.content,
                sentVia: inquiryReplies.sentVia,
                createdAt: inquiryReplies.createdAt,
            })
            .from(inquiryReplies)
            .where(eq(inquiryReplies.inquiryId, row.id))
            .orderBy(asc(inquiryReplies.createdAt));

        return ok({ inquiry: { ...row, replies } });
    } catch (error) {
        console.error("[/api/admin/inquiries/:id] failed", error);
        return internal();
    }
}
