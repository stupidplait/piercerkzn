/**
 * Magic-byte sniffing for the small set of MIME types accepted by the
 * upload pipeline (`@/lib/uploads`).
 *
 * The HTTP `Content-Type` header is **declarative** — a malicious client
 * can presign a `.png` upload and then PUT an executable. Re-checking the
 * first ~32 bytes against well-known signatures catches the trivial
 * impersonation attempts (`Content-Type: image/png` over a JFIF or PE).
 *
 * Returns the inferred MIME type when the bytes are recognised, or `null`
 * for unrecognised content. Callers compare the inferred MIME with the
 * scope's whitelist; if it doesn't match the declared content-type they
 * reject the upload.
 *
 * This module is pure and side-effect-free so it's trivial to unit-test.
 */
import "server-only";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function startsWith(buf: Buffer, ...bytes: readonly number[]): boolean {
    if (buf.length < bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (buf[i] !== bytes[i]) return false;
    }
    return true;
}

function bytesAt(buf: Buffer, offset: number, ...bytes: readonly number[]): boolean {
    if (buf.length < offset + bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (buf[offset + i] !== bytes[i]) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Minimum bytes we need to fingerprint every type we accept. The GIF and
 * GLB header sit in the first 12 bytes; WEBP needs 12 (RIFF/WEBP at 8);
 * everything else fits in 4. We range-GET this many on finalize.
 */
export const SNIFF_BYTES = 32;

/**
 * The MIME types this sniffer can recognise. Keeping the union narrow so
 * `detectMime() === spec.allowedMimeTypes[i]` is a string-equality check.
 */
export type SniffedMime =
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif"
    | "model/gltf-binary";

/**
 * Inspect the start of a file and return the inferred MIME type. Returns
 * `null` if the bytes don't match any known signature.
 *
 * Signatures (RFC / spec references):
 *   JPEG  — FF D8 FF
 *   PNG   — 89 50 4E 47 0D 0A 1A 0A
 *   GIF   — "GIF87a" | "GIF89a"
 *   WEBP  — "RIFF" .... "WEBP"
 *   GLB   — "glTF" + version 0x00000002 little-endian
 */
export function detectMime(buf: Buffer): SniffedMime | null {
    if (!buf || buf.length < 4) return null;

    // JPEG: FF D8 FF
    if (startsWith(buf, 0xff, 0xd8, 0xff)) return "image/jpeg";

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (startsWith(buf, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";

    // GIF: ASCII "GIF87a" or "GIF89a"
    if (
        startsWith(buf, 0x47, 0x49, 0x46, 0x38) &&
        (buf[4] === 0x37 || buf[4] === 0x39) &&
        buf[5] === 0x61
    ) {
        return "image/gif";
    }

    // WEBP: "RIFF" <size:le32> "WEBP"
    if (startsWith(buf, 0x52, 0x49, 0x46, 0x46) && bytesAt(buf, 8, 0x57, 0x45, 0x42, 0x50)) {
        return "image/webp";
    }

    // GLB: ASCII "glTF" magic at offset 0, container version 2 at offset 4.
    if (startsWith(buf, 0x67, 0x6c, 0x54, 0x46)) {
        if (buf.length >= 8) {
            const version = buf.readUInt32LE(4);
            if (version === 2) return "model/gltf-binary";
        }
        // Unknown GLB version — better to fail closed by returning null.
        return null;
    }

    return null;
}

/**
 * Helper for upload finalize: returns `true` when the sniffed bytes match
 * a declared content-type, with a small allowance for `application/octet-stream`
 * which clients sometimes use as a placeholder for GLBs.
 */
export function mimeMatchesDeclared(declared: string, sniffed: SniffedMime | null): boolean {
    if (sniffed === null) return false;
    if (declared === sniffed) return true;
    // GLB sometimes ships as octet-stream from older Three.js exporters.
    if (sniffed === "model/gltf-binary" && declared === "application/octet-stream") return true;
    return false;
}
