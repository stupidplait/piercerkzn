/**
 * Human-readable reference numbers for reservations / appointments / inquiries.
 *
 * Format: `PK-{KIND}-{YEAR}-{NNNN}`  e.g. `PK-RES-2026-0042`
 *
 * The trailing number is *per-kind, per-year, sequential*. Allocation uses
 * `MAX(suffix) + 1` against the per-year partition's existing rows, which
 * by definition produces a value not yet present in the unique index. The
 * surrounding INSERT is wrapped in a defensive SQLSTATE 23505 retry loop
 * (`MAX_RETRIES`) so that — should the connection pool ever widen beyond
 * `max: 1`, or a sibling code path insert directly into the table without
 * going through this helper, or a test harness pre-seed rows — the
 * allocator self-heals by re-reading MAX and retrying.
 *
 * For higher write rates we'd swap to a Postgres sequence per kind.
 */
import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db, type DB } from "@/db";

export type RefKind = "RES" | "APT" | "INQ" | "WV";

interface CountableTable {
    table: PgTable;
    referenceColumn: PgColumn;
    createdAtColumn: PgColumn;
}

/**
 * Allocator config — extends `CountableTable` with the unique constraint
 * name so the SQLSTATE 23505 retry can distinguish "our race" from another
 * unique constraint elsewhere on the same table (e.g. `customer_email_unique`).
 */
export interface AllocatableTable extends CountableTable {
    uniqueConstraintName: string;
}

const MAX_RETRIES = 5;

/**
 * Thrown when the allocator's defensive retry budget is exhausted.
 * Never observed in production under the current `max: 1` connection
 * pool — present as defence-in-depth for pool widening or test seeding.
 */
export class ReferenceAllocationError extends Error {
    readonly code = "ref_allocation_failed" as const;
    readonly kind: RefKind;
    readonly attempts: number;
    constructor(kind: RefKind, attempts: number) {
        super(`Failed to allocate reference number for kind=${kind} after ${attempts} retries`);
        this.name = "ReferenceAllocationError";
        this.kind = kind;
        this.attempts = attempts;
    }
}

/** Format suffix as `PK-{KIND}-{YEAR}-{NNNN}`. */
function formatReferenceNumber(kind: RefKind, year: number, suffix: number): string {
    return `PK-${kind}-${year}-${suffix.toString().padStart(4, "0")}`;
}

/**
 * Compute the next free suffix as `MAX(existing) + 1`. Replaces the
 * race-prone `COUNT(*) + 1` strategy: MAX always points to a never-used
 * value because it observes the actual largest suffix in the partition.
 */
async function nextSuffixFromMax(cfg: CountableTable, runner: DB, year: number): Promise<number> {
    const filter: SQL = sql`extract(year from ${cfg.createdAtColumn}) = ${year}`;
    const result = await runner.execute<{ next: number }>(
        sql`select coalesce(max(cast(substring(${cfg.referenceColumn} from '[0-9]{4}$') as integer)), 0) + 1 as next from ${cfg.table} where ${filter}`
    );
    const row = Array.isArray(result)
        ? result[0]
        : (result as unknown as { rows?: { next: number }[] }).rows?.[0];
    return Number(row?.next ?? 1);
}

/**
 * Detect a Postgres unique-violation against `expectedConstraint`.
 * `postgres-js` surfaces these as `code === "23505"` with the constraint
 * name in `constraint_name` (sometimes `constraint`); the `pg` driver uses
 * similar fields. Drizzle wraps the original error so we walk the `cause`
 * chain too.
 */
function isOurUniqueViolation(error: unknown, expectedConstraint: string): boolean {
    if (typeof error !== "object" || error === null) return false;
    const candidates: unknown[] = [];
    let cur: unknown = error;
    for (let i = 0; i < 5 && cur; i++) {
        candidates.push(cur);
        cur =
            typeof cur === "object" && cur !== null && "cause" in cur
                ? (cur as { cause?: unknown }).cause
                : undefined;
    }
    for (const c of candidates) {
        if (typeof c !== "object" || c === null) continue;
        const code = (c as { code?: unknown }).code;
        const cname =
            ((c as { constraint_name?: unknown }).constraint_name as string | undefined) ??
            ((c as { constraint?: unknown }).constraint as string | undefined);
        if (code === "23505" && cname === expectedConstraint) return true;
    }
    return false;
}

/**
 * Allocate a unique `PK-{KIND}-{YEAR}-{NNNN}` reference and INSERT a row
 * using it, atomically with retry on SQLSTATE 23505.
 *
 * The caller supplies a `valuesFn` that builds the row given the allocated
 * reference number. The helper picks the suffix via `MAX(suffix) + 1`,
 * formats it, and runs `runner.insert(cfg.table).values(valuesFn(reference))
 * .returning()`. On the rare event of a 23505 against
 * `cfg.uniqueConstraintName`, it bumps the suffix and retries up to
 * `MAX_RETRIES` times before throwing `ReferenceAllocationError`.
 *
 * Each attempt runs inside a nested `runner.transaction(...)` so that a
 * 23505 (which would otherwise abort the *enclosing* transaction with
 * SQLSTATE 25P02) is contained to a SAVEPOINT and can be retried within
 * the same parent transaction. When `runner` is `db` (no surrounding
 * transaction), the nested `transaction` is a top-level Drizzle
 * transaction; either way the retry stays correct.
 */
export async function allocateAndInsert<TRow>(
    kind: RefKind,
    cfg: AllocatableTable,
    runner: DB,
    valuesFn: (referenceNumber: string) => Record<string, unknown>
): Promise<{ row: TRow; referenceNumber: string }> {
    const year = new Date().getUTCFullYear();
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const result = await runner.transaction(async (sp) => {
                const baseSuffix = await nextSuffixFromMax(cfg, sp as unknown as DB, year);
                const suffix = baseSuffix + attempt;
                const referenceNumber = formatReferenceNumber(kind, year, suffix);
                const inserted = await sp
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .insert(cfg.table as any)
                    .values(valuesFn(referenceNumber))
                    .returning();
                const row = Array.isArray(inserted) ? inserted[0] : inserted;
                return { row: row as TRow, referenceNumber };
            });
            return result;
        } catch (err) {
            if (isOurUniqueViolation(err, cfg.uniqueConstraintName)) {
                lastError = err;
                continue;
            }
            throw err;
        }
    }
    // Surface the last unique-violation cause for downstream debugging.
    const failure = new ReferenceAllocationError(kind, MAX_RETRIES);
    if (lastError !== undefined) {
        (failure as { cause?: unknown }).cause = lastError;
    }
    throw failure;
}

/**
 * Generate a unique reference using `MAX(suffix) + 1`.
 *
 * @deprecated Use {@link allocateAndInsert} for new code. This function does
 * NOT INSERT — callers must follow up with their own INSERT, which means
 * there is no transactional guarantee that the returned value will still
 * be unique by the time the INSERT runs. Existing call sites are migrated
 * to `allocateAndInsert` in a separate task.
 */
export async function nextReferenceNumber(
    kind: RefKind,
    cfg: CountableTable,
    runner: DB = db
): Promise<string> {
    const year = new Date().getUTCFullYear();
    const suffix = await nextSuffixFromMax(cfg, runner, year);
    return formatReferenceNumber(kind, year, suffix);
}
