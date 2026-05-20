/**
 * Integration tests for `POST /api/unsubscribe` — the RFC 8058 one-click
 * unsubscribe endpoint that newsletter footers and MUA clients hit with
 * an HMAC-signed token. The token format and verifier live in
 * `@/lib/newsletters/unsubscribe-token` (see the unit tests there for
 * the namespace + tampering coverage).
 *
 * Imports the route handler directly and calls it with synthetic
 * `Request` objects (no HTTP server), per the Phase 3 convention shared
 * with `src/app/api/contact/route.integration.test.ts`.
 *
 * Scope (Phase 3, task 3.10):
 *   1. Happy path — seed a tagged customer with
 *      `notificationMarketing = true`, mint a token via the actual SUT
 *      helper `buildUnsubscribeToken`, hit the route, expect 200 and
 *      verify the column flipped to `false` in storage (Req 3.1, 3.2).
 *   2. Invalid token — hit with a tampered HMAC, expect 400 with the
 *      route's `"invalid token"` body (Req 3.4, 3.5).
 *   3. Idempotence — hit twice with the same valid token; both calls
 *      succeed and the column stays `false`. The route always returns
 *      200 because the underlying UPDATE matches by `customers.id` and
 *      the row still exists; idempotence here is "second call is a
 *      no-op with the same wire response" (Req 3.8).
 *
 * ---------------------------------------------------------------------------
 * Cleanup strategy
 * ---------------------------------------------------------------------------
 *
 * The route mutates `customer.notification_marketing` rather than
 * inserting new rows. We follow the snapshot-restore option: insert a
 * tagged customer in `beforeAll`, snapshot global row counts, and in
 * `afterAll` delete the tagged customer by `email LIKE %tag%`. The
 * generic `cleanupTaggedRows(tag)` helper does not currently delete
 * `customer` rows (it focuses on the catalog / content / contact
 * surfaces), so this file owns its own customer cleanup — same shape as
 * the reservation-domain cleanup in `cleanupReservationRows`. The
 * `expectRowCountUnchanged` assertion in `afterAll` then catches any
 * row leak on top.
 */
import { count, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET, POST } from "./route";
import { customers, db } from "@/db";
import { buildUnsubscribeToken } from "@/lib/newsletters/unsubscribe-token";
import { buildRequest, expectRowCountUnchanged, makeTestTag } from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tag = makeTestTag("p3-unsub");
const email = `${tag}@test.local`;
let customerId: string;

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (Req 3.8)
// ---------------------------------------------------------------------------

type RowCounts = Record<string, number>;

async function snapshotRowCounts(): Promise<RowCounts> {
    const [[customerCount]] = await Promise.all([db.select({ n: count() }).from(customers)]);
    return {
        customer: customerCount.n,
    };
}

/** Read the current `notificationMarketing` value for the seeded customer. */
async function readMarketingFlag(): Promise<boolean | null> {
    const [row] = await db
        .select({ flag: customers.notificationMarketing })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
    return row?.flag ?? null;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/unsubscribe integration", () => {
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        // Snapshot first so the seeded row counts as +1 in afterAll
        // verification — `expectRowCountUnchanged` then catches any
        // *additional* leak.
        snapshotBefore = await snapshotRowCounts();

        // Seed a tagged customer with marketing-consent ON. The route's
        // job is to flip it OFF when given a valid token.
        const [created] = await db
            .insert(customers)
            .values({
                email,
                firstName: tag,
                notificationMarketing: true,
            })
            .returning({ id: customers.id });
        customerId = created.id;
    });

    afterAll(async () => {
        // Idempotent — safe even if the seed threw mid-way. The
        // generic `cleanupTaggedRows(tag)` does not cover `customer`
        // rows, so we delete by the tagged email here.
        await db.delete(customers).where(like(customers.email, `%${tag}%`));

        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // Happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // Mint a token via the actual SUT helper and POST it. The route
    // returns the literal body `"ok"` on success (it is a one-click
    // RFC 8058 endpoint, not a JSON API), so we assert on the raw
    // text rather than parsing JSON.
    it("flips notificationMarketing to false on a valid token (Req 3.1, 3.2)", async () => {
        // Pre-condition: the seed put the flag in the ON state.
        expect(await readMarketingFlag()).toBe(true);

        const token = buildUnsubscribeToken(customerId);
        const res = await POST(buildRequest("/api/unsubscribe", "POST", { query: { token } }));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
        expect(await readMarketingFlag()).toBe(false);
    });

    // -------------------------------------------------------------------
    // Invalid token → 400 (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // Tamper the HMAC byte so `verifyUnsubscribeToken` returns null and
    // the route short-circuits before touching the DB. A guaranteed-
    // invalid token also doubles as the "missing token" branch (the
    // route returns the same 400 + body either way).
    it("rejects a tampered token with HTTP 400 (Req 3.4, 3.5)", async () => {
        // First reset the flag back to ON so we can prove this branch
        // does NOT mutate it. The previous happy-path test already
        // flipped it to OFF.
        await db
            .update(customers)
            .set({ notificationMarketing: true })
            .where(eq(customers.id, customerId));

        const valid = buildUnsubscribeToken(customerId);
        const [head, sig] = valid.split(".");
        // Flip a single hex character in the HMAC suffix so the
        // signature mismatches under `timingSafeEqual`. Use the
        // namespace-aware helper's own contract: a same-length sig with
        // a different first character reliably fails verification.
        const tampered = `${head}.${sig.startsWith("a") ? "b" : "a"}${sig.slice(1)}`;

        const res = await POST(
            buildRequest("/api/unsubscribe", "POST", {
                query: { token: tampered },
            })
        );

        expect(res.status).toBe(400);
        expect(await res.text()).toBe("invalid token");
        // Verify the route did not touch the DB on the rejection path.
        expect(await readMarketingFlag()).toBe(true);
    });

    // -------------------------------------------------------------------
    // Idempotence (Req 3.8)
    // -------------------------------------------------------------------
    //
    // Two POSTs with the same valid token both return the same
    // successful wire response. The DB column remains `false` after the
    // second call — it was already `false` when the second call ran, so
    // this exercises the "already-opted-out" no-op semantics.
    //
    // The route's UPDATE matches by `customers.id` and returns the row
    // unconditionally, so `flipMarketingOptOut` returns true even when
    // the value did not actually change. That is what makes the second
    // call return 200 rather than 400 — the contract under test.
    it("returns the same successful response on a repeated valid token (Req 3.8)", async () => {
        // Reset to ON so we can observe both: (1) first call flips to
        // OFF, (2) second call leaves OFF unchanged and still returns
        // the success wire shape.
        await db
            .update(customers)
            .set({ notificationMarketing: true })
            .where(eq(customers.id, customerId));

        const token = buildUnsubscribeToken(customerId);

        const first = await POST(buildRequest("/api/unsubscribe", "POST", { query: { token } }));
        expect(first.status).toBe(200);
        expect(await first.text()).toBe("ok");
        expect(await readMarketingFlag()).toBe(false);

        const second = await POST(buildRequest("/api/unsubscribe", "POST", { query: { token } }));
        expect(second.status).toBe(200);
        expect(await second.text()).toBe("ok");
        // Column stays OFF — second call was a no-op with the same
        // wire response as the first.
        expect(await readMarketingFlag()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// GET /api/unsubscribe — browser redirect flow (task 11.6)
// ---------------------------------------------------------------------------

describe("GET /api/unsubscribe integration", () => {
    let snapshotBefore: RowCounts;
    const getTag = makeTestTag("p3-unsub-get");
    const getEmail = `${getTag}@test.local`;
    let getCustomerId: string;

    beforeAll(async () => {
        snapshotBefore = await snapshotRowCounts();
        const [created] = await db
            .insert(customers)
            .values({
                email: getEmail,
                firstName: getTag,
                notificationMarketing: true,
            })
            .returning({ id: customers.id });
        getCustomerId = created.id;
    });

    afterAll(async () => {
        await db.delete(customers).where(like(customers.email, `%${getTag}%`));
        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    it("redirects to /unsubscribe?ok=1 on valid token and flips flag (Req 8.3)", async () => {
        expect(await readMarketingFlagFor(getCustomerId)).toBe(true);

        const token = buildUnsubscribeToken(getCustomerId);
        const res = await GET(buildRequest("/api/unsubscribe", "GET", { query: { token } }));

        expect(res.status).toBe(302);
        const location = res.headers.get("location") ?? "";
        expect(location).toContain("/unsubscribe?ok=1");
        expect(await readMarketingFlagFor(getCustomerId)).toBe(false);
    });

    it("repeated GET with valid token still redirects to ?ok=1 (idempotence, Req 8.6)", async () => {
        const token = buildUnsubscribeToken(getCustomerId);
        const res = await GET(buildRequest("/api/unsubscribe", "GET", { query: { token } }));
        expect(res.status).toBe(302);
        expect(res.headers.get("location") ?? "").toContain("/unsubscribe?ok=1");
        expect(await readMarketingFlagFor(getCustomerId)).toBe(false);
    });

    it("redirects to /unsubscribe?error=invalid on tampered token (Req 8.4)", async () => {
        const valid = buildUnsubscribeToken(getCustomerId);
        const [head, sig] = valid.split(".");
        const tampered = `${head}.${sig.startsWith("a") ? "b" : "a"}${sig.slice(1)}`;

        const res = await GET(
            buildRequest("/api/unsubscribe", "GET", { query: { token: tampered } })
        );
        expect(res.status).toBe(302);
        expect(res.headers.get("location") ?? "").toContain("error=invalid");
    });

    it("redirects to /unsubscribe?error=invalid when token is missing (Req 8.5)", async () => {
        const res = await GET(buildRequest("/api/unsubscribe", "GET", {}));
        expect(res.status).toBe(302);
        expect(res.headers.get("location") ?? "").toContain("error=invalid");
    });
});

/** Read the current `notificationMarketing` value for any customer by id. */
async function readMarketingFlagFor(id: string): Promise<boolean | null> {
    const [row] = await db
        .select({ flag: customers.notificationMarketing })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);
    return row?.flag ?? null;
}
