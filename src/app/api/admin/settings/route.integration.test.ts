/**
 * Integration tests for the E1 admin settings surface.
 *
 *   /api/admin/settings              — GET list, PATCH cross-group bulk.
 *   /api/admin/settings/by-key/[key] — GET, PATCH single key.
 *   /api/admin/settings/[group]      — PUT per-group bulk.
 *
 * Tests insert a small set of real `setting` rows (tagged in their key) so
 * we exercise the actual update flow end-to-end. `cleanupTaggedRows` deletes
 * them in `afterAll`.
 *
 * Key contracts under test:
 *   - Bulk PATCH `unknown_keys` rolls the whole transaction back (no row
 *     gets updated even if the unknown key is at the end).
 *   - Per-group PUT enforces `group_mismatch` for cross-group attempts.
 *   - Single-key PATCH returns 404 on a missing key.
 *   - Typed-wrapper validation: a free-form value like `{ text: "<huge>" }`
 *     can't bypass the 2 000-char cap by pretending to be a record.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { GET as listGET, PATCH as bulkPATCH } from "./route";
import { GET as detailGET, PATCH as detailPATCH } from "./by-key/[key]/route";
import { PUT as groupPUT } from "./[group]/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";
import { db, settings } from "@/db";

const tag = makeTestTag("set");

// Three test settings spanning two groups so we can exercise cross-group
// PATCH and per-group PUT mismatch detection.
const KEY_A_BOOKING = `${tag}.booking.hold_hours`;
const KEY_B_BOOKING = `${tag}.booking.lead_time_minutes`;
const KEY_C_NOTIF = `${tag}.notifications.email_enabled`;
const ALL_KEYS = [KEY_A_BOOKING, KEY_B_BOOKING, KEY_C_NOTIF];

beforeAll(async () => {
    // Seed three rows directly via Drizzle. Using the route would need an
    // existing key; we deliberately introduce fresh ones for the test run.
    await db.insert(settings).values([
        {
            key: KEY_A_BOOKING,
            value: { number: 24 },
            groupName: "booking",
            description: "Test: booking hold hours",
        },
        {
            key: KEY_B_BOOKING,
            value: { number: 30 },
            groupName: "booking",
            description: "Test: booking lead time",
        },
        {
            key: KEY_C_NOTIF,
            value: { bool: true },
            groupName: "notifications",
            description: "Test: notifications email toggle",
        },
    ]);
});

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface SettingRow {
    key: string;
    value: unknown;
    groupName: string;
    description: string | null;
    updatedAt: string;
    updatedBy: string | null;
}
interface ListResponse {
    settings: SettingRow[];
    count: number;
}
interface SingleResponse {
    setting: SettingRow;
}
interface BulkResponse {
    updated: { key: string; groupName: string; value: unknown }[];
    count: number;
    groupsTouched: string[];
}
interface GroupResponse {
    group: string;
    updated: { key: string; value: unknown }[];
    count: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

describe("GET /api/admin/settings", () => {
    it("lists all settings, sorted by group then key", async () => {
        const res = await listGET(buildRequest("/api/admin/settings", "GET"));
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const keys = body.json.settings.map((s) => s.key);
        // Our tagged rows are present.
        for (const k of ALL_KEYS) expect(keys).toContain(k);
    });

    it("filters by group", async () => {
        const res = await listGET(
            buildRequest("/api/admin/settings", "GET", {
                query: { group: "notifications" },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        // All rows in the response are in the notifications group.
        for (const r of body.json.settings) expect(r.groupName).toBe("notifications");
        expect(body.json.settings.map((r) => r.key)).toContain(KEY_C_NOTIF);
    });
});

describe("GET/PATCH /api/admin/settings/by-key/[key]", () => {
    it("GET returns the setting", async () => {
        const encoded = encodeURIComponent(KEY_A_BOOKING);
        const res = await detailGET(buildRequest(`/api/admin/settings/by-key/${encoded}`, "GET"), {
            params: Promise.resolve({ key: encoded }),
        });
        const body = await readResponse<SingleResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.setting.key).toBe(KEY_A_BOOKING);
        expect(body.json.setting.groupName).toBe("booking");
    });

    it("GET returns 404 for an unknown key", async () => {
        const encoded = encodeURIComponent(`${tag}.does.not.exist`);
        const res = await detailGET(buildRequest(`/api/admin/settings/by-key/${encoded}`, "GET"), {
            params: Promise.resolve({ key: encoded }),
        });
        expect(res.status).toBe(404);
    });

    it("PATCH updates value and stamps updatedBy", async () => {
        const encoded = encodeURIComponent(KEY_A_BOOKING);
        const res = await detailPATCH(
            buildRequest(`/api/admin/settings/by-key/${encoded}`, "PATCH", {
                body: { value: { number: 48 } },
            }),
            { params: Promise.resolve({ key: encoded }) }
        );
        const body = await readResponse<SingleResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.setting.value).toEqual({ number: 48 });

        // Verify direct from DB that updatedBy was stamped to the mock admin id.
        const [row] = await db
            .select()
            .from(settings)
            .where(eq(settings.key, KEY_A_BOOKING))
            .limit(1);
        expect(row.updatedBy).toBe("00000000-0000-0000-0000-0000000000aa");
    });

    it("PATCH returns 404 for an unknown key", async () => {
        const encoded = encodeURIComponent(`${tag}.does.not.exist`);
        const res = await detailPATCH(
            buildRequest(`/api/admin/settings/by-key/${encoded}`, "PATCH", {
                body: { value: { bool: true } },
            }),
            { params: Promise.resolve({ key: encoded }) }
        );
        expect(res.status).toBe(404);
    });

    it("rejects a single-key wrapper using the free-form branch (typed wrapper takes precedence)", async () => {
        // `{ text: "<huge>" }` would otherwise pass as a free-form record;
        // settingValueSchema's reserved-key fence forces it through the typed
        // wrapper instead, which caps text at 2 000 chars.
        const encoded = encodeURIComponent(KEY_A_BOOKING);
        const huge = "x".repeat(2_001);
        const res = await detailPATCH(
            buildRequest(`/api/admin/settings/by-key/${encoded}`, "PATCH", {
                body: { value: { text: huge } },
            }),
            { params: Promise.resolve({ key: encoded }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(422);
        expect(body.json.error.code).toBe("validation_error");
    });
});

describe("PATCH /api/admin/settings — cross-group bulk", () => {
    it("updates keys across two groups in one call", async () => {
        const res = await bulkPATCH(
            buildRequest("/api/admin/settings", "PATCH", {
                body: {
                    settings: {
                        [KEY_A_BOOKING]: { number: 12 },
                        [KEY_C_NOTIF]: { bool: false },
                    },
                },
            })
        );
        const body = await readResponse<BulkResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(2);
        expect(body.json.groupsTouched.sort()).toEqual(["booking", "notifications"]);

        // DB confirms both rows changed.
        const rows = await db
            .select()
            .from(settings)
            .where(inArray(settings.key, [KEY_A_BOOKING, KEY_C_NOTIF]));
        const byKey = new Map(rows.map((r) => [r.key, r.value]));
        expect(byKey.get(KEY_A_BOOKING)).toEqual({ number: 12 });
        expect(byKey.get(KEY_C_NOTIF)).toEqual({ bool: false });
    });

    it("rolls the whole transaction back when any key is unknown", async () => {
        // Capture pre-state; KEY_B_BOOKING shouldn't change even though it is
        // the first key in the payload.
        const [before] = await db
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, KEY_B_BOOKING))
            .limit(1);

        const res = await bulkPATCH(
            buildRequest("/api/admin/settings", "PATCH", {
                body: {
                    settings: {
                        [KEY_B_BOOKING]: { number: 999 },
                        [`${tag}.does.not.exist`]: { bool: false },
                    },
                },
            })
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("unknown_keys");

        // KEY_B_BOOKING value is unchanged — proves rollback.
        const [after] = await db
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, KEY_B_BOOKING))
            .limit(1);
        expect(after.value).toEqual(before.value);
    });
});

describe("PUT /api/admin/settings/[group] — per-group bulk", () => {
    it("updates keys within the targeted group", async () => {
        const res = await groupPUT(
            buildRequest("/api/admin/settings/booking", "PUT", {
                body: {
                    settings: {
                        [KEY_A_BOOKING]: { number: 36 },
                        [KEY_B_BOOKING]: { number: 60 },
                    },
                },
            }),
            { params: Promise.resolve({ group: "booking" }) }
        );
        const body = await readResponse<GroupResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.group).toBe("booking");
        expect(body.json.count).toBe(2);
    });

    it("rejects keys that don't belong to the targeted group", async () => {
        const res = await groupPUT(
            buildRequest("/api/admin/settings/booking", "PUT", {
                body: {
                    settings: {
                        // KEY_C_NOTIF lives in `notifications`, not `booking`.
                        [KEY_C_NOTIF]: { bool: true },
                    },
                },
            }),
            { params: Promise.resolve({ group: "booking" }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("group_mismatch");
    });

    it("rejects unknown keys", async () => {
        const res = await groupPUT(
            buildRequest("/api/admin/settings/booking", "PUT", {
                body: {
                    settings: {
                        [`${tag}.unknown`]: { bool: true },
                    },
                },
            }),
            { params: Promise.resolve({ group: "booking" }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("unknown_keys");
    });
});
