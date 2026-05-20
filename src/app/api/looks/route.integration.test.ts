/**
 * Integration tests for `GET /api/looks` — the public, paginated curated-
 * looks gallery. Imports the route handler directly and calls it with
 * synthetic `Request` objects (no HTTP server), per the established
 * convention under `src/app/api/admin/**\/*.integration.test.ts` and the
 * sibling `products/route.integration.test.ts` (Phase 3, task 3.1).
 *
 * Scope (Phase 3, task 3.7):
 *   1. Happy path                — seed 2 published tagged looks across
 *                                  rare body areas the dev seed never
 *                                  inserts, GET the gallery, expect 200 +
 *                                  both seeded handles present (Req 3.1
 *                                  / 3.2).
 *   2. Filter by bodyArea        — seed 1 published look in each of two
 *                                  rare areas, filter by one, assert only
 *                                  the matching tagged handle comes back
 *                                  (Req 3.2).
 *   3. Unpublished excluded      — seed an *unpublished* tagged look in
 *                                  a rare area; GET filtered to that area
 *                                  and assert the response is empty (the
 *                                  route hard-filters `is_published = true`
 *                                  per `route.ts`) (Req 3.2).
 *   4. Invalid bodyArea          — request `bodyArea=Has-Caps` (uppercase +
 *                                  dash → fails the lowercase-snake regex
 *                                  on `listLooksQuerySchema.bodyArea`),
 *                                  assert 422 + `error.code: "validation_error"`
 *                                  (Req 3.4 / 3.5).
 *   5. afterAll cleanup          — `cleanupTaggedRows(tag)` already covers
 *                                  `curated_look` (by `handle LIKE %tag%`)
 *                                  and `body_model` (by `name LIKE %tag%`).
 *                                  Cleanup ordering deletes looks before
 *                                  body models so the FK from
 *                                  `curated_look.body_model_id` releases
 *                                  before the model row goes away.
 *
 * 400 → 422 deviation note:
 *   The brief lists "422 / `validation_error`". `parseQuery()` in
 *   `@/lib/api.ts` funnels Zod failures through `validationFailed()`,
 *   which always emits HTTP 422. I assert 422 exactly (matches the SUT).
 *
 * Rare body areas (`look_test_alpha`, `look_test_beta`):
 *   The dev seed at `src/db/seed.ts` only ever inserts `bodyArea: "face"`
 *   for curated looks. Picking areas neither the dev seed nor any other
 *   test file uses lets the filter and unpublished-excluded tests assert
 *   exact-equality on the result set (no contamination from preexisting
 *   rows in the dev DB). Both names match the strict
 *   `/^[a-z_]+$/u` regex enforced by `listLooksQuerySchema.bodyArea`
 *   (lowercase letters + underscore only — no digits, no dashes).
 *
 * Mock surface
 * ---------------------------------------------------------------------------
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide. The public looks route uses `parseQuery` +
 *   `ok` + `internal` from `@/lib/api`; `setup.ts`'s `vi.importActual`
 *   preserves those so validation behaviour is real. No file-local
 *   `vi.mock` calls are required.
 */
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "./route";
import { bodyModels, curatedLooks, db } from "@/db";
import {
    buildRequest,
    cleanupTaggedRows,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/**
 * "Rare" body areas: match the strict `/^[a-z_]+$/u` regex enforced on
 * `listLooksQuerySchema.bodyArea` (lowercase letters + underscore only —
 * no digits, no dashes), but are never inserted by `src/db/seed.ts`
 * (which uses only `face`). Picking areas neither the dev seed nor any
 * other test file touches lets the filter / unpublished-exclusion tests
 * assert exact equality on the tagged-handle result set instead of
 * subset containment.
 */
const RARE_AREA_A = "look_test_alpha";
const RARE_AREA_B = "look_test_beta";

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-looks");

interface LookCard {
    id: string;
    handle: string;
    title: string;
    bodyArea: string;
    bodyModelId: string;
    bundlePrice: number;
    totalIndividualPrice: number;
    pieceCount: number;
}

interface ListResponse {
    looks: LookCard[];
    count: number;
    total: number;
    limit: number;
    offset: number;
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Per-suite seeding helpers
// ---------------------------------------------------------------------------

/**
 * Row-count snapshot bookkeeping (per design §"Phase 3" → AC 3.8 / 2.12
 * pattern carried over from the products route file). The two tables
 * below are the entire surface this file's seeding touches:
 *
 *   - body_model    — one shared tagged row created in `beforeAll`
 *   - curated_look  — one inserted per `seedTaggedLook` call
 *
 * `cleanupTaggedRows(tag)` deletes looks first (by `handle LIKE %tag%`)
 * then body models (by `name LIKE %tag%`), so the FK from
 * `curated_look.body_model_id` releases before the parent body model row
 * is removed. A clean run lands the counts back at their pre-test values.
 */
type RowCounts = Record<string, number>;

async function snapshotRowCounts(): Promise<RowCounts> {
    const [[bodyModelCount], [curatedLookCount]] = await Promise.all([
        db.select({ n: count() }).from(bodyModels),
        db.select({ n: count() }).from(curatedLooks),
    ]);
    return {
        body_model: bodyModelCount.n,
        curated_look: curatedLookCount.n,
    };
}

/**
 * Insert one tagged body model. The `cameraDefaults` JSONB is not-null
 * per the schema, so we provide a minimal but valid payload. Cleanup runs
 * through `cleanupTaggedRows(tag)` which deletes `body_model` rows by
 * `name LIKE %tag%`.
 */
async function seedTaggedBodyModel(): Promise<{ id: string }> {
    const [created] = await db
        .insert(bodyModels)
        .values({
            name: `${tag}-model`,
            area: "face",
            modelUrl: "https://cdn.test.local/x.glb",
            cameraDefaults: { position: [0, 1.6, 0.5], target: [0, 1.6, 0], fov: 45 },
            isActive: true,
        })
        .returning({ id: bodyModels.id });
    return created;
}

/**
 * Insert one tagged curated look. Keeps the seed direct (Drizzle-only,
 * no SUT) so the test controls every column the route filters on
 * (`is_published`, `body_area`). Cleanup runs through `cleanupTaggedRows
 * (tag)` which matches `curated_look.handle LIKE %tag%`.
 */
async function seedTaggedLook(
    suffix: string,
    opts: {
        bodyModelId: string;
        bodyArea: string;
        isPublished: boolean;
    }
): Promise<{ id: string; handle: string }> {
    const handle = `${tag}-${suffix}`;
    const [created] = await db
        .insert(curatedLooks)
        .values({
            handle,
            title: `Тест ${handle}`,
            bodyModelId: opts.bodyModelId,
            bodyArea: opts.bodyArea,
            totalIndividualPrice: 300_00,
            bundlePrice: 250_00,
            discountPercent: "16.7",
            isPublished: opts.isPublished,
            sortOrder: 1,
        })
        .returning({ id: curatedLooks.id, handle: curatedLooks.handle });
    return created;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /api/looks integration", () => {
    /**
     * Seeded once for the whole suite:
     *   - 1 body model (FK target for every look)
     *   - 2 published looks in `RARE_AREA_A`: a1 / a2
     *   - 1 published look in `RARE_AREA_B`: b1
     *   - 1 unpublished look in `RARE_AREA_A`: aDraft
     *
     * The split lets one fixture set drive the happy path (3 published in
     * total), the bodyArea filter (2 vs 1), and the unpublished-exclusion
     * test (`aDraft` must not appear in any GET response).
     *
     * The dev seed at `src/db/seed.ts` only inserts `bodyArea: "face"`,
     * so `RARE_AREA_A` / `RARE_AREA_B` are exclusively this suite's rows
     * — `bodyArea=…` filters can be asserted with strict equality on
     * handles instead of subset containment.
     */
    let handleA1 = "";
    let handleA2 = "";
    let handleB1 = "";
    let handleADraft = "";
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        // Snapshot row counts BEFORE seeding so `afterAll` observes the
        // pre-test state — `cleanupTaggedRows(tag)` should restore exactly
        // this baseline (Req 3.8 row-count parity).
        snapshotBefore = await snapshotRowCounts();

        const model = await seedTaggedBodyModel();
        const a1 = await seedTaggedLook("a1", {
            bodyModelId: model.id,
            bodyArea: RARE_AREA_A,
            isPublished: true,
        });
        const a2 = await seedTaggedLook("a2", {
            bodyModelId: model.id,
            bodyArea: RARE_AREA_A,
            isPublished: true,
        });
        const b1 = await seedTaggedLook("b1", {
            bodyModelId: model.id,
            bodyArea: RARE_AREA_B,
            isPublished: true,
        });
        const aDraft = await seedTaggedLook("aDraft", {
            bodyModelId: model.id,
            bodyArea: RARE_AREA_A,
            isPublished: false,
        });
        handleA1 = a1.handle;
        handleA2 = a2.handle;
        handleB1 = b1.handle;
        handleADraft = aDraft.handle;
    });

    afterAll(async () => {
        // Idempotent — `cleanupTaggedRows(tag)` deletes looks by
        // `handle LIKE %tag%` BEFORE deleting body models by
        // `name LIKE %tag%`, so the FK release order is correct even
        // without ON DELETE CASCADE on `curated_look.body_model_id`.
        await cleanupTaggedRows(tag);
        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // Happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // The dev DB carries an existing published curated look
    // ("minimal-titanium" in `bodyArea: "face"`), so we can't assert an
    // exact handle-set equality on the unfiltered gallery. Instead we
    // assert HTTP 200 + the response shape + that the published seeded
    // handles (a1, a2, b1) are present in the paged window. limit=100
    // covers the dev seed plus our 4 rows.
    it("returns 200 with a looks array and includes published seeded handles (Req 3.1)", async () => {
        const res = await GET(buildRequest("/api/looks", "GET", { query: { limit: 100 } }));
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(Array.isArray(json.looks)).toBe(true);
        expect(json.limit).toBe(100);
        expect(json.offset).toBe(0);
        expect(json.count).toBe(json.looks.length);

        const handles = new Set(json.looks.map((l) => l.handle));
        expect(handles.has(handleA1)).toBe(true);
        expect(handles.has(handleA2)).toBe(true);
        expect(handles.has(handleB1)).toBe(true);
        // Draft must never appear in the public gallery.
        expect(handles.has(handleADraft)).toBe(false);
    });

    // -------------------------------------------------------------------
    // Filter by bodyArea (Req 3.2)
    // -------------------------------------------------------------------
    //
    // `bodyArea=look_test_beta` narrows the gallery to rows the dev seed
    // never inserts AND that are published, so the tagged `b1` handle is
    // the only legitimate result. Strict equality on the handle set.
    it("filters by bodyArea — only tagged published rows in that area come back (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/looks", "GET", {
                query: { bodyArea: RARE_AREA_B, limit: 100 },
            })
        );
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(json.looks.every((l) => l.bodyArea === RARE_AREA_B)).toBe(true);
        const handles = json.looks.map((l) => l.handle).sort();
        expect(handles).toEqual([handleB1].sort());
        expect(json.total).toBe(1);
    });

    // -------------------------------------------------------------------
    // Unpublished excluded (Req 3.2)
    // -------------------------------------------------------------------
    //
    // The route hard-filters `eq(curatedLooks.isPublished, true)`. Filter
    // by `RARE_AREA_A` (no dev-seed contamination): only the two
    // published tagged handles (a1, a2) come back; the unpublished
    // `aDraft` (also in `RARE_AREA_A`) MUST be absent. Strict equality
    // on the handle set + total count proves the exclusion.
    it("excludes unpublished looks from the gallery (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/looks", "GET", {
                query: { bodyArea: RARE_AREA_A, limit: 100 },
            })
        );
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(json.looks.every((l) => l.bodyArea === RARE_AREA_A)).toBe(true);
        const handles = json.looks.map((l) => l.handle).sort();
        expect(handles).toEqual([handleA1, handleA2].sort());
        expect(handles).not.toContain(handleADraft);
        expect(json.total).toBe(2);
    });

    // -------------------------------------------------------------------
    // Invalid bodyArea filter (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // `listLooksQuerySchema.bodyArea` is constrained to `/^[a-z_]+$/u`
    // (lowercase letters + underscore only). `Has-Caps` contains an
    // uppercase letter and a dash, both of which are rejected. The
    // ZodError funnels through `parseQuery` → `validationFailed()` →
    // HTTP 422 + `error.code: "validation_error"` (the lowercase
    // `ErrorCode.Validation` constant from `@/lib/api`).
    it("rejects bodyArea=Has-Caps with 422 + validation_error (Req 3.4, 3.5)", async () => {
        const res = await GET(
            buildRequest("/api/looks", "GET", {
                query: { bodyArea: "Has-Caps" },
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });
});
