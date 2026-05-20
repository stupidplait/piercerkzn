/**
 * POST /api/uploads/presign
 *
 * Issues a short-lived presigned PUT URL for direct browser-to-R2 uploads.
 *
 * Flow:
 *   1. Client calls this endpoint with `{ scope, contentType, contentLength, filename? }`.
 *   2. Server validates auth (per scope), MIME type, and size, then mints a fresh
 *      R2 key + presigned PUT URL via `@/lib/r2`.
 *   3. Client PUTs the file directly to `uploadUrl` with the same `Content-Type`.
 *   4. Client calls `/api/uploads/finalize` with `{ scope, key }` to confirm.
 *
 * No DB row is created — the parent record (review, portfolio image, …) stores
 * the resulting `key` / `publicUrl` itself.
 */
import { applyRateLimit, fail, forbidden, internal, ok, parseJson, requireUser } from "@/lib/api";
import { presignPutUrl, publicUrl } from "@/lib/r2";
import { buildUploadKey, UPLOAD_SCOPES, validateUploadRequest } from "@/lib/uploads";
import { presignUploadSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESIGN_TTL_SECONDS = 5 * 60;

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "upload");
    if (limited) return limited;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;

    const parsed = await parseJson(req, presignUploadSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    const spec = UPLOAD_SCOPES[input.scope];
    if (spec.auth === "admin" && ctx.role !== "admin" && ctx.role !== "staff") {
        return forbidden();
    }

    const validation = validateUploadRequest(input.scope, input.contentType, input.contentLength);
    if (!validation.ok) {
        return fail(validation.code, validation.message, { status: 400 });
    }

    try {
        const key = buildUploadKey(input.scope, input.contentType, input.filename);
        const uploadUrl = await presignPutUrl(key, input.contentType, {
            ttlSeconds: PRESIGN_TTL_SECONDS,
            contentLength: input.contentLength,
        });

        return ok({
            scope: input.scope,
            key,
            uploadUrl,
            // Echoed so the client can build its PUT request without re-deriving.
            method: "PUT" as const,
            headers: { "Content-Type": input.contentType },
            // For public scopes the CDN URL is the canonical URL to store.
            // For private scopes the caller must mint a presigned GET when reading.
            publicUrl: spec.public ? publicUrl(key) : null,
            expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
            maxBytes: spec.maxBytes,
        });
    } catch (error) {
        console.error("[/api/uploads/presign] failed", error);
        return internal();
    }
}
