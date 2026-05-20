"use server";

/**
 * Server-action wrapper around the reservation domain logic, for forms that
 * post directly without going through `/api/reservations`. Keeps a single
 * authoritative implementation in `src/lib/reservations.ts`.
 */
import { cookies, headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
    GUEST_CART_COOKIE,
    buildExpiredCookieAttrs,
    clearCartByToken,
} from "@/lib/cart/guest-cart";
import { capture, getPostHogSessionId } from "@/lib/posthog";
import { enqueueReservationExpiry } from "@/lib/queue";
import {
    createReservation,
    ReservationError,
    cancelReservation as cancelReservationDomain,
} from "@/lib/reservations";
import { cancelReservationSchema, createReservationSchema } from "@/lib/validations";

import type { ActionResult } from "./auth";

export async function createReservationAction(raw: unknown): Promise<
    ActionResult<{
        reservationId: string;
        referenceNumber: string;
        expiresAt: Date;
    }>
> {
    const parsed = createReservationSchema.safeParse(raw);
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

    const session = await auth();
    try {
        const result = await createReservation(parsed.data, {
            sessionCustomerId: session?.user?.customerId,
        });

        const expiryDelay = result.reservation.expiresAt.getTime() - Date.now();
        void enqueueReservationExpiry(result.reservation.id, expiryDelay).catch((err) =>
            console.error("[reservation] enqueue expiry failed", err)
        );

        // Drop the server-side guest cart mirror + cookie now that the
        // reservation owns the items. Best-effort — never fail the create
        // on a cart-cleanup hiccup.
        try {
            const store = await cookies();
            const token = store.get(GUEST_CART_COOKIE)?.value;
            if (token) {
                void clearCartByToken(token).catch((err) =>
                    console.error("[reservation] guest cart clear failed", err)
                );
                store.set(buildExpiredCookieAttrs());
            }
        } catch (err) {
            console.error("[reservation] guest cart cookie cleanup failed", err);
        }

        const sessionId = await getPostHogSessionId(await headers());
        capture({
            event: "reservation_submitted",
            distinctId: result.customer?.id ?? `email:${result.reservation.customerEmail}`,
            sessionId: sessionId ?? undefined,
            properties: {
                reservation_id: result.reservation.id,
                reference_number: result.reservation.referenceNumber,
                via: "server_action",
            },
        });

        return {
            ok: true,
            data: {
                reservationId: result.reservation.id,
                referenceNumber: result.reservation.referenceNumber,
                expiresAt: result.reservation.expiresAt,
            },
        };
    } catch (error) {
        if (error instanceof ReservationError) {
            return {
                ok: false,
                error: { code: error.code, message: error.message },
            };
        }
        console.error("[createReservationAction] failed", error);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}

export async function cancelReservationAction(
    reservationId: string,
    raw: unknown
): Promise<ActionResult<{ status: string }>> {
    const parsed = cancelReservationSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: { code: "validation_error", message: "Некорректные данные" },
        };
    }

    const session = await auth();
    if (!session?.user?.id) {
        return { ok: false, error: { code: "unauthorized", message: "Требуется авторизация" } };
    }

    const updated = await cancelReservationDomain(reservationId, {
        actor: session.user.role === "customer" ? "customer" : "studio",
        reason: parsed.data.reason,
    });
    if (!updated) {
        return { ok: false, error: { code: "not_found", message: "Бронь не найдена" } };
    }
    return { ok: true, data: { status: updated.status ?? "cancelled" } };
}
