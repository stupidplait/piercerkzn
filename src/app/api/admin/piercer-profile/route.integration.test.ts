/**
 * Integration tests for the singleton `/api/admin/piercer-profile` surface.
 *
 * The piercer profile is a single row created by the seed; tests that
 * mutate it must restore the snapshot in `afterAll` so subsequent test
 * runs (and the live admin UI) keep their data.
 *
 * Covers:
 *   - GET returns the singleton (rating fields included).
 *   - PATCH updates only supplied fields and bumps `updatedAt`.
 *   - PATCH cannot mutate `ratingAverage` / `ratingCount` (they're not in
 *     the schema, so the request still succeeds but those fields stay
 *     untouched — verified via round-trip).
 */
import { afterAll, describe, expect, it } from "vitest";

import { GET, PATCH } from "./route";

import { buildRequest, readResponse, snapshotPiercerProfile } from "@/test/integration/helpers";

interface ProfileRow {
    id: string;
    firstName: string;
    lastName: string | null;
    title: string | null;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    experienceYears: number | null;
    specializations: string[] | null;
    certifications: string[] | null;
    socialInstagram: string | null;
    socialTiktok: string | null;
    socialTelegram: string | null;
    ratingAverage: string | number | null;
    ratingCount: number | null;
    createdAt: string;
    updatedAt: string;
}
interface ProfileResponse {
    piercer: ProfileRow;
}

let restore: (() => Promise<void>) | undefined;
afterAll(async () => {
    if (restore) await restore();
});

describe("/api/admin/piercer-profile", () => {
    it("GET returns the singleton with rating fields included", async () => {
        restore = await snapshotPiercerProfile();
        const res = await GET();
        const body = await readResponse<ProfileResponse>(res);
        expect(body.status).toBe(200);
        expect(typeof body.json.piercer.id).toBe("string");
        expect(body.json.piercer.firstName).toBeTruthy();
        // Rating fields exist (numeric or zero); admin route must include them.
        expect(body.json.piercer).toHaveProperty("ratingAverage");
        expect(body.json.piercer).toHaveProperty("ratingCount");
    });

    it("PATCH updates only supplied fields and preserves rating fields", async () => {
        // Capture pre-state so we can assert rating fields didn't change.
        const before = await readResponse<ProfileResponse>(await GET());
        const oldRatingAvg = before.json.piercer.ratingAverage;
        const oldRatingCount = before.json.piercer.ratingCount;
        const oldUpdatedAt = before.json.piercer.updatedAt;

        const newBio = `[integration test bio @ ${Date.now()}]`;
        // Even though the schema rejects unknown keys via .strip behaviour,
        // we send rating-shaped fields explicitly to confirm the route
        // doesn't pipe them through. Zod with .object() (no .passthrough())
        // will silently strip unknown fields.
        const patch = await PATCH(
            buildRequest("/api/admin/piercer-profile", "PATCH", {
                body: {
                    bio: newBio,
                    experienceYears: 7,
                    // These should be ignored by the schema:
                    ratingAverage: "5.0",
                    ratingCount: 9999,
                },
            })
        );
        const after = await readResponse<ProfileResponse>(patch);
        expect(after.status).toBe(200);
        expect(after.json.piercer.bio).toBe(newBio);
        expect(after.json.piercer.experienceYears).toBe(7);
        // Untouched:
        expect(after.json.piercer.ratingAverage).toEqual(oldRatingAvg);
        expect(after.json.piercer.ratingCount).toEqual(oldRatingCount);
        // updatedAt bumped:
        expect(after.json.piercer.updatedAt).not.toBe(oldUpdatedAt);
    });

    it("PATCH with empty body is a no-op except for updatedAt", async () => {
        const before = await readResponse<ProfileResponse>(await GET());
        const beforeBio = before.json.piercer.bio;

        const patch = await PATCH(
            buildRequest("/api/admin/piercer-profile", "PATCH", { body: {} })
        );
        const after = await readResponse<ProfileResponse>(patch);
        expect(after.status).toBe(200);
        expect(after.json.piercer.bio).toBe(beforeBio);
    });
});
