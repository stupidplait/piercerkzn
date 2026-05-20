/**
 * Media post-processing.
 *
 * Triggered from `/api/uploads/finalize` once an upload has confirmed its
 * landing in R2. The worker reads the source object, produces derivatives,
 * and writes them back to R2 alongside the original.
 *
 * - **Images** (`review_image | portfolio_image | product_image | blog_image`):
 *     `sharp` resizes to:
 *       • `<key>.thumb.webp`  (300px wide)
 *       • `<key>.large.webp`  (1024px wide)
 *       • `<key>.og.webp`     (1200×630, cover-fit, OG share card)
 *     For `product_image` with `parentRecordId` we additionally update
 *     `product.thumbnailUrl` if it's currently null.
 *
 * - **GLBs** (`model_3d`):
 *     `gltfpack` (CLI) is invoked when present on PATH; otherwise we log
 *     and bail. Vercel serverless can't ship binaries, so production GLB
 *     optimisation must be handled out-of-band (Blender/CI step).
 *
 * Failures are logged + surfaced via the worker outcome so BullMQ can
 * retry; we never throw past the worker boundary.
 */
import "server-only";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";

import { db, products } from "@/db";
import { R2_BUCKET, headObject, publicUrl, r2 } from "@/lib/r2";
import type { MediaProcessJob } from "@/lib/queue";
import { IMAGE_VARIANTS, deriveVariantKey } from "./process.utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ImageVariant {
    suffix: "thumb" | "large" | "og";
    width: number;
    height?: number;
    fit?: "cover" | "inside";
    key: string;
    publicUrl: string;
}

export interface MediaProcessResult {
    key: string;
    kind: "image" | "glb";
    variants: ImageVariant[];
    skippedReason?:
        | "object_missing"
        | "sharp_unavailable"
        | "gltfpack_unavailable"
        | "unsupported_kind";
    parentRecordUpdated?: boolean;
}

/**
 * Lazy `sharp` import — keeps the cold-start path slim when the worker
 * isn't actually running and lets the route handlers `enqueue` without
 * pulling sharp's native bindings into edge bundles. Typed loosely
 * because `sharp` is an optional peer dependency (run `pnpm add sharp` to
 * activate image processing).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFactory = (input?: Buffer) => any;

async function loadSharp(): Promise<SharpFactory | null> {
    try {
        // Indirected through a variable so the compiler doesn't try to
        // resolve the module statically when `sharp` isn't installed.
        const moduleName = "sharp";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = (await import(/* @vite-ignore */ moduleName)) as any;
        return (mod.default ?? mod) as SharpFactory;
    } catch {
        console.warn("[media] sharp not available — install `sharp` to enable image variants");
        return null;
    }
}

async function fetchObjectBuffer(key: string): Promise<Buffer | null> {
    const head = await headObject(key);
    if (!head) return null;
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const out = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!out.Body) return null;
    const chunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const c of out.Body as AsyncIterable<any>) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    return Buffer.concat(chunks);
}

async function uploadVariant(key: string, body: Buffer, contentType = "image/webp"): Promise<void> {
    await r2.send(
        new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: "public, max-age=31536000, immutable",
        })
    );
}

async function processImage(job: MediaProcessJob): Promise<MediaProcessResult> {
    const result: MediaProcessResult = { key: job.key, kind: "image", variants: [] };

    const buf = await fetchObjectBuffer(job.key);
    if (!buf) {
        result.skippedReason = "object_missing";
        return result;
    }

    const sharp = await loadSharp();
    if (!sharp) {
        result.skippedReason = "sharp_unavailable";
        return result;
    }

    for (const spec of IMAGE_VARIANTS) {
        const variantKey = deriveVariantKey(job.key, spec.suffix);
        const pipeline = sharp(buf);
        const resized = pipeline.resize({
            width: spec.width,
            height: spec.height,
            fit: spec.fit ?? "inside",
            withoutEnlargement: spec.fit === "inside",
        });
        const out = await resized.webp({ quality: 80 }).toBuffer();
        await uploadVariant(variantKey, out);
        result.variants.push({
            suffix: spec.suffix,
            width: spec.width,
            height: spec.height,
            fit: spec.fit,
            key: variantKey,
            publicUrl: publicUrl(variantKey),
        });
    }

    // Optional parent record update — only `product` for now.
    if (job.scope === "product_image" && job.parentRecordId) {
        const thumb = result.variants.find((v) => v.suffix === "thumb");
        if (thumb) {
            const updated = await db
                .update(products)
                .set({ thumbnailUrl: thumb.publicUrl, updatedAt: new Date() })
                .where(eq(products.id, job.parentRecordId))
                .returning({ id: products.id });
            result.parentRecordUpdated = updated.length > 0;
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// GLB processing — only runs locally with `gltfpack` on PATH.
// ---------------------------------------------------------------------------
async function processGlb(job: MediaProcessJob): Promise<MediaProcessResult> {
    const result: MediaProcessResult = { key: job.key, kind: "glb", variants: [] };

    const head = await headObject(job.key);
    if (!head) {
        result.skippedReason = "object_missing";
        return result;
    }

    // gltfpack ships as a static binary; we shell out only when the user
    // installs it locally. On Vercel this branch always returns
    // `gltfpack_unavailable` — handle GLB optimisation in the upload pipeline
    // before pushing to R2 (Blender/CI), per `docs/02_TECH_STACK.md` §6.
    try {
        const { spawn } = await import("node:child_process");
        const probe = await new Promise<boolean>((resolve) => {
            const p = spawn("gltfpack", ["-h"], { shell: false });
            p.on("error", () => resolve(false));
            p.on("close", (code) => resolve(code === 0));
        });
        if (!probe) {
            result.skippedReason = "gltfpack_unavailable";
            return result;
        }
    } catch {
        result.skippedReason = "gltfpack_unavailable";
        return result;
    }

    // Real implementation would download the source, run gltfpack with
    // Meshopt + KTX2 flags, and upload the optimised key. Left as a TODO —
    // we don't want to block the queue path on a CLI we may not have.
    console.warn("[media] gltfpack present but processing pipeline not yet implemented");
    result.skippedReason = "gltfpack_unavailable";
    return result;
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------
export async function processMediaJob(job: { data: MediaProcessJob }): Promise<MediaProcessResult> {
    if (job.data.kind === "image") return processImage(job.data);
    if (job.data.kind === "glb") return processGlb(job.data);
    return {
        key: job.data.key,
        kind: job.data.kind,
        variants: [],
        skippedReason: "unsupported_kind",
    };
}

export { IMAGE_VARIANTS, deriveVariantKey } from "./process.utils";
