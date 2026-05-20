/**
 * Integration tests for `/api/admin/schedule/exceptions`
 * and `/api/admin/schedule/exceptions/[id]`.
 *
 * Covers:
 *   - Pre-flight uniqueness on POST (`exception_exists` 409 when the date
 *     already has a row).
 *   - PATCH cross-field re-merge: `endTime > startTime` checked against the
 *     merged row, plus the `missing_time` branch when toggling
 *     `isWorking=true` without supplying both times.
 *   - Time-clearing on transition to `isWorking=false`.
 *   - Range and `isWorking` filters in the list GET.
 *   - DELETE 404 path.
 */
import { afterAll, describe, expect, it } from "vitest";

import { GET as listGET, POST as createPOST } from "./route";
import { DELETE as detailDELETE, GET as detailGET, PATCH as detailPATCH } from "./[id]/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("excp");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface ExceptionRow {
    id: string;
    date: string;
    isWorking: boolean;
    startTime: string | null;
    endTime: string | null;
    reason: string | null;
}
interface ExceptionResponse {
    exception: ExceptionRow;
}
interface ListResponse {
    exceptions: ExceptionRow[];
    count: number;
    total: number;
    limit: number;
    offset: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

/**
 * Exceptions are unique by `date`, so each test must use a distinct date.
 * 2099 is far past any seed/fixture data and won't clash with anything else
 * in the DB.
 */
let dayCounter = 1;
function nextDate(): string {
    const d = String(dayCounter++).padStart(2, "0");
    return `2099-01-${d}`;
}

async function createException(overrides: Partial<Record<string, unknown>> = {}) {
    const date = nextDate();
    const res = await createPOST(
        buildRequest("/api/admin/schedule/exceptions", "POST", {
            body: {
                date,
                isWorking: false,
                reason: `${tag}-default`,
                ...overrides,
            },
        })
    );
    return { date, parsed: await readResponse<ExceptionResponse>(res) };
}

describe("POST /api/admin/schedule/exceptions", () => {
    it("creates a closed-day exception", async () => {
        const { parsed, date } = await createException();
        expect(parsed.status).toBe(201);
        expect(parsed.json.exception.date).toBe(date);
        expect(parsed.json.exception.isWorking).toBe(false);
        expect(parsed.json.exception.startTime).toBeNull();
        expect(parsed.json.exception.endTime).toBeNull();
    });

    it("creates a working-day exception with explicit times", async () => {
        const { parsed } = await createException({
            isWorking: true,
            startTime: "10:00",
            endTime: "16:00",
            reason: `${tag}-work`,
        });
        expect(parsed.status).toBe(201);
        expect(parsed.json.exception.isWorking).toBe(true);
        // Postgres `time` is returned with seconds.
        expect(parsed.json.exception.startTime).toMatch(/^10:00(:00)?$/);
        expect(parsed.json.exception.endTime).toMatch(/^16:00(:00)?$/);
    });

    it("rejects duplicate date with 409 (pre-flight branch)", async () => {
        const date = nextDate();
        const first = await createPOST(
            buildRequest("/api/admin/schedule/exceptions", "POST", {
                body: { date, isWorking: false, reason: `${tag}-first` },
            })
        );
        expect(first.status).toBe(201);

        const second = await createPOST(
            buildRequest("/api/admin/schedule/exceptions", "POST", {
                body: { date, isWorking: false, reason: `${tag}-second` },
            })
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("exception_exists");
    });

    it("rejects working exception without times (schema layer)", async () => {
        const date = nextDate();
        const res = await createPOST(
            buildRequest("/api/admin/schedule/exceptions", "POST", {
                body: { date, isWorking: true, reason: `${tag}-bad` },
            })
        );
        const body = await readResponse<ErrorBody>(res);
        // Schema-level validation: validation_error from zod.
        expect(body.status).toBe(422);
        expect(body.json.error.code).toBe("validation_error");
    });
});

describe("PATCH /api/admin/schedule/exceptions/[id]", () => {
    it("clears times when transitioning isWorking → false", async () => {
        const { parsed } = await createException({
            isWorking: true,
            startTime: "09:00",
            endTime: "17:00",
            reason: `${tag}-flip`,
        });
        const id = parsed.json.exception.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/schedule/exceptions/${id}`, "PATCH", {
                body: { isWorking: false },
            }),
            { params: Promise.resolve({ id }) }
        );
        const after = await readResponse<ExceptionResponse>(res);
        expect(after.status).toBe(200);
        expect(after.json.exception.isWorking).toBe(false);
        expect(after.json.exception.startTime).toBeNull();
        expect(after.json.exception.endTime).toBeNull();
    });

    it("rejects flipping to isWorking without supplying both times (merged-row branch)", async () => {
        const { parsed } = await createException({
            isWorking: false,
            reason: `${tag}-flipup`,
        });
        const id = parsed.json.exception.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/schedule/exceptions/${id}`, "PATCH", {
                body: { isWorking: true },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("missing_time");
    });

    it("rejects endTime <= existing startTime on partial patch", async () => {
        const { parsed } = await createException({
            isWorking: true,
            startTime: "10:00",
            endTime: "16:00",
            reason: `${tag}-cross`,
        });
        const id = parsed.json.exception.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/schedule/exceptions/${id}`, "PATCH", {
                body: { endTime: "09:00" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("end_before_start");
    });
});

describe("DELETE /api/admin/schedule/exceptions/[id]", () => {
    it("hard-deletes an existing row, then 404 on second call", async () => {
        const { parsed } = await createException();
        const id = parsed.json.exception.id;

        const first = await detailDELETE(
            buildRequest(`/api/admin/schedule/exceptions/${id}`, "DELETE"),
            { params: Promise.resolve({ id }) }
        );
        expect(first.status).toBe(200);

        const second = await detailDELETE(
            buildRequest(`/api/admin/schedule/exceptions/${id}`, "DELETE"),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(404);
    });

    it("returns 404 for non-existent UUID", async () => {
        // Syntactically-valid v4 UUID that no exception owns.
        const id = "00000000-0000-4000-8000-0000000000ff";
        const res = await detailGET(buildRequest(`/api/admin/schedule/exceptions/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(404);
    });
});

describe("GET /api/admin/schedule/exceptions — list filters", () => {
    it("filters by date range", async () => {
        // Create two exceptions on far-apart dates with our tag in `reason`.
        const a = await createException({ reason: `${tag}-rangeA` });
        const b = await createException({ reason: `${tag}-rangeB` });
        // Filter to a window containing only `a`'s date.
        const res = await listGET(
            buildRequest("/api/admin/schedule/exceptions", "GET", {
                query: { from: a.date, to: a.date, limit: 50 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.exceptions.map((e) => e.id);
        expect(ids).toContain(a.parsed.json.exception.id);
        expect(ids).not.toContain(b.parsed.json.exception.id);
    });

    it("filters by isWorking=true", async () => {
        const work = await createException({
            isWorking: true,
            startTime: "11:00",
            endTime: "12:00",
            reason: `${tag}-only-work`,
        });
        const closed = await createException({ reason: `${tag}-only-closed` });

        const res = await listGET(
            buildRequest("/api/admin/schedule/exceptions", "GET", {
                query: {
                    isWorking: "true",
                    from: work.date,
                    to: work.date,
                    limit: 50,
                },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.exceptions.map((e) => e.id);
        expect(ids).toContain(work.parsed.json.exception.id);
        expect(ids).not.toContain(closed.parsed.json.exception.id);
    });
});
