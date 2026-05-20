# Integration test harness

This directory hosts the shared infrastructure for the Vitest **integration**
suite — the tests matched by `app/vitest.integration.config.ts` and run by
`pnpm --filter app test:integration`. Integration tests import Next.js route
handlers directly (no HTTP server) and call them with synthetic `Request`
objects against a real Postgres database.

If you are writing your **first** integration test in this harness, read the
sections below in order. Everything you need to follow the existing 17 admin
test files plus the reservation-domain extensions lives here.

## 1. Overview

| File                      | Purpose                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.ts`                | Loads `.env.local`, fail-fast env checks, hoists the `vi.mock` stubs for `@/lib/auth`, `@/lib/rate-limit`, and `@/lib/api`.                                                        |
| `helpers.ts`              | `buildRequest`, `readResponse`, `makeTestTag`, `cleanupTaggedRows`, `snapshotPiercerProfile`, `snapshotWeeklySchedule`, `createCustomerForReservation`, `expectRowCountUnchanged`. |
| `upstash-stub.ts`         | In-memory drop-in for `@upstash/ratelimit` with a controllable clock and a per-test `resetUpstashStub()`.                                                                          |
| `reservation-fixtures.ts` | `seedReservationFixtures`, `cleanupReservationRows`, `createPendingReservationRow`. Re-exports `resetUpstashStub`.                                                                 |
| `../server-only.stub.ts`  | Aliased over `server-only` by the integration config so server modules import cleanly under `node`.                                                                                |

The integration config (`app/vitest.integration.config.ts`) is intentionally
separate from the unit config: it runs under the `node` environment, uses a
single fork (see §6), and only matches files ending in `*.integration.test.ts`.

## 2. Running the suite

```sh
pnpm --filter app test:integration
```

The setup file requires either `DATABASE_URL` or `DATABASE_URL_POOLER` to be
present; locally these come from `app/.env.local`. To target an isolated
database, export `TEST_DATABASE_URL` — `setup.ts` will rewrite both
`DATABASE_URL` and `DATABASE_URL_POOLER` to point at it for the duration of
the run, so the dev DB is never touched.

### Fail-fast contract (Req 1.6)

If neither `DATABASE_URL` nor `DATABASE_URL_POOLER` is set, the setup file
throws **before any test runs**:

> Integration tests require DATABASE_URL or DATABASE_URL_POOLER. Set
> TEST_DATABASE_URL or copy .env.example to .env.local.

The harness will never quietly fall back to a production-pointing connection
string. If you see this message, copy `app/.env.example` to `app/.env.local`
and supply a Test_DB URL.

## 3. Tag-prefix convention

Every integration test derives a unique tag with `makeTestTag(prefix)`:

```ts
import { makeTestTag } from "@/test/integration/helpers";

const tag = makeTestTag("svc"); // e.g. "svc-lq3a8w-9k2x4f"
```

The tag is then woven into every natural key the test inserts. Cleanup uses
SQL `LIKE %tag%` to find and delete those rows in `afterAll`. This is the
**only** mechanism for keeping the dev DB tidy across runs — there is no
per-test transaction wrapper.

### Where the tag goes per table

| Table                                            | Tagged column                            |
| ------------------------------------------------ | ---------------------------------------- |
| `service.handle`                                 | `${tag}-svc-…`                           |
| `setting.key`                                    | `${tag}.…`                               |
| `blog_post.slug`, `blog_category.handle`         | `${tag}-…`                               |
| `aftercare_guide.handle`                         | `${tag}-…`                               |
| `body_model.name`                                | `${tag} …`                               |
| `curated_look.handle`                            | `${tag}-…`                               |
| `product.handle`                                 | `${tag}-prod`                            |
| `product_variant.sku`, `product_variant.title`   | `${tag}-sku-${i}`, `${tag}-variant-${i}` |
| `customer.email`                                 | `${tag}@test.local`                      |
| `reservation.customer_email` (created by SUT)    | `${tag}@test.local`                      |
| `time_block.reason`, `schedule_exception.reason` | `${tag} …`                               |

The reservation columns mirror the customer column intentionally — that gives
`cleanupReservationRows(tag)` a single `LIKE %tag%` filter to find both
authenticated and guest reservations.

## 4. Cleanup ordering rule (CRITICAL)

> **Children before parents.**

Most cleanups are easy because the schema cascades correctly:
`product_variant`, `product_media`, and `product_area` all `ON DELETE CASCADE`
off `product`, so a single `DELETE FROM product WHERE handle LIKE %tag%`
removes the whole tree.

Reservations are the exception. The schema looks like this:

```
reservations
  └── reservation_items   (ON DELETE CASCADE off reservations)
                          (NO ON DELETE CASCADE on variant_id)

product
  └── product_variant     (ON DELETE CASCADE off product)
```

Because `reservation_items.variant_id` has **no** `ON DELETE CASCADE`,
deleting a `product_variant` while a `reservation_item` still references it
will raise a foreign-key violation. Reservations therefore **must** be
deleted before variants and products.

`cleanupReservationRows(tag)` (in `reservation-fixtures.ts`) deletes in the
required order, with each step tolerating missing rows so it is safe in
`afterAll` even when seeding threw mid-way:

1. `reservations` — child `reservation_items` cascade away with the parent.
2. `customers` — by `email LIKE %tag%`.
3. `product_variants` — by `sku LIKE %tag%` (now safe; no FKs left).
4. `products` — by `handle LIKE %tag%` (variants/areas/media cascade off).

### Which cleanup helper do I call?

| Test inserts…                                                                                          | Helper                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Services, settings, blog content, body models, looks, products **without** reservations                | `cleanupTaggedRows(tag)`                                                                                           |
| Anything that creates `reservation` / `reservation_item` rows (Phase 2 + 3 reservation-touching tests) | `cleanupReservationRows(tag)` (and `cleanupTaggedRows(tag)` if the test also touched the existing tagged surfaces) |

`cleanupTaggedRows` is fine for the 17 admin tests — none of them create
reservations. New reservation-domain tests must use `cleanupReservationRows`.

## 5. Auth and rate-limit mocks

`setup.ts` hoists three module mocks before any test file loads. The mocks
live process-wide; you do **not** need to redeclare them per file.

### `vi.mock("@/lib/auth", …)`

```ts
auth: vi.fn(async () => null),
handlers: { GET: vi.fn(), POST: vi.fn() },
signIn: vi.fn(),
signOut: vi.fn(),
```

This stops `@/lib/auth` from booting `next-auth` (which fails to resolve
`next/server` outside a Next runtime). Tests that need a real session
override `requireAdmin` directly via the `@/lib/api` mock below, or override
the `auth` mock per file for customer-scoped routes (`vi.mocked(auth)
.mockResolvedValueOnce({ user: { id: customerId } })`).

### `vi.mock("@/lib/rate-limit", …)`

```ts
check: vi.fn(async () => ({ success: true, remaining: 999, reset: 0 })),
ipFromHeaders: vi.fn(() => "127.0.0.1"),
```

By default every rate-limit check passes. Tests that exercise the 429 path
either flip the mock per-test or re-use the in-memory `Ratelimit` stub from
`upstash-stub.ts`.

### `vi.mock("@/lib/api", …)`

```ts
requireAdmin: vi.fn(async () => ({
    ctx: { userId: "00000000-0000-0000-0000-0000000000aa", role: "admin" },
    response: null,
})),
applyRateLimit: vi.fn(async () => null),
```

This is what lets the 17 admin tests skip session manufacturing entirely.
The rest of `@/lib/api` (`ok`, `fail`, `parseJson`, validation helpers) is
preserved via `vi.importActual`, so production behaviour is intact.

### Resetting Upstash state per test

When a test exercises a route that goes through `@upstash/ratelimit`, mock
the package with the in-memory stub and call `resetUpstashStub()` in
`beforeEach` to clear the bucket store and call log:

```ts
import { beforeEach, vi } from "vitest";
import { resetUpstashStub } from "@/test/integration/reservation-fixtures";
// or: from "@/test/integration/upstash-stub" — the fixtures module re-exports it.

vi.mock("@upstash/ratelimit", () => import("@/test/integration/upstash-stub"));

beforeEach(() => {
    resetUpstashStub();
});
```

`resetUpstashStub()` clears the bucket `Map`, the per-call log, and the
controlled clock. Without it, leftover state from one test can leak into
the next within the same file.

## 6. Run-time budget

`vitest.integration.config.ts` declares:

| Setting                        | Value       | Why                                                                                                                                                |
| ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testTimeout`                  | `30_000` ms | First-run schema introspection plus a cold Neon connection can take several seconds. Individual test cases should still finish in well under this. |
| `hookTimeout`                  | `30_000` ms | Same budget for `beforeAll` / `afterAll`. Reservation-fixture seeding and cleanup must stay within this.                                           |
| `pool`                         | `"forks"`   | Required for the `postgres` driver (no worker-thread compat).                                                                                      |
| `poolOptions.forks.singleFork` | `true`      | Concurrent test files within the same Postgres would clobber each other's tagged rows during cleanup. The single-fork constraint serialises files. |

The total integration suite budget on CI is **5 minutes** (Req 7.2). If the
budget is breached, the documented escalation path is to relax to `pool:
"forks"` with `maxForks: 2` provided per-test cleanup remains tag-isolated.
**Disabling tests is never the answer** — extend the harness or shard the
suite first.

## 7. Writing a new integration test

Drop a new file at `app/src/app/api/<your-route>/route.integration.test.ts`
(or `app/src/lib/<module>.integration.test.ts` for direct library tests).
Vitest will pick it up via the `*.integration.test.ts` glob.

### Minimal template — non-reservation route

```ts
import { afterAll, describe, expect, it } from "vitest";

import { GET, POST } from "./route";
import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("p3-yourroute");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

describe("/api/yourroute", () => {
    it("returns 200 on the happy path", async () => {
        const res = await GET(buildRequest("/api/yourroute", "GET"));
        const { status, json } = await readResponse(res);
        expect(status).toBe(200);
        expect(json).toMatchObject({ ok: true });
    });

    it("returns 400 on invalid body", async () => {
        const res = await POST(
            buildRequest("/api/yourroute", "POST", {
                body: {
                    /* breaks zod schema */
                },
            })
        );
        const { status, json } = await readResponse<{ error: { code: string } }>(res);
        expect(status).toBe(400);
        expect(json.error.code).toBe("VALIDATION_ERROR");
    });
});
```

### Minimal template — reservation-touching route

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { buildRequest, makeTestTag, readResponse } from "@/test/integration/helpers";
import {
    seedReservationFixtures,
    cleanupReservationRows,
    resetUpstashStub,
} from "@/test/integration/reservation-fixtures";

vi.mock("@upstash/ratelimit", () => import("@/test/integration/upstash-stub"));

const tag = makeTestTag("p2-reservations");

afterAll(async () => {
    await cleanupReservationRows(tag);
});

beforeEach(() => {
    resetUpstashStub();
});

describe("POST /api/reservations", () => {
    it("creates a pending reservation", async () => {
        const fixtures = await seedReservationFixtures(tag, { inventoryQty: 5 });
        const res = await POST(
            buildRequest("/api/reservations", "POST", {
                body: {
                    items: [{ variantId: fixtures.variantIds[0], quantity: 1 }],
                    customerEmail: fixtures.email,
                },
            })
        );
        const { status, json } = await readResponse<{ status: string }>(res);
        expect(status).toBe(201);
        expect(json.status).toBe("pending");
    });
});
```

For full examples, see the 17 admin tests under `src/app/api/admin/**/route.integration.test.ts` — the `services` and `settings` files are particularly idiomatic.

## See also

- `app/vitest.integration.config.ts` — the config that drives this suite.
- `.kiro/specs/testing-strategy-rollout/design.md` — design rationale,
  including the cleanup-ordering decision (D-1, D-2) and the reservation
  fixture shape.
- `.kiro/specs/testing-strategy-rollout/requirements.md` Req 1, 7 — the
  acceptance criteria this harness satisfies.
