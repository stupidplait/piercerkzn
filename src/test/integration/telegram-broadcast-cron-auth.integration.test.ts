/**
 * Integration test: cron route auth gate.
 *
 * Cron route without `Authorization: Bearer ${CRON_SECRET}` returns 401;
 * with the wrong bearer returns 401; with the correct bearer returns 200.
 *
 * Validates: Requirements 6.1
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { readResponse } from "@/test/integration/helpers";
import { GET } from "@/app/api/cron/telegram-broadcast-sweep/route";

// Mock the dispatch module so sweepDueBroadcasts doesn't hit the DB
vi.mock("@/lib/telegram-broadcasts/dispatch", () => ({
    sweepDueBroadcasts: vi.fn(async () => ({
        promoted: 0,
        recovered: 0,
        recoveredJobs: 0,
        errors: 0,
    })),
}));

const CRON_SECRET = "test-cron-secret-12345";

beforeAll(() => {
    process.env.CRON_SECRET = CRON_SECRET;
});

afterAll(() => {
    delete process.env.CRON_SECRET;
});

describe("GET /api/cron/telegram-broadcast-sweep — auth gate", () => {
    it("returns 401 without Authorization header", async () => {
        const req = new Request("http://test.local/api/cron/telegram-broadcast-sweep");
        const res = await GET(req);
        const { status } = await readResponse(res);
        expect(status).toBe(401);
    });

    it("returns 401 with wrong bearer token", async () => {
        const req = new Request("http://test.local/api/cron/telegram-broadcast-sweep", {
            headers: { authorization: "Bearer wrong-secret" },
        });
        const res = await GET(req);
        const { status } = await readResponse(res);
        expect(status).toBe(401);
    });

    it("returns 200 with correct bearer token", async () => {
        const req = new Request("http://test.local/api/cron/telegram-broadcast-sweep", {
            headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        const res = await GET(req);
        const { status, json } = await readResponse<{ promoted: number }>(res);
        expect(status).toBe(200);
        expect(json).toMatchObject({ promoted: 0, recovered: 0 });
    });
});
