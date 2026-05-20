/**
 * POST /api/uploads/finalize
 *
 * Confirms a previously-presigned upload actually landed in R2.
 *
 * - Verifies the supplied `key` belongs to the declared `scope`'s prefix
 *   (prevents a customer-scoped caller from finalizing an admin-scoped key).
 * - HEADs the object in R2 to read back its real Content-Type / Content-Length
 *   and confirm it exists.
 * - Re-checks size against the scope's `maxBytes`.
 *
 * No DB row is written here — the caller (e.g. the review / portfolio
 * endpoint) is responsible for attaching the returned `key` / `publicUrl`
 * to its parent record.
 */
import {
    applyRateLimit,
    fail,
    forbidden,
    internal,
    notFound,
    ok,
    parseJson,
    requireUser,
} from "@/lib/api";
import {
    MAX_TRIANGLES_DEFAULT,
    parseGlbTriangles,
    requiredBytesForJsonChunk,
} from "@/lib/media/glb";
import { detectMime, mimeMatchesDeclared, SNIFF_BYTES } from "@/lib/media/sniff";
import { enqueueMediaProcess, type MediaProcessJob } from "@/lib/queue";
import { getObjectRange, headObject, publicUrl } from "@/lib/r2";
import { keyBelongsToScope, UPLOAD_SCOPES } from "@/lib/uploads";
import { finalizeUploadSchema } from "@/lib/validations";

/** Image scopes that get sharp variants. Waivers / unknown skip processing. */
const IMAGE_SCOPES = new Set<MediaProcessJob["scope"]>([
    "review_image",
    "portfolio_image",
    "product_image",
    "blog_image",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "upload");
    if (limited) return limited;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;

    const parsed = await parseJson(req, finalizeUploadSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    const spec = UPLOAD_SCOPES[input.scope];
    if (spec.auth === "admin" && ctx.role !== "admin" && ctx.role !== "staff") {
        return forbidden();
    }

    if (!keyBelongsToScope(input.scope, input.key)) {
        return fail("scope_mismatch", "Ключ не принадлежит указанному типу", { status: 400 });
    }

    let head;
    try {
        head = await headObject(input.key);
    } catch (error) {
        console.error("[/api/uploads/finalize] HEAD failed", error);
        return internal();
    }

    if (!head) {
        return notFound("Файл не найден в хранилище — повторите загрузку");
    }

    if (head.contentType && !spec.allowedMimeTypes.includes(head.contentType)) {
        return fail("mime_not_allowed", `Тип файла ${head.contentType} не разрешён`, {
            status: 400,
        });
    }
    if (head.contentLength !== null && head.contentLength > spec.maxBytes) {
        return fail("size_too_large", "Размер файла превышает допустимый", { status: 400 });
    }

    // ---------------------------------------------------------------------
    // Magic-byte verification. The HEAD-reported Content-Type is what the
    // browser PUT — it's declarative and trivially spoofed. Range-GET the
    // first 32 bytes and confirm the file's actual signature matches.
    //
    // Failures here are a hard reject; we don't trust a "PNG" that starts
    // with a PE/JFIF/etc.
    // ---------------------------------------------------------------------
    let prefixBytes: Buffer | null;
    try {
        prefixBytes = await getObjectRange(input.key, SNIFF_BYTES);
    } catch (error) {
        console.error("[/api/uploads/finalize] range-get failed", error);
        return internal();
    }
    if (!prefixBytes || prefixBytes.length < 4) {
        return fail("magic_unreadable", "Не удалось прочитать сигнатуру файла", { status: 400 });
    }

    const sniffed = detectMime(prefixBytes);
    const declared = head.contentType ?? "";
    if (!mimeMatchesDeclared(declared, sniffed)) {
        console.warn("[/api/uploads/finalize] magic mismatch", {
            key: input.key,
            declared,
            sniffed,
        });
        return fail("magic_mismatch", "Содержимое файла не соответствует объявленному типу", {
            status: 400,
        });
    }

    // ---------------------------------------------------------------------
    // GLB poly-count guard (per `docs/02_TECH_STACK.md` §6). We parse the
    // JSON chunk *only* — no binary buffer download. The chunk length is
    // declared at offset 12; if our 32-byte sniff window doesn't already
    // cover it, range-GET exactly the bytes we need.
    // ---------------------------------------------------------------------
    if (input.scope === "model_3d" && sniffed === "model/gltf-binary") {
        const required = requiredBytesForJsonChunk(prefixBytes);
        if (required === null) {
            return fail("invalid_glb", "Файл не является валидным GLB 2.0", { status: 400 });
        }

        let glbPrefix = prefixBytes;
        if (required > prefixBytes.length) {
            try {
                const extended = await getObjectRange(input.key, required);
                if (!extended) {
                    return fail("glb_unreadable", "Не удалось прочитать JSON-чанк GLB", {
                        status: 400,
                    });
                }
                glbPrefix = extended;
            } catch (error) {
                console.error("[/api/uploads/finalize] GLB range-get failed", error);
                return internal();
            }
        }

        const outcome = parseGlbTriangles(glbPrefix);
        if (!outcome.ok) {
            return fail("invalid_glb", `Некорректная структура GLB (${outcome.error})`, {
                status: 400,
            });
        }
        if (outcome.result.triangles > MAX_TRIANGLES_DEFAULT) {
            return fail(
                "glb_too_complex",
                `Модель содержит ${outcome.result.triangles.toLocaleString("ru-RU")} треугольников — лимит ${MAX_TRIANGLES_DEFAULT.toLocaleString("ru-RU")}`,
                { status: 400 }
            );
        }
    }

    // Best-effort enqueue of post-processing (sharp variants for images,
    // gltfpack for GLBs). Never fail the finalize call on a queue hiccup —
    // missing variants can be re-derived later by replaying the job.
    const kind: MediaProcessJob["kind"] | null = IMAGE_SCOPES.has(input.scope)
        ? "image"
        : input.scope === "model_3d"
          ? "glb"
          : null;
    if (kind && head.contentType) {
        void enqueueMediaProcess({
            scope: input.scope,
            key: input.key,
            kind,
            contentType: head.contentType,
        }).catch((err) => {
            console.error("[/api/uploads/finalize] enqueueMediaProcess failed", err);
        });
    }

    return ok({
        scope: input.scope,
        key: input.key,
        contentType: head.contentType,
        contentLength: head.contentLength,
        etag: head.etag,
        publicUrl: spec.public ? publicUrl(input.key) : null,
    });
}
