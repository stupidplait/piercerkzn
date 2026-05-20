/**
 * Upload scope specification.
 *
 * Each scope corresponds to a `type` value documented in
 * `docs/04_BACKEND_ENDPOINTS.md` §21 — File Uploads. The spec drives:
 *
 *   - allowed MIME types (defends against arbitrary uploads)
 *   - max byte size (defends against R2 cost / storage abuse)
 *   - required role on `/api/uploads/presign`
 *   - whether the resulting object is public-CDN-served or private (presigned reads)
 *   - the R2 key prefix (so we can lifecycle / cleanup by prefix later)
 *
 * Key shape: `{prefix}/{YYYY}/{MM}/{uuid}.{ext}` — date-partitioned, collision-free.
 * No DB row is created on presign or finalize: callers attach the returned
 * `key` / `publicUrl` to their parent record (review.images, portfolio_image.imageUrl, …).
 */
import "server-only";

import { extname } from "node:path";

export type UploadScope =
    | "review_image"
    | "portfolio_image"
    | "product_image"
    | "blog_image"
    | "model_3d"
    | "waiver_signature";

export type UploadAuthRole = "customer" | "admin";

export interface UploadScopeSpec {
    /** Required minimum role on `/api/uploads/presign`. */
    auth: UploadAuthRole;
    /** Whitelist of acceptable `Content-Type` values. */
    allowedMimeTypes: readonly string[];
    /** Hard upper bound on `Content-Length`, in bytes. */
    maxBytes: number;
    /** R2 key prefix (no trailing slash). */
    prefix: string;
    /** True if the object should be served from the public CDN. */
    public: boolean;
}

const MB = 1024 * 1024;

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const BLOG_IMAGE_MIMES = [...IMAGE_MIMES, "image/gif"] as const;

export const UPLOAD_SCOPES: Record<UploadScope, UploadScopeSpec> = {
    review_image: {
        auth: "customer",
        allowedMimeTypes: IMAGE_MIMES,
        maxBytes: 5 * MB,
        prefix: "reviews",
        public: true,
    },
    portfolio_image: {
        auth: "admin",
        allowedMimeTypes: IMAGE_MIMES,
        maxBytes: 10 * MB,
        prefix: "portfolio",
        public: true,
    },
    product_image: {
        auth: "admin",
        allowedMimeTypes: IMAGE_MIMES,
        maxBytes: 10 * MB,
        prefix: "products",
        public: true,
    },
    blog_image: {
        auth: "admin",
        allowedMimeTypes: BLOG_IMAGE_MIMES,
        maxBytes: 10 * MB,
        prefix: "blog",
        public: true,
    },
    model_3d: {
        auth: "admin",
        allowedMimeTypes: ["model/gltf-binary", "application/octet-stream"],
        maxBytes: 20 * MB,
        prefix: "models",
        public: true,
    },
    waiver_signature: {
        auth: "customer",
        allowedMimeTypes: ["image/png"],
        maxBytes: 1 * MB,
        prefix: "waivers",
        public: false,
    },
};

const MIME_TO_EXT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "model/gltf-binary": "glb",
    "application/octet-stream": "bin",
};

/**
 * Pick a safe file extension based on the (validated) content-type, falling
 * back to the original filename's extension if we can't map the MIME.
 */
export function extensionFor(contentType: string, filename?: string): string {
    const fromMime = MIME_TO_EXT[contentType];
    if (fromMime) return fromMime;
    if (filename) {
        const ext = extname(filename).replace(/^\./, "").toLowerCase();
        if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
    }
    return "bin";
}

/**
 * Build a fresh, collision-free R2 key for the given scope.
 *
 *   reviews/2026/05/3a4c…d2.webp
 */
export function buildUploadKey(scope: UploadScope, contentType: string, filename?: string): string {
    const spec = UPLOAD_SCOPES[scope];
    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const id = crypto.randomUUID();
    const ext = extensionFor(contentType, filename);
    return `${spec.prefix}/${yyyy}/${mm}/${id}.${ext}`;
}

export interface UploadValidationOk {
    ok: true;
    spec: UploadScopeSpec;
}
export interface UploadValidationErr {
    ok: false;
    code: "scope_not_allowed" | "mime_not_allowed" | "size_too_large";
    message: string;
}

/**
 * Validate a presign request against the scope spec. Does not check auth —
 * the route handler does that with `requireUser` / `requireAdmin`.
 */
export function validateUploadRequest(
    scope: UploadScope,
    contentType: string,
    contentLength: number
): UploadValidationOk | UploadValidationErr {
    const spec = UPLOAD_SCOPES[scope];
    if (!spec) {
        return {
            ok: false,
            code: "scope_not_allowed",
            message: `Неизвестный тип загрузки: ${scope}`,
        };
    }
    if (!spec.allowedMimeTypes.includes(contentType)) {
        return {
            ok: false,
            code: "mime_not_allowed",
            message: `Тип файла ${contentType} не разрешён для ${scope}`,
        };
    }
    if (contentLength <= 0 || contentLength > spec.maxBytes) {
        return {
            ok: false,
            code: "size_too_large",
            message: `Размер файла превышает ${Math.round(spec.maxBytes / MB)} МБ`,
        };
    }
    return { ok: true, spec };
}

/**
 * Confirm that a key belongs to the declared scope's prefix. Used by
 * `/api/uploads/finalize` to prevent a client from finalizing a key that
 * belongs to a different (higher-permission) scope.
 */
export function keyBelongsToScope(scope: UploadScope, key: string): boolean {
    const spec = UPLOAD_SCOPES[scope];
    if (!spec) return false;
    return key.startsWith(`${spec.prefix}/`);
}
