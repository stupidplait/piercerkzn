/**
 * GET /api/booking/waivers/template
 *
 * Returns the active waiver template that the booking flow shows the customer
 * before they sign. Public — there is no PII in the template content itself.
 *
 * Response shape:
 *   { template: { version: 3, content: "<markdown>", createdAt: "..." } }
 */
import { desc, eq } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { db, waiverTemplates } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [row] = await db
            .select({
                version: waiverTemplates.version,
                content: waiverTemplates.content,
                createdAt: waiverTemplates.createdAt,
            })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.isActive, true))
            .orderBy(desc(waiverTemplates.version))
            .limit(1);

        if (!row) return notFound("Активный шаблон соглашения не настроен");

        return ok({ template: row });
    } catch (error) {
        console.error("[/api/booking/waivers/template] failed", error);
        return internal();
    }
}
