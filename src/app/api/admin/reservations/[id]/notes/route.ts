/**
 * PUT /api/admin/reservations/[id]/notes — overwrite `internal_notes`.
 *
 * Internal notes are admin-only; storefront customers never see them.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, reservations } from "@/db";
import { adminNotesSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PUT(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    const parsed = await parseJson(req, adminNotesSchema);
    if (!parsed.ok) return parsed.response!;
    const { notes } = parsed.data!;

    try {
        const [updated] = await db
            .update(reservations)
            .set({ internalNotes: notes, updatedAt: new Date() })
            .where(eq(reservations.id, id))
            .returning({ id: reservations.id, internalNotes: reservations.internalNotes });

        if (!updated) return notFound("Бронь не найдена");
        return ok({ reservation: updated });
    } catch (error) {
        console.error("[/api/admin/reservations/:id/notes] failed", error);
        return internal();
    }
}
