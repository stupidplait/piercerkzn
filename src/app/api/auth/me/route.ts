/**
 * GET /api/auth/me
 *
 * Returns the current session as observed by Auth.js, plus the linked customer
 * profile (if any). Used by the storefront to populate `useSession()`-equivalent
 * client state without triggering an Auth.js round-trip.
 *
 * Returns 401 if no session cookie is present. The customer payload is `null`
 * when the session belongs to an admin/staff user that isn't linked to a
 * `customer` row.
 *
 * NOTE: cookie sessions auto-rotate via Auth.js, so there is no separate
 * `/api/auth/refresh` endpoint — calling `me` is the canonical "am I still
 * signed in?" check.
 */
import { eq } from "drizzle-orm";

import { internal, ok, requireUser } from "@/lib/api";
import { customers, db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;

    try {
        let customer = null as null | {
            id: string;
            email: string;
            firstName: string;
            lastName: string | null;
            phone: string | null;
            avatarUrl: string | null;
            dateOfBirth: string | null;
        };

        if (ctx.customerId) {
            const [row] = await db
                .select({
                    id: customers.id,
                    email: customers.email,
                    firstName: customers.firstName,
                    lastName: customers.lastName,
                    phone: customers.phone,
                    avatarUrl: customers.avatarUrl,
                    dateOfBirth: customers.dateOfBirth,
                    deletedAt: customers.deletedAt,
                })
                .from(customers)
                .where(eq(customers.id, ctx.customerId))
                .limit(1);

            if (row && !row.deletedAt) {
                customer = {
                    id: row.id,
                    email: row.email,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    phone: row.phone,
                    avatarUrl: row.avatarUrl,
                    dateOfBirth: row.dateOfBirth,
                };
            }
        }

        return ok({
            user: {
                id: ctx.userId,
                role: ctx.role,
                customerId: ctx.customerId ?? null,
            },
            customer,
        });
    } catch (error) {
        console.error("[/api/auth/me] failed", error);
        return internal();
    }
}
