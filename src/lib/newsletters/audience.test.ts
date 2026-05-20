/**
 * Unit tests for the marketing audience selector.
 *
 * The audience query is a one-shot Drizzle SELECT against the `customer`
 * table; an integration test (Phase 11.x) covers the actual SQL. At the
 * unit-test layer we mock `@/db` and verify the orchestration contract:
 *
 *   - The function returns the rows produced by the chain.
 *   - The post-DB `email !== null` filter strips any `email: null` rows
 *     that slip past the SQL guard (defence-in-depth).
 *   - Ordering is preserved from the chain (the `orderBy` is a `customer.id`
 *     `asc` per the implementation; this test exercises the fact that the
 *     selector doesn't reorder its results in JS).
 *
 * Properties covered:
 *   - Property 4: Audience selection respects opt-in + soft-delete + email-present
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbState, queueSelectResult, dbModule } = vi.hoisted(() => {
    interface DbState {
        selectByTable: Map<string, unknown[][]>;
    }
    const dbState: DbState = { selectByTable: new Map() };
    function selectFromTable(table: string) {
        const queue = dbState.selectByTable.get(table) ?? [];
        const next = queue.shift() ?? [];
        dbState.selectByTable.set(table, queue);
        return next;
    }
    function queueSelectResult(table: string, rows: unknown[]) {
        const existing = dbState.selectByTable.get(table) ?? [];
        existing.push(rows);
        dbState.selectByTable.set(table, existing);
    }

    const customers = { __table: "customers" } as const;

    function tableTag(table: object): string {
        return (table as { __table?: string }).__table ?? "unknown";
    }

    function makeChain(table: string) {
        const result = () => selectFromTable(table);
        const obj = {
            where: () => obj,
            orderBy: () => obj,
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                return Promise.resolve(result()).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve(result()).catch(reject);
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (table: object) => makeChain(tableTag(table)),
            }),
        },
        customers,
    };

    return { dbState, queueSelectResult, dbModule };
});

vi.mock("@/db", () => dbModule);
vi.mock("drizzle-orm", () => ({
    eq: () => null,
    and: () => null,
    asc: () => null,
    isNull: () => null,
    isNotNull: () => null,
}));

import { selectMarketingAudience } from "./audience";

beforeEach(() => {
    dbState.selectByTable.clear();
});
afterEach(() => {
    vi.useRealTimers();
});

// ===========================================================================
// Property 4 — Audience selection respects opt-in + soft-delete + email
// Validates: Requirements 4.1, 4.2
// ===========================================================================
describe("selectMarketingAudience — Property 4", () => {
    it("returns rows produced by the WHERE-bound chain", async () => {
        // The DB-side WHERE filter is enforced by the SQL; at the orchestration
        // layer we just ensure the function returns the rows the chain yields.
        queueSelectResult("customers", [
            { id: "c-001", email: "alice@example.com" },
            { id: "c-002", email: "bob@example.com" },
            { id: "c-003", email: "carol@example.com" },
        ]);

        const audience = await selectMarketingAudience();
        expect(audience).toEqual([
            { id: "c-001", email: "alice@example.com" },
            { id: "c-002", email: "bob@example.com" },
            { id: "c-003", email: "carol@example.com" },
        ]);
    });

    it("returns an empty list when no rows match", async () => {
        queueSelectResult("customers", []);
        expect(await selectMarketingAudience()).toEqual([]);
    });

    it("filters out rows with email=null (defence-in-depth)", async () => {
        // The SQL clause `isNotNull(customers.email)` should already reject
        // null emails, but the post-query filter exists as a belt-and-braces
        // guard in case the schema allows a runtime null to slip through.
        queueSelectResult("customers", [
            { id: "c-001", email: "alice@example.com" },
            { id: "c-002", email: null },
            { id: "c-003", email: "carol@example.com" },
        ]);
        const audience = await selectMarketingAudience();
        expect(audience.map((r) => r.id)).toEqual(["c-001", "c-003"]);
    });

    it("preserves the ordering produced by the chain (no JS-side reorder)", async () => {
        // `id` ordering happens in SQL via `orderBy(asc(customers.id))`. Our
        // mock chain ignores the orderBy call, so we feed pre-sorted rows
        // and assert the function does not perturb them.
        queueSelectResult("customers", [
            { id: "00", email: "a@example.com" },
            { id: "01", email: "b@example.com" },
            { id: "02", email: "c@example.com" },
        ]);
        const audience = await selectMarketingAudience();
        expect(audience.map((r) => r.id)).toEqual(["00", "01", "02"]);
    });

    it("returns the correct row shape (id + email)", async () => {
        queueSelectResult("customers", [{ id: "c-001", email: "alice@example.com" }]);
        const [first] = await selectMarketingAudience();
        expect(Object.keys(first).sort()).toEqual(["email", "id"]);
        expect(typeof first.id).toBe("string");
        expect(typeof first.email).toBe("string");
    });
});
