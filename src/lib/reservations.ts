/**
 * Reservation domain logic shared between the route handler and the
 * server action. Lives in `lib/` so both call sites can import it.
 *
 * Policy:
 *   - 72-hour hold by default (configurable via `setting` key
 *     `reservation.hold_hours`, future Phase 11 work).
 *   - Inventory is decremented on creation and restored on cancel/expire.
 *   - Items snapshot title/sku/thumbnail/unitPrice so subsequent product
 *     edits do not mutate historical reservations.
 *   - Reference number generated inside the transaction.
 *
 * Returns the persisted reservation + items, plus side-effect intents
 * the caller can fire after the transaction commits (email, telegram,
 * BullMQ enqueue).
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import {
    db,
    customers,
    reservations,
    reservationItems,
    productVariants,
    products,
    type Customer,
    type Reservation,
    type ReservationItem,
} from "@/db";
import { hashPassword } from "@/lib/auth-utils";
import { allocateAndInsert } from "@/lib/reference-numbers";
import type { CreateReservationInput } from "@/lib/validations";

const DEFAULT_HOLD_HOURS = 72;

export interface CreateReservationResult {
    reservation: Reservation;
    items: ReservationItem[];
    customer: Pick<Customer, "id" | "email" | "firstName" | "lastName" | "phone"> | null;
    /** Was this reservation created with a brand-new customer account? */
    customerCreated: boolean;
    /** Random temporary password generated when `createAccount` was true and the customer is new. Never logged. */
    temporaryPassword: string | null;
}

export class ReservationError extends Error {
    constructor(
        message: string,
        readonly code: "out_of_stock" | "variant_not_found" | "invalid"
    ) {
        super(message);
        this.name = "ReservationError";
    }
}

/**
 * Atomically create a reservation, decrement inventory, snapshot prices,
 * and allocate a `PK-RES-YYYY-NNNN` reference number.
 *
 * The caller should:
 *   1. Enqueue the BullMQ expiry job (`enqueueReservationExpiry`)
 *   2. Send the confirmation email (`sendEmail`)
 *   3. Forward to Telegram if the customer has linked their bot account
 */
// The domain layer doesn't need the captcha token (it is a transport-level
// concern verified at the route boundary), so we accept any caller-shaped
// input that satisfies the persistence-relevant fields.
export type CreateReservationDomainInput = Omit<CreateReservationInput, "captchaToken">;

export async function createReservation(
    input: CreateReservationDomainInput,
    options: { sessionCustomerId?: string } = {}
): Promise<CreateReservationResult> {
    const holdHours = DEFAULT_HOLD_HOURS;
    const expiresAt = new Date(Date.now() + holdHours * 3600 * 1_000);

    let temporaryPassword: string | null = null;

    return db.transaction(async (tx) => {
        // -------------------------------------------------------------------
        // Resolve / create customer record
        // -------------------------------------------------------------------
        let customerRow: Customer | null = null;
        let customerCreated = false;

        if (options.sessionCustomerId) {
            const [c] = await tx
                .select()
                .from(customers)
                .where(eq(customers.id, options.sessionCustomerId))
                .limit(1);
            if (c && !c.deletedAt) customerRow = c;
        }

        if (!customerRow) {
            const [byEmail] = await tx
                .select()
                .from(customers)
                .where(eq(customers.email, input.customer.email))
                .limit(1);
            if (byEmail && !byEmail.deletedAt) customerRow = byEmail;
        }

        if (!customerRow && input.createAccount) {
            // Generate a single-use random password the visitor can later reset.
            temporaryPassword =
                Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
            const passwordHash = await hashPassword(temporaryPassword);
            const [created] = await tx
                .insert(customers)
                .values({
                    email: input.customer.email,
                    firstName: input.customer.firstName,
                    lastName: input.customer.lastName ?? null,
                    phone: input.customer.phone,
                    passwordHash,
                })
                .returning();
            customerRow = created;
            customerCreated = true;
        }

        // -------------------------------------------------------------------
        // Lock + lookup variants, snapshot pricing, decrement inventory
        // -------------------------------------------------------------------
        const itemsToInsert: (typeof reservationItems.$inferInsert)[] = [];
        let total = 0;

        for (const item of input.items) {
            const [row] = await tx
                .select({
                    variantId: productVariants.id,
                    productId: productVariants.productId,
                    title: products.title,
                    variantTitle: productVariants.title,
                    sku: productVariants.sku,
                    thumbnailUrl: products.thumbnailUrl,
                    priceRub: productVariants.priceRub,
                    inventoryQuantity: productVariants.inventoryQuantity,
                    manageInventory: productVariants.manageInventory,
                    allowBackorder: productVariants.allowBackorder,
                })
                .from(productVariants)
                .innerJoin(products, eq(products.id, productVariants.productId))
                .where(eq(productVariants.id, item.variantId))
                .limit(1)
                .for("update"); // lock row to serialise concurrent reservations

            if (!row) {
                throw new ReservationError(
                    `Вариант ${item.variantId} не найден`,
                    "variant_not_found"
                );
            }

            if (
                row.manageInventory &&
                !row.allowBackorder &&
                (row.inventoryQuantity ?? 0) < item.quantity
            ) {
                throw new ReservationError(
                    `«${row.title}» закончился. Выберите другой вариант.`,
                    "out_of_stock"
                );
            }

            if (row.manageInventory) {
                await tx
                    .update(productVariants)
                    .set({
                        inventoryQuantity: sql`${productVariants.inventoryQuantity} - ${item.quantity}`,
                    })
                    .where(eq(productVariants.id, row.variantId));
            }

            const lineTotal = row.priceRub * item.quantity;
            total += lineTotal;
            itemsToInsert.push({
                reservationId: "", // filled in after parent insert
                productId: row.productId,
                variantId: row.variantId,
                title: row.title,
                variantTitle: row.variantTitle,
                sku: row.sku,
                thumbnailUrl: row.thumbnailUrl,
                unitPrice: row.priceRub,
                quantity: item.quantity,
                total: lineTotal,
                metadata: item.metadata ?? {},
            });
        }

        // -------------------------------------------------------------------
        // Insert reservation header + reference number
        // -------------------------------------------------------------------
        const { row: reservation } = await allocateAndInsert<Reservation>(
            "RES",
            {
                table: reservations,
                referenceColumn: reservations.referenceNumber,
                createdAtColumn: reservations.createdAt,
                uniqueConstraintName: "reservation_reference_number_unique",
            },
            tx as unknown as typeof db,
            (referenceNumber) => ({
                referenceNumber,
                customerId: customerRow?.id ?? null,
                customerFirstName: input.customer.firstName,
                customerLastName: input.customer.lastName ?? null,
                customerEmail: input.customer.email,
                customerPhone: input.customer.phone,
                status: "pending",
                total,
                currencyCode: "rub",
                expiresAt,
                customerNotes: input.notes ?? null,
                metadata: { source: input.source ?? "catalog" },
            })
        );

        const itemsWithFk = itemsToInsert.map((i) => ({ ...i, reservationId: reservation.id }));
        const insertedItems = await tx.insert(reservationItems).values(itemsWithFk).returning();

        return {
            reservation,
            items: insertedItems,
            customer: customerRow
                ? {
                      id: customerRow.id,
                      email: customerRow.email,
                      firstName: customerRow.firstName,
                      lastName: customerRow.lastName,
                      phone: customerRow.phone,
                  }
                : null,
            customerCreated,
            temporaryPassword,
        };
    });
}

/**
 * Mark a reservation cancelled and restore inventory. Idempotent —
 * cancelling an already-cancelled or expired reservation is a no-op.
 */
export async function cancelReservation(
    reservationId: string,
    options: { reason?: string; actor: "customer" | "studio" | "system" } = { actor: "customer" }
): Promise<Reservation | null> {
    return db.transaction(async (tx) => {
        const [r] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, reservationId))
            .limit(1)
            .for("update");

        if (!r) return null;
        if (r.status !== "pending" && r.status !== "confirmed") return r;

        const items = await tx
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, reservationId));

        for (const item of items) {
            if (!item.variantId) continue;
            await tx
                .update(productVariants)
                .set({
                    inventoryQuantity: sql`${productVariants.inventoryQuantity} + ${item.quantity}`,
                })
                .where(eq(productVariants.id, item.variantId));
        }

        const reasonNote = options.reason ? `Отмена (${options.actor}): ${options.reason}` : null;

        const [updated] = await tx
            .update(reservations)
            .set({
                status: "cancelled",
                cancelledAt: new Date(),
                internalNotes: reasonNote,
            })
            .where(eq(reservations.id, reservationId))
            .returning();

        return updated;
    });
}

/**
 * Worker entry point — flips status to `expired`, restores inventory.
 * Idempotent.
 */
export async function expireReservation(reservationId: string): Promise<Reservation | null> {
    return db.transaction(async (tx) => {
        const [r] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, reservationId))
            .limit(1)
            .for("update");
        if (!r) return null;
        if (r.status !== "pending") return r;
        if (r.expiresAt > new Date()) return r; // not yet due

        const items = await tx
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, reservationId));
        for (const item of items) {
            if (!item.variantId) continue;
            await tx
                .update(productVariants)
                .set({
                    inventoryQuantity: sql`${productVariants.inventoryQuantity} + ${item.quantity}`,
                })
                .where(eq(productVariants.id, item.variantId));
        }

        const [updated] = await tx
            .update(reservations)
            .set({ status: "expired", expiredAt: new Date() })
            .where(eq(reservations.id, reservationId))
            .returning();
        return updated;
    });
}
