/**
 * Integration tests for newsletter admin route auth gates.
 *
 * Scope (task 11.8):
 *   Every admin newsletter route method returns 401 without an admin session.
 *
 * Requirements: 2.11
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as listGet, POST as listPost } from "@/app/api/admin/newsletters/route";
import {
    GET as idGet,
    PATCH as idPatch,
    DELETE as idDelete,
} from "@/app/api/admin/newsletters/[id]/route";
import { POST as schedulePost } from "@/app/api/admin/newsletters/[id]/schedule/route";
import { POST as sendPost } from "@/app/api/admin/newsletters/[id]/send/route";
import { POST as cancelPost } from "@/app/api/admin/newsletters/[id]/cancel/route";
import { POST as previewPost } from "@/app/api/admin/newsletters/[id]/preview/route";
import { POST as testSendPost } from "@/app/api/admin/newsletters/[id]/test-send/route";
import { buildRequest } from "@/test/integration/helpers";

const FAKE_ID = "00000000-0000-0000-0000-000000000000";
const ctx = { params: Promise.resolve({ id: FAKE_ID }) };

/**
 * Override the global requireAdmin mock to simulate an unauthenticated
 * request for this test file only.
 */
import { requireAdmin } from "@/lib/api";

describe("newsletter admin routes reject unauthenticated requests (11.8)", () => {
    // Temporarily override requireAdmin to return a 401 response
    const mockRequireAdmin = vi.mocked(requireAdmin);
    const original = mockRequireAdmin.getMockImplementation();

    beforeAll(() => {
        mockRequireAdmin.mockImplementation(async () => ({
            ctx: undefined as any,
            response: new Response(
                JSON.stringify({ error: { code: "unauthorized", message: "Unauthorized" } }),
                {
                    status: 401,
                    headers: { "content-type": "application/json" },
                }
            ),
        }));
    });

    afterAll(() => {
        if (original) {
            mockRequireAdmin.mockImplementation(original);
        } else {
            mockRequireAdmin.mockImplementation(async () => ({
                ctx: {
                    userId: "00000000-0000-0000-0000-0000000000aa",
                    customerId: undefined,
                    role: "admin" as const,
                },
                response: null,
            }));
        }
    });

    const cases: [string, () => Promise<Response>][] = [
        [
            "GET /api/admin/newsletters",
            () => listGet(buildRequest("/api/admin/newsletters", "GET")),
        ],
        [
            "POST /api/admin/newsletters",
            () => listPost(buildRequest("/api/admin/newsletters", "POST", { body: {} })),
        ],
        [
            "GET /api/admin/newsletters/:id",
            () => idGet(buildRequest(`/api/admin/newsletters/${FAKE_ID}`, "GET"), ctx),
        ],
        [
            "PATCH /api/admin/newsletters/:id",
            () =>
                idPatch(
                    buildRequest(`/api/admin/newsletters/${FAKE_ID}`, "PATCH", { body: {} }),
                    ctx
                ),
        ],
        [
            "DELETE /api/admin/newsletters/:id",
            () => idDelete(buildRequest(`/api/admin/newsletters/${FAKE_ID}`, "DELETE"), ctx),
        ],
        [
            "POST /api/admin/newsletters/:id/schedule",
            () =>
                schedulePost(
                    buildRequest(`/api/admin/newsletters/${FAKE_ID}/schedule`, "POST", {
                        body: {},
                    }),
                    ctx
                ),
        ],
        [
            "POST /api/admin/newsletters/:id/send",
            () => sendPost(buildRequest(`/api/admin/newsletters/${FAKE_ID}/send`, "POST"), ctx),
        ],
        [
            "POST /api/admin/newsletters/:id/cancel",
            () => cancelPost(buildRequest(`/api/admin/newsletters/${FAKE_ID}/cancel`, "POST"), ctx),
        ],
        [
            "POST /api/admin/newsletters/:id/preview",
            () =>
                previewPost(buildRequest(`/api/admin/newsletters/${FAKE_ID}/preview`, "POST"), ctx),
        ],
        [
            "POST /api/admin/newsletters/:id/test-send",
            () =>
                testSendPost(
                    buildRequest(`/api/admin/newsletters/${FAKE_ID}/test-send`, "POST", {
                        body: { to: "x@x.com" },
                    }),
                    ctx
                ),
        ],
    ];

    it.each(cases)("%s returns 401", async (_label, call) => {
        const res = await call();
        expect(res.status).toBe(401);
    });
});
