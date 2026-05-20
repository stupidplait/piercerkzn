"use server";

/**
 * Server actions for the authentication surface.
 *
 * These run in Node.js (not edge) because they touch Argon2 and the DB.
 * Login is intentionally NOT implemented as a server action — the canonical
 * path is `signIn('credentials', ...)` from Auth.js, which the login page
 * will call directly.
 *
 * `register` creates a new customer + linked auth record, then automatically
 * starts a session via `signIn`.
 */
import { headers } from "next/headers";

import { eq } from "drizzle-orm";

import { customers, db } from "@/db";
import { signIn } from "@/lib/auth";
import { hashPassword } from "@/lib/auth-utils";
import { capture, getPostHogSessionId } from "@/lib/posthog";
import { registerSchema, type RegisterInput } from "@/lib/validations";

export type ActionResult<T> =
    | { ok: true; data: T }
    | {
          ok: false;
          error: { code: string; message: string; details?: unknown };
      };

/** Register a new customer + immediately sign them in. */
export async function registerAction(raw: unknown): Promise<ActionResult<{ customerId: string }>> {
    const parsed = registerSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: {
                code: "validation_error",
                message: "Проверьте корректность введённых данных",
                details: parsed.error.issues.map((i) => ({
                    path: i.path.join("."),
                    message: i.message,
                })),
            },
        };
    }
    const data: RegisterInput = parsed.data;

    // Reject duplicate email up-front for a clean error message.
    const [existing] = await db
        .select({ id: customers.id, deletedAt: customers.deletedAt })
        .from(customers)
        .where(eq(customers.email, data.email))
        .limit(1);
    if (existing && !existing.deletedAt) {
        return {
            ok: false,
            error: { code: "email_taken", message: "Этот email уже зарегистрирован" },
        };
    }

    const passwordHash = await hashPassword(data.password);
    const [created] = await db
        .insert(customers)
        .values({
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName ?? null,
            phone: data.phone ?? null,
            passwordHash,
        })
        .returning({ id: customers.id, email: customers.email });

    const sessionId = await getPostHogSessionId(await headers());
    capture({
        event: "user_registered",
        distinctId: created.id,
        sessionId: sessionId ?? undefined,
        properties: {
            method: "credentials",
            // Surfaced so the client can `alias(anonymousId → customerId)`
            // when the action returns; see register page.
            $set_once: { signup_source: "credentials" },
        },
    });

    // Auto-login. signIn() throws if it needs to redirect; we let it.
    await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
    });

    return { ok: true, data: { customerId: created.id } };
}
