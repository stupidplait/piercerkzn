import { describe, expect, it } from "vitest";

import {
    MAX_TRIANGLES_DEFAULT,
    __testing__,
    parseGlbTriangles,
    requiredBytesForJsonChunk,
} from "./glb";

// ---------------------------------------------------------------------------
// GLB fixture builder — emits a minimal valid GLB 2.0 binary whose chunk 0
// contains the given JSON object. Pads JSON to 4-byte alignment with spaces.
// We don't write a real binary buffer chunk because the triangle counter
// only reads the JSON; the spec lets us omit chunk 1 entirely when no
// accessor references it via bufferView (we keep the accessor counts only).
// ---------------------------------------------------------------------------
function buildGlb(jsonObj: unknown): Buffer {
    const jsonBody = JSON.stringify(jsonObj);
    // Pad to 4-byte boundary with spaces (per glTF 2.0 spec for JSON chunk).
    const pad = (4 - (jsonBody.length % 4)) % 4;
    const jsonPadded = Buffer.from(jsonBody + " ".repeat(pad), "utf8");

    const total =
        __testing__.GLB_HEADER_LENGTH + __testing__.CHUNK_HEADER_LENGTH + jsonPadded.length;
    const buf = Buffer.alloc(total);

    // Header
    buf.writeUInt32LE(__testing__.GLB_MAGIC, 0);
    buf.writeUInt32LE(2, 4); // version
    buf.writeUInt32LE(total, 8); // total length

    // Chunk 0 (JSON)
    buf.writeUInt32LE(jsonPadded.length, __testing__.GLB_HEADER_LENGTH);
    buf.writeUInt32LE(__testing__.CHUNK_TYPE_JSON, __testing__.GLB_HEADER_LENGTH + 4);
    jsonPadded.copy(buf, __testing__.GLB_HEADER_LENGTH + __testing__.CHUNK_HEADER_LENGTH);

    return buf;
}

describe("glb — requiredBytesForJsonChunk", () => {
    it("returns the right size for a well-formed GLB", () => {
        const glb = buildGlb({ asset: { version: "2.0" } });
        const required = requiredBytesForJsonChunk(glb);
        expect(required).toBe(glb.length);
    });

    it("returns null for an unknown magic", () => {
        const bad = Buffer.alloc(20);
        bad.writeUInt32LE(0xdeadbeef, 0);
        expect(requiredBytesForJsonChunk(bad)).toBeNull();
    });

    it("returns null for an unsupported GLB version", () => {
        const bad = Buffer.alloc(20);
        bad.writeUInt32LE(__testing__.GLB_MAGIC, 0);
        bad.writeUInt32LE(1, 4); // v1
        expect(requiredBytesForJsonChunk(bad)).toBeNull();
    });

    it("returns null when the buffer is too short to read the header", () => {
        expect(requiredBytesForJsonChunk(Buffer.alloc(5))).toBeNull();
    });
});

describe("glb — parseGlbTriangles", () => {
    it("counts indexed TRIANGLES primitives via indices accessor", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [
                { count: 3000 }, // indices
                { count: 1000 }, // positions
            ],
            meshes: [
                {
                    primitives: [{ mode: 4, indices: 0, attributes: { POSITION: 1 } }],
                },
            ],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(1000);
        expect(r.result.meshes).toBe(1);
        expect(r.result.primitives).toBe(1);
    });

    it("falls back to POSITION count for non-indexed primitives", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [{ count: 600 }],
            meshes: [{ primitives: [{ mode: 4, attributes: { POSITION: 0 } }] }],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(200);
    });

    it("defaults mode to TRIANGLES when omitted", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [{ count: 30 }, { count: 10 }],
            meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(10);
    });

    it("counts TRIANGLE_STRIP and TRIANGLE_FAN as count-2", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [{ count: 12 }, { count: 12 }],
            meshes: [
                {
                    primitives: [
                        { mode: 5, indices: 0, attributes: { POSITION: 1 } },
                        { mode: 6, indices: 0, attributes: { POSITION: 1 } },
                    ],
                },
            ],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(20); // 10 + 10
    });

    it("ignores non-triangle primitives (POINTS / LINES)", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [{ count: 100 }],
            meshes: [
                {
                    primitives: [
                        { mode: 0, attributes: { POSITION: 0 } }, // POINTS
                        { mode: 1, attributes: { POSITION: 0 } }, // LINES
                    ],
                },
            ],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(0);
    });

    it("sums multiple meshes and primitives", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [{ count: 30 }, { count: 60 }, { count: 90 }],
            meshes: [
                {
                    primitives: [
                        { mode: 4, indices: 0, attributes: { POSITION: 0 } }, // 10
                        { mode: 4, indices: 1, attributes: { POSITION: 0 } }, // 20
                    ],
                },
                { primitives: [{ mode: 4, indices: 2, attributes: { POSITION: 0 } }] }, // 30
            ],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(60);
        expect(r.result.meshes).toBe(2);
        expect(r.result.primitives).toBe(3);
    });

    it("rejects an invalid magic", () => {
        const bad = Buffer.alloc(20);
        bad.writeUInt32LE(0xdeadbeef, 0);
        const r = parseGlbTriangles(bad);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toBe("invalid_magic");
    });

    it("rejects an unsupported version", () => {
        const bad = Buffer.alloc(20);
        bad.writeUInt32LE(__testing__.GLB_MAGIC, 0);
        bad.writeUInt32LE(1, 4);
        const r = parseGlbTriangles(bad);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toBe("unsupported_version");
    });

    it("rejects a buffer truncated before the chunk header", () => {
        const bad = Buffer.alloc(12);
        bad.writeUInt32LE(__testing__.GLB_MAGIC, 0);
        bad.writeUInt32LE(2, 4);
        const r = parseGlbTriangles(bad);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toBe("truncated_chunk");
    });

    it("rejects when chunk 0 is not JSON", () => {
        const buf = Buffer.alloc(20);
        buf.writeUInt32LE(__testing__.GLB_MAGIC, 0);
        buf.writeUInt32LE(2, 4);
        buf.writeUInt32LE(0, 8);
        buf.writeUInt32LE(0, 12); // chunk length
        buf.writeUInt32LE(0x004e4942, 16); // BIN chunk
        const r = parseGlbTriangles(buf);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toBe("missing_json_chunk");
    });

    it("rejects invalid JSON inside the JSON chunk", () => {
        // Build a GLB with hand-crafted bad JSON
        const body = Buffer.from("{not json", "utf8");
        const total = __testing__.GLB_HEADER_LENGTH + __testing__.CHUNK_HEADER_LENGTH + body.length;
        const buf = Buffer.alloc(total);
        buf.writeUInt32LE(__testing__.GLB_MAGIC, 0);
        buf.writeUInt32LE(2, 4);
        buf.writeUInt32LE(total, 8);
        buf.writeUInt32LE(body.length, 12);
        buf.writeUInt32LE(__testing__.CHUNK_TYPE_JSON, 16);
        body.copy(buf, 20);
        const r = parseGlbTriangles(buf);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toBe("invalid_json");
    });

    it("crosses the 200K-triangle hard ceiling for huge meshes", () => {
        const glb = buildGlb({
            asset: { version: "2.0" },
            accessors: [{ count: 900_000 }, { count: 1 }],
            meshes: [{ primitives: [{ mode: 4, indices: 0, attributes: { POSITION: 1 } }] }],
        });
        const r = parseGlbTriangles(glb);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.result.triangles).toBe(300_000);
        expect(r.result.triangles).toBeGreaterThan(MAX_TRIANGLES_DEFAULT);
    });
});
