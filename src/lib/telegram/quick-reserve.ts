/**
 * Single-variant "quick reservation" from inside the Telegram bot.
 *
 * Trigger flow (Phase H5):
 *   - Catalog page renders a "Open in Telegram" button:
 *     `https://t.me/<bot>?start=reserve_<variantId>`.
 *     The `/start` handler routes that to `quickReserveFlow()`.
 *   - Inside a chat, an inline-keyboard `reserve:<variantId>` callback also
 *     ends up here.
 *
 * Requirements:
 *   - The chat must already be linked to a customer record (`/start`
 *     deep-link `customer_<id>` does this). Otherwise we instruct the user
 *     to open their profile on the site first.
 *   - The customer must have a stored email + phone — we don't have a
 *     conversation flow for collecting them inline, so we reject early.
 *
 * Side effects on success:
 *   - Creates a 1-item reservation via `createReservation` (which decrements
 *     inventory in the same transaction).
 *   - Enqueues the BullMQ expiry job.
 *   - Sends the standard `notifyReservationCreated` Telegram message.
 *
 * Telegram-side audit: never throws past the boundary — every failure mode
 * becomes a chat reply describing what to do next.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { customers, db, productVariants, products } from "@/db";
import { enqueueReservationExpiry } from "@/lib/queue";
import { ReservationError, createReservation } from "@/lib/reservations";
import { notifyReservationCreated } from "./notifications";

export type QuickReserveOutcome =
    | { ok: true; referenceNumber: string; productTitle: string }
    | {
          ok: false;
          reason:
              | "no_customer_linked"
              | "missing_customer_contact"
              | "variant_not_found"
              | "out_of_stock"
              | "internal_error";
          message: string;
      };

const VARIANT_ID_RE = /^[a-f0-9-]{36}$/i;

/**
 * Try to reserve a single variant for the customer linked to this Telegram
 * chat. Returns a structured outcome the bot handler turns into a reply.
 */
export async function quickReserveForCustomer(
    customerId: string,
    variantId: string
): Promise<QuickReserveOutcome> {
    if (!VARIANT_ID_RE.test(variantId)) {
        return {
            ok: false,
            reason: "variant_not_found",
            message: "Не удалось распознать украшение.",
        };
    }

    // Load the customer's stored contact + the variant's title for the reply.
    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            firstName: customers.firstName,
            lastName: customers.lastName,
            phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

    if (!customer) {
        return {
            ok: false,
            reason: "no_customer_linked",
            message: "Чат не привязан к профилю. Войдите на сайте и привяжите бота заново.",
        };
    }
    if (!customer.email || !customer.phone) {
        return {
            ok: false,
            reason: "missing_customer_contact",
            message:
                "В профиле не заполнены email и телефон. Заполните их на сайте и попробуйте снова.",
        };
    }

    const [variantRow] = await db
        .select({ title: products.title })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(productVariants.id, variantId))
        .limit(1);
    if (!variantRow) {
        return {
            ok: false,
            reason: "variant_not_found",
            message: "Украшение больше недоступно.",
        };
    }

    try {
        const result = await createReservation(
            {
                items: [{ variantId, quantity: 1 }],
                customer: {
                    firstName: customer.firstName ?? "Гость",
                    lastName: customer.lastName ?? undefined,
                    email: customer.email,
                    phone: customer.phone,
                },
                source: "telegram",
            },
            { sessionCustomerId: customer.id }
        );

        const expiryDelay = result.reservation.expiresAt.getTime() - Date.now();
        void enqueueReservationExpiry(result.reservation.id, expiryDelay).catch((err) =>
            console.error("[tg.quickReserve] expiry enqueue failed", err)
        );

        // Fire the standard Telegram confirmation as well so the audit /
        // formatting matches the website flow.
        void notifyReservationCreated(result.reservation, {
            itemTitles: result.items.map((i) => i.title),
        }).catch((err) => console.error("[tg.quickReserve] notifyCreated failed", err));

        return {
            ok: true,
            referenceNumber: result.reservation.referenceNumber,
            productTitle: variantRow.title,
        };
    } catch (err) {
        if (err instanceof ReservationError) {
            return {
                ok: false,
                reason: err.code === "out_of_stock" ? "out_of_stock" : "variant_not_found",
                message: err.message,
            };
        }
        console.error("[tg.quickReserve] failed", err);
        return {
            ok: false,
            reason: "internal_error",
            message: "Не удалось создать бронь. Попробуйте через сайт.",
        };
    }
}
