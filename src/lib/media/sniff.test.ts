import { describe, expect, it } from "vitest";

import { SNIFF_BYTES, detectMime, mimeMatchesDeclared } from "./sniff";

// ---------------------------------------------------------------------------
// Sample magic-byte prefixes — minimum bytes per format, padded to SNIFF_BYTES.
// ---------------------------------------------------------------------------
function pad(prefix: number[]): Buffer {
    const out = Buffer.alloc(SNIFF_BYTES);
    Buffer.from(prefix).copy(out, 0);
    return out;
}

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87a = pad([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89a = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
// "RIFF" .... "WEBP" — bytes 8..11 are "WEBP"
const WEBP = (() => {
    const b = Buffer.alloc(SNIFF_BYTES);
    Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(b, 0); // "RIFF"
    b.writeUInt32LE(1024, 4); // dummy chunk size
    Buffer.from([0x57, 0x45, 0x42, 0x50]).copy(b, 8); // "WEBP"
    return b;
})();
const GLB_V2 = (() => {
    const b = Buffer.alloc(SNIFF_BYTES);
    Buffer.from([0x67, 0x6c, 0x54, 0x46]).copy(b, 0); // "glTF"
    b.writeUInt32LE(2, 4); // version
    b.writeUInt32LE(1000, 8); // total length (arbitrary)
    return b;
})();
const GLB_V1 = (() => {
    const b = GLB_V2.subarray();
    const copy = Buffer.from(b);
    copy.writeUInt32LE(1, 4);
    return copy;
})();

describe("sniff — detectMime", () => {
    it("recognises JPEG", () => {
        expect(detectMime(JPEG)).toBe("image/jpeg");
    });

    it("recognises PNG", () => {
        expect(detectMime(PNG)).toBe("image/png");
    });

    it("recognises GIF87a and GIF89a", () => {
        expect(detectMime(GIF87a)).toBe("image/gif");
        expect(detectMime(GIF89a)).toBe("image/gif");
    });

    it("recognises WEBP", () => {
        expect(detectMime(WEBP)).toBe("image/webp");
    });

    it("recognises GLB v2", () => {
        expect(detectMime(GLB_V2)).toBe("model/gltf-binary");
    });

    it("rejects GLB v1 (unsupported version)", () => {
        expect(detectMime(GLB_V1)).toBeNull();
    });

    it("rejects a RIFF that isn't WEBP", () => {
        const b = Buffer.alloc(SNIFF_BYTES);
        Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(b, 0); // "RIFF"
        Buffer.from([0x57, 0x41, 0x56, 0x45]).copy(b, 8); // "WAVE"
        expect(detectMime(b)).toBeNull();
    });

    it("returns null for short or empty buffers", () => {
        expect(detectMime(Buffer.alloc(0))).toBeNull();
        expect(detectMime(Buffer.from([0xff, 0xd8]))).toBeNull(); // too short
    });

    it("returns null for unrecognised content", () => {
        // PE/EXE prefix masquerading as an image
        const exe = pad([0x4d, 0x5a, 0x90, 0x00]);
        expect(detectMime(exe)).toBeNull();
    });
});

describe("sniff — mimeMatchesDeclared", () => {
    it("matches when declared and sniffed agree", () => {
        expect(mimeMatchesDeclared("image/png", "image/png")).toBe(true);
    });

    it("rejects when declared and sniffed differ", () => {
        expect(mimeMatchesDeclared("image/png", "image/jpeg")).toBe(false);
    });

    it("rejects when sniff returned null", () => {
        expect(mimeMatchesDeclared("image/png", null)).toBe(false);
    });

    it("allows GLB under application/octet-stream alias", () => {
        expect(mimeMatchesDeclared("application/octet-stream", "model/gltf-binary")).toBe(true);
    });

    it("does NOT allow images under octet-stream", () => {
        expect(mimeMatchesDeclared("application/octet-stream", "image/png")).toBe(false);
    });
});
