import { describe, expect, it, vi } from "vitest";

// `@/lib/r2` eagerly constructs an S3Client at import time and requires
// R2 credentials in the env. We only exercise the pure URL helpers here,
// so seed the env via `vi.hoisted` (runs before the `import` below).
vi.hoisted(() => {
    process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "test";
    process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "test";
    process.env.R2_ENDPOINT = process.env.R2_ENDPOINT ?? "http://localhost:9000";
    process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "piercerkzn-test";
    process.env.R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "https://cdn.test.example";
});

import { isPrivateKey, publicUrl } from "./r2";

describe("r2 — private-key guard", () => {
    it("flags waivers/ keys as private", () => {
        expect(isPrivateKey("waivers/2026/05/abc.png")).toBe(true);
    });

    it("treats catalog keys as non-private", () => {
        expect(isPrivateKey("products/2026/05/foo.webp")).toBe(false);
        expect(isPrivateKey("models/2026/05/ring.glb")).toBe(false);
        expect(isPrivateKey("reviews/2026/05/x.jpg")).toBe(false);
    });
});

describe("r2 — publicUrl", () => {
    it("throws when called on a private-prefix key", () => {
        expect(() => publicUrl("waivers/2026/05/abc.png")).toThrow(/private key/i);
    });

    it("returns a CDN URL for a public key", () => {
        const url = publicUrl("products/2026/05/foo.webp");
        expect(url).toMatch(/products\/2026\/05\/foo\.webp$/);
    });
});
