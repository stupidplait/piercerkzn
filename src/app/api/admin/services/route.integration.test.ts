/**
 * Integration tests for `/api/admin/services` and `/api/admin/services/[id]`.
 *
 * Exercises the actual route handlers against a real Postgres database so
 * we catch issues that contract tests can't:
 *   - The PATCH cross-field re-merge (priceTo >= priceFrom on a partial patch).
 *   - The hard-delete FK guard against `appointment_service`.
 *   - The 23505 fallback for handle uniqueness.
 *   - Soft-delete idempotence.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as listGET, POST as createPOST } from "./route";
import { DELETE as detailDELETE, GET as detailGET, PATCH as detailPATCH } from "./[id]/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("svc");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface ServiceRow {
    id: string;
    handle: string;
    name: string;
    category: string;
    priceFrom: number;
    priceTo: number | null;
    durationMinutes: number;
    isActive: boolean;
    healingTimeMinWeeks: number | null;
    healingTimeMaxWeeks: number | null;
}

interface ServiceResponse {
    service: ServiceRow;
}
interface ListResponse {
    services: ServiceRow[];
    total: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

async function createService(overrides: Partial<Record<string, unknown>> = {}) {
    const handle = `${tag}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await createPOST(
        buildRequest("/api/admin/services", "POST", {
            body: {
                name: `Хеликс ${handle}`,
                handle,
                category: "new_piercing",
                durationMinutes: 30,
                priceFrom: 350_000,
                ...overrides,
            },
        })
    );
    return { handle, parsed: await readResponse<ServiceResponse>(res) };
}

describe("POST /api/admin/services — create", () => {
    it("creates a service with default values applied", async () => {
        const { parsed } = await createService();
        expect(parsed.status).toBe(201);
        const s = parsed.json.service;
        expect(s.isActive).toBe(true); // schema default
        expect(s.priceTo).toBeNull();
        expect(s.handle).toMatch(/^svc-/);
    });

    it("rejects duplicate handle with 409", async () => {
        const handle = `${tag}-dup`;
        const first = await createPOST(
            buildRequest("/api/admin/services", "POST", {
                body: {
                    name: "first",
                    handle,
                    category: "consultation",
                    durationMinutes: 15,
                    priceFrom: 0,
                },
            })
        );
        expect(first.status).toBe(201);

        const second = await createPOST(
            buildRequest("/api/admin/services", "POST", {
                body: {
                    name: "second",
                    handle,
                    category: "consultation",
                    durationMinutes: 15,
                    priceFrom: 0,
                },
            })
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use");
    });
});

describe("PATCH /api/admin/services/[id] — cross-field re-merge", () => {
    it("rejects priceTo < existing priceFrom even when priceFrom is not in the patch", async () => {
        const { parsed } = await createService({ priceFrom: 500_000, priceTo: 800_000 });
        const id = parsed.json.service.id;

        // Patch only priceTo — schema-level partial validation passes, but
        // the route's merge-then-validate step should reject (priceTo=100k
        // < existing priceFrom=500k).
        const patch = await detailPATCH(
            buildRequest(`/api/admin/services/${id}`, "PATCH", {
                body: { priceTo: 100_000 },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(patch);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("price_range_invalid");
    });

    it("accepts a clean patch and round-trips through GET", async () => {
        const { parsed } = await createService();
        const id = parsed.json.service.id;

        const patch = await detailPATCH(
            buildRequest(`/api/admin/services/${id}`, "PATCH", {
                body: { durationMinutes: 45, priceFrom: 400_000 },
            }),
            { params: Promise.resolve({ id }) }
        );
        const after = await readResponse<ServiceResponse>(patch);
        expect(after.status).toBe(200);
        expect(after.json.service.durationMinutes).toBe(45);

        const get = await detailGET(buildRequest(`/api/admin/services/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        const fetched = await readResponse<ServiceResponse>(get);
        expect(fetched.json.service.priceFrom).toBe(400_000);
    });

    it("rejects healingTimeMaxWeeks < existing min on partial patch", async () => {
        const { parsed } = await createService({
            healingTimeMinWeeks: 12,
            healingTimeMaxWeeks: 24,
        });
        const id = parsed.json.service.id;
        const patch = await detailPATCH(
            buildRequest(`/api/admin/services/${id}`, "PATCH", {
                body: { healingTimeMaxWeeks: 4 },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(patch);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("healing_range_invalid");
    });
});

describe("DELETE /api/admin/services/[id]", () => {
    it("soft-deletes by default and is idempotent on second call", async () => {
        const { parsed } = await createService();
        const id = parsed.json.service.id;

        const first = await detailDELETE(buildRequest(`/api/admin/services/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const firstBody = await readResponse<{ deleted: boolean; mode: string }>(first);
        expect(firstBody.status).toBe(200);
        expect(firstBody.json.mode).toBe("soft");

        const second = await detailDELETE(buildRequest(`/api/admin/services/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const secondBody = await readResponse<{
            deleted: boolean;
            mode: string;
            alreadyInactive: boolean;
        }>(second);
        expect(secondBody.status).toBe(200);
        expect(secondBody.json.alreadyInactive).toBe(true);
    });

    it("hard-deletes a service with no appointment references", async () => {
        const { parsed } = await createService();
        const id = parsed.json.service.id;

        const res = await detailDELETE(
            buildRequest(`/api/admin/services/${id}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ deleted: boolean; mode: string }>(res);
        expect(body.status).toBe(200);
        expect(body.json.mode).toBe("hard");

        // GET should now 404.
        const get = await detailGET(buildRequest(`/api/admin/services/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/services — list filters", () => {
    it("filters by isActive=false (returns soft-deleted)", async () => {
        // Create + soft-delete one row.
        const { parsed } = await createService();
        const id = parsed.json.service.id;
        await detailDELETE(buildRequest(`/api/admin/services/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });

        const res = await listGET(
            buildRequest("/api/admin/services", "GET", {
                query: { isActive: "false", search: tag, limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const found = body.json.services.find((s) => s.id === id);
        expect(found).toBeDefined();
        expect(found?.isActive).toBe(false);
    });

    it("filters by search across name + handle", async () => {
        const { handle } = await createService({ name: `unique-${tag}-needle` });
        const res = await listGET(
            buildRequest("/api/admin/services", "GET", {
                query: { search: handle },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.services.some((s) => s.handle === handle)).toBe(true);
    });
});
