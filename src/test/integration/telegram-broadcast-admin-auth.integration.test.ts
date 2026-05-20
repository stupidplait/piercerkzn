/**
 * Integration test: admin route auth gate.
 *
 * Iterate over the admin route files and assert each returns 401 without
 * an admin session.
 *
 * Validates: Requirements 2.1–2.10
 */
import { describe, expect, it, vi } from "vitest";

import { readResponse } from "@/test/integration/helpers";

// Override the setup.ts mock: make requireAdmin reject
vi.mock("@/lib/api", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    return {
        ...actual,
        requireAdmin: vi.fn(async () => ({
            ctx: null,
            response: actual.unauthorized(),
        })),
        applyRateLimit: vi.fn(async () => null),
    };
});

import { GET as listGet, POST as listPost } from "@/app/api/admin/tg-broadcasts/route";
import {
    GET as idGet,
    PATCH as idPatch,
    DELETE as idDelete,
} from "@/app/api/admin/tg-broadcasts/[id]/route";
import { POST as schedulePost } from "@/app/api/admin/tg-broadcasts/[id]/schedule/route";
import { POST as sendPost } from "@/app/api/admin/tg-broadcasts/[id]/send/route";
import { POST as cancelPost } from "@/app/api/admin/tg-broadcasts/[id]/cancel/route";
import { GET as previewGet } from "@/app/api/admin/tg-broadcasts/[id]/preview/route";
import { POST as testSendPost } from "@/app/api/admin/tg-broadcasts/[id]/test-send/route";

const FAKE_ID = "00000000-0000-0000-0000-000000000000";
function makeCtx(id: string) {
    return { params: Promise.resolve({ id }) };
}

describe("admin tg-broadcast routes — 401 without admin session", () => {
    it("GET /api/admin/tg-broadcasts → 401", async () => {
        const req = new Request("http://test.local/api/admin/tg-broadcasts");
        const { status } = await readResponse(await listGet(req));
        expect(status).toBe(401);
    });

    it("POST /api/admin/tg-broadcasts → 401", async () => {
        const req = new Request("http://test.local/api/admin/tg-broadcasts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "x", bodyText: "y" }),
        });
        const { status } = await readResponse(await listPost(req));
        expect(status).toBe(401);
    });

    it("GET /api/admin/tg-broadcasts/:id → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}`);
        const { status } = await readResponse(await idGet(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("PATCH /api/admin/tg-broadcasts/:id → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "x" }),
        });
        const { status } = await readResponse(await idPatch(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("DELETE /api/admin/tg-broadcasts/:id → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}`, {
            method: "DELETE",
        });
        const { status } = await readResponse(await idDelete(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("POST /api/admin/tg-broadcasts/:id/schedule → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}/schedule`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scheduledAt: new Date(Date.now() + 600_000).toISOString() }),
        });
        const { status } = await readResponse(await schedulePost(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("POST /api/admin/tg-broadcasts/:id/send → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}/send`, {
            method: "POST",
        });
        const { status } = await readResponse(await sendPost(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("POST /api/admin/tg-broadcasts/:id/cancel → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}/cancel`, {
            method: "POST",
        });
        const { status } = await readResponse(await cancelPost(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("GET /api/admin/tg-broadcasts/:id/preview → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}/preview`);
        const { status } = await readResponse(await previewGet(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });

    it("POST /api/admin/tg-broadcasts/:id/test-send → 401", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${FAKE_ID}/test-send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ telegramId: 12345 }),
        });
        const { status } = await readResponse(await testSendPost(req, makeCtx(FAKE_ID)));
        expect(status).toBe(401);
    });
});
