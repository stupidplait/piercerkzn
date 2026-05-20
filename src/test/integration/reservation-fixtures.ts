/**
 * Reservation-domain integration test fixtures.
 *
 * Mirrors the tag-prefix cleanup convention from `helpers.ts`. Every
 * seeded row carries the caller-supplied `tag` in a textual column so
 * cleanup can locate it with a single `LIKE %tag%` predicate — no row
 * IDs need to escape the test file.
 *
 * Tag-prefix conventions (per design §"Test tag conventions"):
 *   product.handle                          = `${tag}-prod`
 *   product_variant.sku                     = `${tag}-sku-${i}`     i ∈ [0, variantCount)
 *   product_variant.title                   = `${tag}-variant-${i}`
 *   customer.email                          = `${tag}@test.local`
 *   reservation.customer_email (via SUT)    = `${tag}@test.local`   — propagated by createReservation
 *
 * Cleanup ordering (per design §"Phase 1" + the reservation_item FK
 * audit): `reservation_item.variant_id` has NO `ON DELETE CASCADE` on
 * the variant side, so reservations MUST be deleted before variants /
 * products. The four steps are:
 *
 *   1. reservations matching `customer_email LIKE %tag%`
 *      — reservation_items cascade away via the reservation FK.
 *   2. customers       matching `email LIKE %tag%`.
 *   3. product_variants matching `sku LIKE %tag%`
 *      — safe now that no reservation_item references them.
 *   4. products        matching `handle LIKE %tag%`
 *      — variants / areas / media cascade off product.id.
 *
 * Every step is idempotent (`DELETE … WHERE LIKE`) so the helper is
 * safe to call from `afterAll` even when `seedReservationFixtures`
 * threw mid-way through.
 */
import { eq, inArray, like } from "drizzle-orm";

import { customers, db, products, productVariants, reservationItems, reservations } from "@/db";
import { hashPassword } from "@/lib/auth-utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SeedReservationFixturesOptions {
    /** Number of `product_variant` rows attached to the seeded product. Default 1. */
    variantCount?: number;
    /** `inventory_quantity` written to every seeded variant. Default 5. */
    inventoryQty?: number;
    /** `priceRub` (kopecks) written to every seeded variant. Default 250 000 (= 2 500.00 ₽). */
    priceRub?: number;
}

export interface SeedReservationFixtures {
    /** PK of the seeded `product` row. */
    productId: string;
    /** PKs of the seeded `product_variant` rows; length === opts.variantCount. */
    variantIds: string[];
    /** PK of the seeded `customer` row (Argon2 hash of password `${tag}-pw`). */
    customerId: string;
    /** Tagged email; matches both `customer.email` and the SUT's `reservation.customerEmail`. */
    email: string;
    /** Recover the SKU for the i-th seeded variant. */
    sku: (i: number) => string;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const DEFAULT_VARIANT_COUNT = 1;
const DEFAULT_INVENTORY_QTY = 5;
const DEFAULT_PRICE_RUB = 250_000; // 2 500.00 ₽ in kopecks

/**
 * Insert one tagged `product`, `opts.variantCount` tagged `product_variant`
 * rows, and one tagged `customer` row. All natural keys carry the supplied
 * `tag` so `cleanupReservationRows(tag)` can locate and remove them later.
 */
export async function seedReservationFixtures(
    tag: string,
    opts: SeedReservationFixturesOptions = {}
): Promise<SeedReservationFixtures> {
    const variantCount = opts.variantCount ?? DEFAULT_VARIANT_COUNT;
    const inventoryQty = opts.inventoryQty ?? DEFAULT_INVENTORY_QTY;
    const priceRub = opts.priceRub ?? DEFAULT_PRICE_RUB;

    const sku = (i: number): string => `${tag}-sku-${i}`;

    // Product first — variants FK to it. We mark it `published` (with
    // `publishedAt` populated) so any list endpoint that filters by
    // status still surfaces the row; the reservation transaction itself
    // does not gate on status.
    const [product] = await db
        .insert(products)
        .values({
            handle: `${tag}-prod`,
            title: `${tag}-prod`,
            material: "titanium",
            jewelryType: "stud",
            status: "published",
            publishedAt: new Date(),
        })
        .returning({ id: products.id });

    // Variants — bulk insert with deterministic SKUs. `manageInventory`
    // is forced ON and `allowBackorder` OFF so the Phase 2 concurrent /
    // out-of-stock tests observe the documented gating.
    const variantRows = Array.from({ length: variantCount }, (_, i) => ({
        productId: product.id,
        title: `${tag}-variant-${i}`,
        sku: sku(i),
        priceRub,
        manageInventory: true,
        inventoryQuantity: inventoryQty,
        allowBackorder: false,
    }));
    const insertedVariants = await db
        .insert(productVariants)
        .values(variantRows)
        .returning({ id: productVariants.id });

    // Customer — Argon2 hash of `${tag}-pw` lets reservation tests "log
    // in" through the credentials provider when they need a session.
    // Argon2 is intentionally slow; this hash runs once per fixture seed.
    const passwordHash = await hashPassword(`${tag}-pw`);
    const email = `${tag}@test.local`;
    const [customer] = await db
        .insert(customers)
        .values({
            email,
            firstName: "Test",
            lastName: tag,
            phone: "+70000000000",
            passwordHash,
        })
        .returning({ id: customers.id });

    return {
        productId: product.id,
        variantIds: insertedVariants.map((v) => v.id),
        customerId: customer.id,
        email,
        sku,
    };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Idempotent cleanup. Deletes every row that carries `tag` in its tagged
 * column, in the strict order children → parents (see file header for
 * the full ordering rule).
 *
 * Safe to call from `afterAll` even when `seedReservationFixtures`
 * threw mid-way: every step is a `DELETE … WHERE LIKE` that tolerates
 * missing rows.
 */
export async function cleanupReservationRows(tag: string): Promise<void> {
    const pattern = `%${tag}%`;

    // 1. Reservations — matched via the snapshotted customer email so
    //    guest-checkout reservations (where `customerId` is NULL) are
    //    still picked up. reservation_items cascade away via the
    //    reservation.id FK.
    await db.delete(reservations).where(like(reservations.customerEmail, pattern));

    // 2. Customers — separate from reservations because the same email
    //    can appear on a guest reservation without a customer row.
    await db.delete(customers).where(like(customers.email, pattern));

    // 3. Product variants — safe to drop once no reservation_item
    //    references them (step 1 above removed those refs).
    await db.delete(productVariants).where(like(productVariants.sku, pattern));

    // 4. Products — variants / piercing-areas / media cascade off
    //    product.id, so a single DELETE is enough.
    await db.delete(products).where(like(products.handle, pattern));
}

// ---------------------------------------------------------------------------
// Pending-reservation factory
// ---------------------------------------------------------------------------

export interface CreatePendingReservationItem {
    /** Index into `fixtures.variantIds`. */
    variantIndex: number;
    /** Quantity to record on the reservation_item snapshot. Default 1. */
    quantity?: number;
}

export interface CreatePendingReservationOptions {
    /** Exact `expires_at` to write — caller decides "past" vs "future". */
    expiresAt: Date;
    /** Items to attach. Must reference variant indexes that exist in `fixtures.variantIds`. */
    items: CreatePendingReservationItem[];
}

/**
 * Insert a `pending` reservation row directly via Drizzle, bypassing the
 * route handler / `createReservation` SUT. Tests that need to control
 * `expires_at` precisely (idempotent expiry, cron sweep, …) reach for
 * this rather than going through the rest of the stack.
 *
 * Inventory is **not** decremented — this helper only writes the
 * reservation + reservation_item rows. Tests that need the decrement
 * should go through `createReservation` instead. The reference number
 * uses a tag-recognisable placeholder shape (`PK-RES-T-<rand>`); fixture
 * rows never round-trip through the customer-facing display layer.
 */
export async function createPendingReservationRow(
    fixtures: SeedReservationFixtures,
    opts: CreatePendingReservationOptions
): Promise<{ reservationId: string }> {
    if (opts.items.length === 0) {
        throw new Error("createPendingReservationRow: opts.items must contain at least one item");
    }

    // Validate variant indexes up front so the failure mode is a clear
    // RangeError, not a downstream FK violation halfway through the
    // INSERT batch.
    for (const item of opts.items) {
        if (item.variantIndex < 0 || item.variantIndex >= fixtures.variantIds.length) {
            throw new Error(
                `createPendingReservationRow: variantIndex ${item.variantIndex} ` +
                    `out of range [0, ${fixtures.variantIds.length})`
            );
        }
    }

    const referencedVariantIds = Array.from(
        new Set(opts.items.map((i) => fixtures.variantIds[i.variantIndex]))
    );

    const variantRows = await db
        .select({
            id: productVariants.id,
            title: productVariants.title,
            sku: productVariants.sku,
            priceRub: productVariants.priceRub,
            productId: productVariants.productId,
        })
        .from(productVariants)
        .where(inArray(productVariants.id, referencedVariantIds));

    const variantById = new Map(variantRows.map((v) => [v.id, v]));

    const [productRow] = await db
        .select({ title: products.title, thumbnailUrl: products.thumbnailUrl })
        .from(products)
        .where(eq(products.id, fixtures.productId))
        .limit(1);

    const [customerRow] = await db
        .select({
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.id, fixtures.customerId))
        .limit(1);

    if (!productRow || !customerRow) {
        throw new Error(
            "createPendingReservationRow: fixtures point at rows that no longer exist " +
                "(did the test cleanup run before this call?)"
        );
    }

    const itemRows = opts.items.map((item) => {
        const variantId = fixtures.variantIds[item.variantIndex];
        const variant = variantById.get(variantId);
        if (!variant) {
            throw new Error(`createPendingReservationRow: variant ${variantId} not found in DB`);
        }
        const quantity = item.quantity ?? 1;
        return {
            variantId: variant.id,
            productId: variant.productId,
            title: productRow.title,
            variantTitle: variant.title,
            sku: variant.sku,
            thumbnailUrl: productRow.thumbnailUrl,
            unitPrice: variant.priceRub,
            quantity,
            total: variant.priceRub * quantity,
        };
    });

    const total = itemRows.reduce((sum, r) => sum + r.total, 0);

    // Tag-recognisable reference that fits the 20-char `varchar` column.
    // The `T-` infix marks it as test-only; production code allocates
    // `PK-RES-YYYY-NNNN` via `nextReferenceNumber`.
    const refSuffix = Math.random().toString(36).slice(2, 10).toUpperCase();
    const referenceNumber = `PK-RES-T-${refSuffix}`;

    const [reservation] = await db
        .insert(reservations)
        .values({
            referenceNumber,
            customerId: fixtures.customerId,
            customerFirstName: customerRow.firstName,
            customerLastName: customerRow.lastName,
            customerEmail: customerRow.email,
            customerPhone: customerRow.phone ?? "+70000000000",
            status: "pending",
            total,
            currencyCode: "rub",
            expiresAt: opts.expiresAt,
        })
        .returning({ id: reservations.id });

    await db
        .insert(reservationItems)
        .values(itemRows.map((r) => ({ ...r, reservationId: reservation.id })));

    return { reservationId: reservation.id };
}

// ---------------------------------------------------------------------------
// Re-exports (AC 1.8)
// ---------------------------------------------------------------------------
//
// Reservation tests can clear rate-limit state via this module without
// reaching into upstash-stub directly — keeps the import surface for a
// reservation test file to a single fixture module.
export { resetUpstashStub } from "@/test/integration/upstash-stub";
