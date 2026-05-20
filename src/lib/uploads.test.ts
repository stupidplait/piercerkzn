/**
 * Unit tests for the upload scope spec.
 *
 * Pure-logic only: no R2, no DB. The actual route handlers are exercised by
 * Playwright in `e2e/`.
 */
import { describe, expect, it } from "vitest";

import {
    buildUploadKey,
    extensionFor,
    keyBelongsToScope,
    UPLOAD_SCOPES,
    validateUploadRequest,
} from "./uploads";

describe("UPLOAD_SCOPES", () => {
    it("locks admin-only scopes behind the admin role", () => {
        expect(UPLOAD_SCOPES.product_image.auth).toBe("admin");
        expect(UPLOAD_SCOPES.portfolio_image.auth).toBe("admin");
        expect(UPLOAD_SCOPES.blog_image.auth).toBe("admin");
        expect(UPLOAD_SCOPES.model_3d.auth).toBe("admin");
    });

    it("allows customers for review images and waiver signatures only", () => {
        expect(UPLOAD_SCOPES.review_image.auth).toBe("customer");
        expect(UPLOAD_SCOPES.waiver_signature.auth).toBe("customer");
    });

    it("keeps waiver signatures private (no CDN URL)", () => {
        expect(UPLOAD_SCOPES.waiver_signature.public).toBe(false);
    });
});

describe("validateUploadRequest", () => {
    it("accepts a valid review image", () => {
        const r = validateUploadRequest("review_image", "image/webp", 1024 * 1024);
        expect(r.ok).toBe(true);
    });

    it("rejects an unsupported MIME type", () => {
        const r = validateUploadRequest("review_image", "application/pdf", 1024);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("mime_not_allowed");
    });

    it("rejects an oversize file", () => {
        const r = validateUploadRequest("review_image", "image/jpeg", 6 * 1024 * 1024);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe("size_too_large");
    });

    it("rejects zero-byte uploads", () => {
        const r = validateUploadRequest("review_image", "image/jpeg", 0);
        expect(r.ok).toBe(false);
    });

    it("accepts GLB models for the 3d scope", () => {
        const r = validateUploadRequest("model_3d", "model/gltf-binary", 5 * 1024 * 1024);
        expect(r.ok).toBe(true);
    });

    it("rejects GIFs for product_image but allows them for blog_image", () => {
        expect(validateUploadRequest("product_image", "image/gif", 1024).ok).toBe(false);
        expect(validateUploadRequest("blog_image", "image/gif", 1024).ok).toBe(true);
    });
});

describe("buildUploadKey", () => {
    it("produces a date-partitioned, prefixed key with a sane extension", () => {
        const key = buildUploadKey("review_image", "image/webp");
        expect(key).toMatch(/^reviews\/\d{4}\/\d{2}\/[a-f0-9-]{36}\.webp$/);
    });

    it("uses the scope prefix", () => {
        expect(buildUploadKey("portfolio_image", "image/jpeg")).toMatch(/^portfolio\//);
        expect(buildUploadKey("model_3d", "model/gltf-binary")).toMatch(/^models\//);
    });

    it("falls back to the filename extension for unknown MIME types", () => {
        expect(extensionFor("application/x-something", "model.gltf")).toBe("gltf");
        expect(extensionFor("application/x-something")).toBe("bin");
    });

    it("ignores suspicious filename extensions", () => {
        // Long / non-alphanumeric extensions are rejected to avoid `..` or shell tricks.
        expect(extensionFor("application/x-something", "evil.../etc/passwd")).toBe("bin");
    });
});

describe("keyBelongsToScope", () => {
    it("matches its own prefix", () => {
        expect(keyBelongsToScope("review_image", "reviews/2026/05/abc.webp")).toBe(true);
    });

    it("rejects a key with a different prefix", () => {
        expect(keyBelongsToScope("review_image", "portfolio/2026/05/abc.jpg")).toBe(false);
    });

    it("rejects a similarly-prefixed but distinct path", () => {
        // `reviews-extra/...` must not slip through `reviews` matching.
        expect(keyBelongsToScope("review_image", "reviews-extra/2026/05/abc.webp")).toBe(false);
    });
});
