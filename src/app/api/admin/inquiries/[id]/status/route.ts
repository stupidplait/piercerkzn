/**
 * PUT /api/admin/inquiries/[id]/status — update lifecycle state.
 *
 * Setting status to `resolved` stamps `resolved_at`. Other transitions clear
 * `resolved_at` so the timeline accurately reflects when the issue was closed.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, inquiries } from "@/db";
import { updateInquiryStatusSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PUT(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const { id } = await ctx.params;

    const parsed = await parseJson(req, updateInquiryStatusSchema);
    if (!parsed.ok) return parsed.response!;
    const { status } = parsed.data!;

    try {
        const [updated] = await db
            .update(inquiries)
            .set({
                status,
                resolvedAt: status === "resolved" ? new Date() : null,
                updatedAt: new Date(),
            })
            .where(eq(inquiries.id, id))
            .returning();
        if (!updated) return notFound("Сообщение не найдено");

        capture({
            event: "inquiry_status_changed",
            distinctId: sess.userId,
            properties: { inquiry_id: updated.id, status },
        });

        return ok({ inquiry: updated });
    } catch (error) {
        console.error("[/api/admin/inquiries/:id/status] failed", error);
        return internal();
    }
}
