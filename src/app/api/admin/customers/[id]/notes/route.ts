/**
 * PUT /api/admin/customers/[id]/notes — set the admin-only note on a customer.
 *
 * Storage: `customer.metadata.adminNotes`. We don't add a dedicated column
 * to keep the schema slim; the JSONB column is already there.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { customers, db } from "@/db";
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
        const [row] = await db
            .select({ id: customers.id, metadata: customers.metadata })
            .from(customers)
            .where(eq(customers.id, id))
            .limit(1);
        if (!row) return notFound("Профиль не найден");

        const nextMetadata = {
            ...((row.metadata as Record<string, unknown> | null) ?? {}),
            adminNotes: notes,
        };

        const [updated] = await db
            .update(customers)
            .set({ metadata: nextMetadata, updatedAt: new Date() })
            .where(eq(customers.id, id))
            .returning({ id: customers.id, metadata: customers.metadata });

        return ok({ customer: { id: updated.id, adminNotes: notes, metadata: updated.metadata } });
    } catch (error) {
        console.error("[/api/admin/customers/:id/notes] failed", error);
        return internal();
    }
}
