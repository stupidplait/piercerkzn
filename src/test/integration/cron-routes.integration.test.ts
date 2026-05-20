import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readResponse } from "@/test/integration/helpers";

vi.mock("@/lib/resend", () => ({ sendEmail: vi.fn(async () => ({ id: "msg_test" })) }));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));

import { GET as satisfactionGET } from "@/app/api/cron/satisfaction-survey/route";
import { GET as downsizeGET } from "@/app/api/cron/downsize-reminder/route";

const CRON_SECRET_VALUE = "test-cron-secret-pipeline";
let priorCronSecret: string | undefined;

beforeAll(() => {
    priorCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = CRON_SECRET_VALUE;
});

afterAll(() => {
    if (priorCronSecret === undefined) {
        delete process.env.CRON_SECRET;
    } else {
        process.env.CRON_SECRET = priorCronSecret;
    }
});

function buildCronRequest(path: string, authorization?: string): Request {
    const headers: HeadersInit = authorization ? { authorization } : {};
    return new Request(`http://test.local${path}`, { method: "GET", headers });
}

describe("/api/cron/satisfaction-survey", () => {
    it("returns 200 with valid auth and correct response shape", async () => {
        const res = await satisfactionGET(
            buildCronRequest("/api/cron/satisfaction-survey", `Bearer ${CRON_SECRET_VALUE}`)
        );
        const { status, json } = await readResponse<{
            candidates: number;
            sent: number;
            skipped: number;
            errors: number;
        }>(res);
        expect(status).toBe(200);
        expect(json).toMatchObject({
            candidates: expect.any(Number),
            sent: expect.any(Number),
            skipped: expect.any(Number),
            errors: expect.any(Number),
        });
    });

    it("returns 401 without Authorization header", async () => {
        const res = await satisfactionGET(buildCronRequest("/api/cron/satisfaction-survey"));
        expect(res.status).toBe(401);
    });

    it("returns 401 with invalid bearer token", async () => {
        const res = await satisfactionGET(
            buildCronRequest("/api/cron/satisfaction-survey", "Bearer wrong-secret")
        );
        expect(res.status).toBe(401);
    });
});

describe("/api/cron/downsize-reminder", () => {
    it("returns 200 with valid auth and correct response shape", async () => {
        const res = await downsizeGET(
            buildCronRequest("/api/cron/downsize-reminder", `Bearer ${CRON_SECRET_VALUE}`)
        );
        const { status, json } = await readResponse<{
            candidates: number;
            sent: number;
            skipped: number;
            errors: number;
        }>(res);
        expect(status).toBe(200);
        expect(json).toMatchObject({
            candidates: expect.any(Number),
            sent: expect.any(Number),
            skipped: expect.any(Number),
            errors: expect.any(Number),
        });
    });

    it("returns 401 without Authorization header", async () => {
        const res = await downsizeGET(buildCronRequest("/api/cron/downsize-reminder"));
        expect(res.status).toBe(401);
    });

    it("returns 401 with invalid bearer token", async () => {
        const res = await downsizeGET(
            buildCronRequest("/api/cron/downsize-reminder", "Bearer wrong-secret")
        );
        expect(res.status).toBe(401);
    });
});
