/**
 * POST /api/admin/inquiries/[id]/reply — record a reply on the thread.
 *
 * Body: { content, sentVia: "email" | "internal_note" }.
 *   - `email`         — admin already sent the email out-of-band; we just log
 *                       the content for the audit trail. (Auto-sending email
 *                       is a follow-up that needs a React Email template.)
 *   - `internal_note` — visible to staff only; never sent anywhere.
 *
 * Side-effect: an inquiry that's still in `new` is bumped to `in_progress`.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, inquiries, inquiryReplies } from "@/db";
import { replyInquirySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const { id } = await ctx.params;

    const parsed = await parseJson(req, replyInquirySchema);
    if (!parsed.ok) return parsed.response!;
    const { content, sentVia } = parsed.data!;

    try {
        return await db.transaction(async (tx) => {
            const [inquiryRow] = await tx
                .select()
                .from(inquiries)
                .where(eq(inquiries.id, id))
                .limit(1)
                .for("update");
            if (!inquiryRow) return notFound("Сообщение не найдено");

            const [reply] = await tx
                .insert(inquiryReplies)
                .values({
                    inquiryId: inquiryRow.id,
                    content,
                    sentVia,
                })
                .returning();

            if (inquiryRow.status === "new") {
                await tx
                    .update(inquiries)
                    .set({ status: "in_progress", updatedAt: new Date() })
                    .where(eq(inquiries.id, inquiryRow.id));
            }

            capture({
                event: "inquiry_replied",
                distinctId: sess.userId,
                properties: {
                    inquiry_id: inquiryRow.id,
                    sent_via: sentVia,
                },
            });

            return ok({ reply });
        });
    } catch (error) {
        console.error("[/api/admin/inquiries/:id/reply] failed", error);
        return internal();
    }
}
