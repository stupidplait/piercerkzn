/**
 * /api/customers/me
 *
 *   GET    — full profile of the authenticated customer (includes notification prefs).
 *   PATCH  — partial profile update (firstName, lastName, phone, dateOfBirth, avatarUrl, notification flags).
 *   DELETE — soft-delete the account (sets `customer.deleted_at` and signs the user out).
 *
 * `/api/auth/me` is the lightweight session probe; this route is the canonical
 * source for the `/account/settings` form.
 */
import { eq } from "drizzle-orm";

import {
    fail,
    forbidden,
    internal,
    noContent,
    notFound,
    ok,
    parseJson,
    requireUser,
} from "@/lib/api";
import { customers, db } from "@/db";
import { signOut } from "@/lib/auth";
import { verifyPassword } from "@/lib/auth-utils";
import { capture } from "@/lib/posthog";
import { deleteAccountSchema, updateProfileSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROFILE_COLUMNS = {
    id: customers.id,
    email: customers.email,
    firstName: customers.firstName,
    lastName: customers.lastName,
    phone: customers.phone,
    dateOfBirth: customers.dateOfBirth,
    avatarUrl: customers.avatarUrl,
    locale: customers.locale,
    notificationEmail: customers.notificationEmail,
    notificationSms: customers.notificationSms,
    notificationPush: customers.notificationPush,
    notificationMarketing: customers.notificationMarketing,
    createdAt: customers.createdAt,
    updatedAt: customers.updatedAt,
    deletedAt: customers.deletedAt,
} as const;

async function loadCustomer(customerId: string) {
    const [row] = await db
        .select(PROFILE_COLUMNS)
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
    return row ?? null;
}

function publicProfile<T extends { deletedAt: Date | null }>(row: T) {
    // Do not leak deletedAt to clients.
    const { deletedAt: _omit, ...rest } = row;
    void _omit;
    return rest;
}

// ---------------------------------------------------------------------------
// GET — read profile
// ---------------------------------------------------------------------------
export async function GET() {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;

    if (!ctx.customerId) {
        // Admin/staff sessions are not customers — they have no profile here.
        return forbidden("Сессия не привязана к покупателю");
    }

    try {
        const row = await loadCustomer(ctx.customerId);
        if (!row || row.deletedAt) return notFound("Профиль не найден");
        return ok({ customer: publicProfile(row) });
    } catch (error) {
        console.error("[/api/customers/me GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH — partial update
// ---------------------------------------------------------------------------
export async function PATCH(req: Request) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;
    if (!ctx.customerId) return forbidden("Сессия не привязана к покупателю");

    const parsed = await parseJson(req, updateProfileSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    // Build a lean update object — only set columns the client actually sent.
    const patch: Record<string, unknown> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.dateOfBirth !== undefined) patch.dateOfBirth = input.dateOfBirth;
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
    if (input.notificationEmail !== undefined) patch.notificationEmail = input.notificationEmail;
    if (input.notificationSms !== undefined) patch.notificationSms = input.notificationSms;
    if (input.notificationPush !== undefined) patch.notificationPush = input.notificationPush;
    if (input.notificationMarketing !== undefined) {
        patch.notificationMarketing = input.notificationMarketing;
    }

    if (Object.keys(patch).length === 0) {
        return fail("validation_error", "Нет полей для обновления", { status: 422 });
    }
    patch.updatedAt = new Date();

    try {
        const [updated] = await db
            .update(customers)
            .set(patch)
            .where(eq(customers.id, ctx.customerId))
            .returning(PROFILE_COLUMNS);

        if (!updated || updated.deletedAt) return notFound("Профиль не найден");

        capture({
            event: "customer_profile_updated",
            distinctId: ctx.customerId,
            properties: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
        });

        return ok({ customer: publicProfile(updated) });
    } catch (error) {
        console.error("[/api/customers/me PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — soft-delete + sign out
// ---------------------------------------------------------------------------
export async function DELETE(req: Request) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;
    if (!ctx.customerId) return forbidden("Сессия не привязана к покупателю");

    // Body is optional — OAuth-only accounts have no password to confirm.
    let input: { password?: string; reason?: string } = {};
    if (req.headers.get("content-length") && req.headers.get("content-type")?.includes("json")) {
        const parsed = await parseJson(req, deleteAccountSchema);
        if (!parsed.ok) return parsed.response!;
        input = parsed.data!;
    }

    try {
        const [row] = await db
            .select({
                id: customers.id,
                email: customers.email,
                passwordHash: customers.passwordHash,
                deletedAt: customers.deletedAt,
            })
            .from(customers)
            .where(eq(customers.id, ctx.customerId))
            .limit(1);

        if (!row || row.deletedAt) return notFound("Профиль не найден");

        // Credential accounts must re-confirm the password.
        if (row.passwordHash) {
            if (!input.password) {
                return fail("password_required", "Подтвердите удаление аккаунта паролем", {
                    status: 400,
                });
            }
            const valid = await verifyPassword(row.passwordHash, input.password);
            if (!valid) {
                return fail("invalid_password", "Неверный пароль", { status: 400 });
            }
        }

        const now = new Date();
        await db
            .update(customers)
            .set({
                deletedAt: now,
                updatedAt: now,
                // GDPR: scrub PII while preserving the row for FK integrity
                // (reservations, appointments, reviews still reference it).
                phone: null,
                avatarUrl: null,
                metadata: { deletionReason: input.reason ?? null },
            })
            .where(eq(customers.id, ctx.customerId));

        capture({
            event: "customer_deleted",
            distinctId: ctx.customerId,
            properties: { reason: input.reason ?? null },
        });

        // Drop the cookie. Auth.js v5 throws on redirect — swallow because
        // we want to return a JSON 204 from this handler.
        await signOut({ redirect: false }).catch(() => {});

        return noContent();
    } catch (error) {
        console.error("[/api/customers/me DELETE] failed", error);
        return internal();
    }
}
