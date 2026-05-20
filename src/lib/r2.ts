/**
 * Cloudflare R2 (S3-compatible) client + presigned URL helpers.
 *
 * In production R2 talks via its own endpoint and virtual-hosted style is
 * fine. Locally we hit MinIO at `http://localhost:9000` which only supports
 * path-style addressing.
 *
 * Exposed:
 *   - `r2`              — singleton S3Client
 *   - `R2_BUCKET`       — bucket name from env
 *   - `presignPutUrl()` — short-lived upload URL for browser direct uploads
 *   - `presignGetUrl()` — short-lived read URL for private assets (waivers)
 *   - `publicUrl(key)`  — long-lived CDN URL for public assets
 *   - `deleteObject()`  — admin/cleanup
 */
import "server-only";

import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

declare global {
    var __r2: S3Client | undefined;
}

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is not set. See .env.example.`);
    return v;
}

function createR2(): S3Client {
    const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
    const endpoint = process.env.R2_ENDPOINT; // optional — omit in prod for default R2 URL
    const accountId = process.env.R2_ACCOUNT_ID;
    const isLocalMinio =
        endpoint?.includes("localhost") || endpoint?.includes("127.0.0.1") || false;

    return new S3Client({
        region: "auto",
        endpoint:
            endpoint ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined),
        credentials: { accessKeyId, secretAccessKey },
        // MinIO needs path-style; real R2 prefers virtual-hosted but accepts both.
        forcePathStyle: isLocalMinio,
    });
}

export const r2: S3Client = globalThis.__r2 ?? createR2();
if (process.env.NODE_ENV !== "production") {
    globalThis.__r2 = r2;
}

export const R2_BUCKET: string = process.env.R2_BUCKET_NAME ?? "piercerkzn-assets";

const DEFAULT_PUT_TTL = 60 * 5; // 5 min — generous for slow uploads
const DEFAULT_GET_TTL = 60 * 10; // 10 min

export async function presignPutUrl(
    key: string,
    contentType: string,
    options: { ttlSeconds?: number; contentLength?: number } = {}
): Promise<string> {
    const cmd = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ContentType: contentType,
        ContentLength: options.contentLength,
    });
    return getSignedUrl(r2, cmd, { expiresIn: options.ttlSeconds ?? DEFAULT_PUT_TTL });
}

export async function presignGetUrl(
    key: string,
    options: { ttlSeconds?: number } = {}
): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
    return getSignedUrl(r2, cmd, { expiresIn: options.ttlSeconds ?? DEFAULT_GET_TTL });
}

/**
 * Long-lived public URL via the CDN. Use only for assets meant to be cached.
 *
 * Throws when called on a private-prefix key (waivers/, …) — these objects
 * are not ACL'd by the CDN and must be served via `presignGetUrl()`. The
 * guard is intentionally a hard failure so an accidental refactor surfaces
 * in tests instead of leaking PII.
 */
export function publicUrl(key: string): string {
    if (isPrivateKey(key)) {
        throw new Error(
            `publicUrl() called on a private key (${key}). Use presignGetUrl() for private assets.`
        );
    }
    const base = process.env.R2_PUBLIC_URL ?? `${process.env.R2_ENDPOINT ?? ""}/${R2_BUCKET}`;
    return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

export async function deleteObject(key: string): Promise<void> {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

/**
 * Range-GET the first `length` bytes of an object. Used by the finalize
 * route to verify magic bytes without paying to download the entire file.
 *
 * Returns `null` when the object is missing. Errors other than 404 / 416
 * propagate.
 *
 * Note on edges: when `length` exceeds the object size R2 either responds
 * with 416 (Range Not Satisfiable) or simply returns the full body. We
 * treat both gracefully — short reads are an acceptable outcome here.
 */
export async function getObjectRange(key: string, length: number): Promise<Buffer | null> {
    if (length <= 0) return Buffer.alloc(0);
    try {
        const out = await r2.send(
            new GetObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
                Range: `bytes=0-${length - 1}`,
            })
        );
        if (!out.Body) return Buffer.alloc(0);
        const chunks: Buffer[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const c of out.Body as AsyncIterable<any>) {
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        }
        return Buffer.concat(chunks);
    } catch (err) {
        const code = (err as { name?: string; Code?: string }).name;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode;
        if (code === "NotFound" || code === "NoSuchKey" || status === 404) return null;
        if (status === 416) {
            // Fall back to a full GET — the object is smaller than `length`.
            const out = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
            if (!out.Body) return Buffer.alloc(0);
            const chunks: Buffer[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for await (const c of out.Body as AsyncIterable<any>) {
                chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
            }
            return Buffer.concat(chunks);
        }
        throw err;
    }
}

/**
 * R2 key prefixes that are NEVER served via the public CDN. Mirrors the
 * `public: false` scopes in `@/lib/uploads`. Kept here (rather than
 * imported) to avoid a circular dependency and so the guard works even
 * if a caller forgets to look up the scope spec.
 */
const PRIVATE_KEY_PREFIXES = ["waivers/"] as const;

/**
 * `true` when a key belongs to a prefix that must only be read via
 * `presignGetUrl()`. The CDN doesn't ACL these objects.
 */
export function isPrivateKey(key: string): boolean {
    return PRIVATE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

export interface HeadObjectResult {
    key: string;
    contentType: string | null;
    contentLength: number | null;
    etag: string | null;
}

/**
 * HEAD an object in R2 to confirm it exists post-upload. Returns null when
 * the object is missing (404 / NoSuchKey / NotFound). Other errors propagate.
 */
export async function headObject(key: string): Promise<HeadObjectResult | null> {
    try {
        const out = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        return {
            key,
            contentType: out.ContentType ?? null,
            contentLength: typeof out.ContentLength === "number" ? out.ContentLength : null,
            etag: out.ETag?.replace(/"/g, "") ?? null,
        };
    } catch (err) {
        const code = (
            err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
        ).name;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode;
        if (code === "NotFound" || code === "NoSuchKey" || status === 404) {
            return null;
        }
        throw err;
    }
}
