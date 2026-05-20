/**
 * Shared helpers for route-handler integration tests.
 *
 * Each test file derives a unique `tag` (random suffix) and prefixes every
 * inserted natural key (service handle, exception reason, etc.) with it.
 * `cleanupTaggedRows()` in `afterAll` then deletes everything matching that
 * tag, leaving the dev DB tidy.
 *
 * No HTTP server is involved — we import the route handlers directly and
 * call them with synthetic `Request` instances. `Request` is supported
 * natively in Node 18+, which Next 16 already requires.
 */
import { eq, like, sql } from "drizzle-orm";

import {
    aftercareGuides,
    appointmentServices,
    blogCategories,
    blogPosts,
    bodyModels,
    curatedLooks,
    customers,
    db,
    inquiries,
    piercerProfile,
    piercerSchedule,
    products,
    scheduleExceptions,
    services,
    settings,
    timeBlocks,
} from "@/db";
import { hashPassword } from "@/lib/auth-utils";

// ---------------------------------------------------------------------------
// Unique test tag
// ---------------------------------------------------------------------------

/**
 * Returns a short random tag used to namespace test rows. Use it as a prefix
 * for service `handle`, exception `reason`, time block `reason`, etc., then
 * call `cleanupTaggedRows(tag)` in `afterAll`.
 */
export function makeTestTag(prefix = "it"): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

const BASE = "http://test.local";

export interface CallOpts {
    /** Query-string object — values are stringified. */
    query?: Record<string, string | number | boolean | undefined>;
    /** JSON body. Omit for GET/DELETE. */
    body?: unknown;
    /** Override the request method. Defaults inferred from the handler. */
    method?: string;
}

/** Construct a synthetic `Request` for a route handler call. */
export function buildRequest(path: string, method: string, opts: CallOpts = {}): Request {
    const url = new URL(path, BASE);
    if (opts.query) {
        for (const [k, v] of Object.entries(opts.query)) {
            if (v !== undefined) url.searchParams.set(k, String(v));
        }
    }
    const init: RequestInit = { method };
    if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        init.headers = { "content-type": "application/json" };
    }
    return new Request(url, init);
}

export interface Parsed<T = unknown> {
    status: number;
    json: T;
}

/** Read a `Response` (or `NextResponse`) into `{ status, json }`. */
export async function readResponse<T = unknown>(res: Response): Promise<Parsed<T>> {
    const text = await res.text();
    const json = text ? (JSON.parse(text) as T) : (undefined as T);
    return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Row cleanup
// ---------------------------------------------------------------------------

/**
 * Delete rows that match the given tag in their tagged columns. Idempotent.
 * Add more tables here as new integration test files target new domains.
 *
 * Order matters: child rows (look_piece, appointment_service) must be
 * removed before their parents — but our test rows never reference real
 * customer / appointment rows, so most child-cleanup is a no-op safety net.
 */
export async function cleanupTaggedRows(tag: string): Promise<void> {
    const pattern = `%${tag}%`;

    // Service-side rows (E5 surface)
    await db.delete(scheduleExceptions).where(like(scheduleExceptions.reason, pattern));
    await db.delete(timeBlocks).where(like(timeBlocks.reason, pattern));
    await db.delete(appointmentServices).where(
        // No textual column — clean by serviceId via the join below if needed.
        sql`false`
    );
    await db.delete(services).where(like(services.handle, pattern));

    // Settings (E1 surface) — tests insert their own rows with tagged
    // `setting.key`; drop them so the live `setting` table doesn't grow.
    await db.delete(settings).where(like(settings.key, pattern));

    // Looks (E4 surface) — must be deleted BEFORE products/body_models
    // because `look_piece` FKs `product_variant` and `piercing_point`
    // (without ON DELETE CASCADE on the variant side). The look_piece rows
    // cascade away with the parent look, so dropping tagged looks first
    // releases the variant + anchor refs before the product/body_model
    // cleanups try to remove them.
    await db.delete(curatedLooks).where(like(curatedLooks.handle, pattern));

    // Content (E2 surface) — blog posts first (FK to blog_category by
    // categoryId, no cascade so categories can't drop while posts exist),
    // then categories, then aftercare guides. All tagged via `slug` /
    // `handle`.
    await db.delete(blogPosts).where(like(blogPosts.slug, pattern));
    await db.delete(blogCategories).where(like(blogCategories.handle, pattern));
    await db.delete(aftercareGuides).where(like(aftercareGuides.handle, pattern));

    // Products (D surface) — FK cascades take care of variants, areas, and
    // media, so a single DELETE on `product` is enough now that any looks
    // that referenced their variants are gone.
    await db.delete(products).where(like(products.handle, pattern));

    // Body models (E3 surface) — FK cascades take care of piercing_point.
    // Tagged via the model `name` column. Done after looks so any look
    // that pointed at a tagged anchor has already been deleted.
    await db.delete(bodyModels).where(like(bodyModels.name, pattern));

    // Inquiries (contact form submissions) — `inquiry` is leaf-only
    // (no other table FKs to it except `inquiry_reply` which cascades
    // off `inquiry.id`), so a single tagged-email DELETE is enough.
    // The contact route inserts the customer's email verbatim, so
    // tests pass `${tag}@test.local` and the `LIKE %tag%` predicate
    // matches it.
    await db.delete(inquiries).where(like(inquiries.email, pattern));
}

/**
 * Reset the `piercer_schedule` table to the seed state. Used by the weekly-
 * schedule integration tests since that table has at most 7 rows and we
 * intentionally exercise the upsert path.
 *
 * The seed canonical state has all 7 days; we rewrite them to a safe
 * "all-closed" baseline. Tests should leave the table in a predictable
 * state for subsequent test runs.
 */
export async function resetWeeklySchedule(): Promise<void> {
    await db.delete(piercerSchedule);
    // Reinstate 7 closed days so other parts of the test suite that
    // depend on weekly rows don't break.
    await db.insert(piercerSchedule).values(
        Array.from({ length: 7 }, (_, i) => ({
            dayOfWeek: i,
            isWorking: false,
            startTime: null,
            endTime: null,
            breaks: [],
        }))
    );
}

// ---------------------------------------------------------------------------
// Snapshot/restore helpers for singleton/seeded tables
// ---------------------------------------------------------------------------

/**
 * Capture the full `piercer_schedule` table so a test can mutate it freely
 * (the table is unique on `dayOfWeek`, so the integration tests have to use
 * the real rows). The returned function restores the snapshot exactly.
 *
 * Usage:
 *   const restore = await snapshotWeeklySchedule();
 *   afterAll(restore);
 */
export async function snapshotWeeklySchedule(): Promise<() => Promise<void>> {
    const rows = await db.select().from(piercerSchedule);
    return async () => {
        await db.delete(piercerSchedule);
        if (rows.length === 0) return;
        await db.insert(piercerSchedule).values(
            rows.map((r) => ({
                dayOfWeek: r.dayOfWeek,
                isWorking: r.isWorking,
                startTime: r.startTime,
                endTime: r.endTime,
                breaks: r.breaks ?? [],
            }))
        );
    };
}

/**
 * Capture the singleton `piercer_profile` row so tests can PATCH it without
 * leaving permanent state changes. Returns a `restore()` callable.
 *
 * If the profile row is missing (un-seeded DB), the restore is a no-op so
 * the test can still detect that state via its own GET assertions.
 */
export async function snapshotPiercerProfile(): Promise<() => Promise<void>> {
    const [row] = await db.select().from(piercerProfile).limit(1);
    if (!row) return async () => {};
    return async () => {
        await db
            .update(piercerProfile)
            .set({
                firstName: row.firstName,
                lastName: row.lastName,
                title: row.title,
                bio: row.bio,
                avatarUrl: row.avatarUrl,
                bannerUrl: row.bannerUrl,
                experienceYears: row.experienceYears,
                specializations: row.specializations,
                certifications: row.certifications,
                socialInstagram: row.socialInstagram,
                socialTiktok: row.socialTiktok,
                socialTelegram: row.socialTelegram,
                updatedAt: row.updatedAt,
            })
            .where(eq(piercerProfile.id, row.id));
    };
}

// ---------------------------------------------------------------------------
// Reservation-domain customer helper
// ---------------------------------------------------------------------------

/**
 * Insert a tagged `customer` row with a deterministic Argon2 password hash
 * (`${tag}-pw`) and return the inserted row's `id` + `email`. Reservation
 * tests pass these to `createReservation` as the session customer or guest
 * email.
 *
 * Argon2 is intentionally slow (OWASP 2024 params: 19 MiB / 2 iterations).
 * The hash is computed per call, so tests should reuse this helper at the
 * `beforeAll` level rather than minting a fresh customer per test.
 *
 * No cleanup is registered here — the caller's `afterAll` is expected to
 * invoke `cleanupReservationRows(tag)` (which deletes by `email LIKE %tag%`)
 * or `cleanupTaggedRows(tag)` once that helper extends to `customer`.
 */
export async function createCustomerForReservation(
    tag: string
): Promise<{ id: string; email: string }> {
    const email = `${tag}@test.local`;
    const passwordHash = await hashPassword(`${tag}-pw`);
    const [created] = await db
        .insert(customers)
        .values({
            email,
            passwordHash,
            firstName: tag,
        })
        .returning({ id: customers.id, email: customers.email });
    return { id: created.id, email: created.email };
}

// ---------------------------------------------------------------------------
// Row-count snapshot assertion (AC 2.12)
// ---------------------------------------------------------------------------

/**
 * Assert that every table key in `before` has the same row count in `after`.
 * Used by Phase 2/3 integration tests in `afterAll` to guarantee that
 * cleanup left the Test_DB row counts unchanged from the snapshot taken in
 * `beforeAll`.
 *
 * Throws a plain `AssertionError` (not Vitest's `expect`) so this helper
 * can be imported from non-Vitest contexts — notably the Playwright
 * `globalSetup` / `globalTeardown` path which loads
 * `e2e/fixtures/seed.ts` → `@/test/integration/reservation-fixtures` →
 * this file. Vitest's runtime is not available there and would crash
 * the entire e2e suite at import time.
 *
 * The thrown error message names every diverged table with both
 * before/after counts so a failure is actionable without a stack
 * trace dive.
 */
export function expectRowCountUnchanged(
    before: Record<string, number>,
    after: Record<string, number>
): void {
    const diverged: string[] = [];
    for (const [table, beforeCount] of Object.entries(before)) {
        const afterCount = after[table];
        if (afterCount !== beforeCount) {
            diverged.push(`${table}: before=${beforeCount}, after=${afterCount}`);
        }
    }
    if (diverged.length > 0) {
        throw new Error(
            `row counts diverged for ${diverged.length} table(s):\n  ${diverged.join("\n  ")}`
        );
    }
}
