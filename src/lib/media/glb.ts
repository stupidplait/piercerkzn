/**
 * GLB (binary glTF) triangle counter.
 *
 * We do not load three.js / parse the binary buffers themselves — that
 * would mean downloading the whole file. Instead we read the JSON chunk
 * (always chunk 0 of a glTF 2.0 binary) and walk the mesh→primitive tree,
 * summing `indices.count` (when indexed) or the position accessor's count
 * (when not). This is enough to enforce a hard upper bound on poly-count
 * before the worker runs `gltfpack`.
 *
 * Spec reference: glTF 2.0 § "Binary glTF"
 *   - 12-byte header: magic "glTF" (0x46546C67 LE), version u32, length u32
 *   - Followed by ≥1 chunks of: u32 length, u32 type, data[length]
 *   - Chunk 0 MUST be JSON (type 0x4E4F534A, ASCII "JSON")
 *   - Optional chunk 1 is BIN (type 0x004E4942, ASCII "BIN ")
 *
 * Triangle count per primitive (mode TRIANGLES / 4):
 *   - indices.count / 3 when indexed
 *   - position.count / 3 otherwise
 *
 * Other topologies (TRIANGLE_STRIP=5, TRIANGLE_FAN=6) are uncommon for
 * baked jewelry assets but we count them defensively as `count - 2`
 * triangles. Non-triangle primitives (POINTS / LINES) contribute zero.
 */
import "server-only";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** GLB magic "glTF" little-endian. */
const GLB_MAGIC = 0x46546c67;
/** JSON chunk type "JSON" little-endian. */
const CHUNK_TYPE_JSON = 0x4e4f534a;

const GLB_HEADER_LENGTH = 12;
const CHUNK_HEADER_LENGTH = 8;

/** Hard upper bound from `docs/02_TECH_STACK.md` §6 — well above the
 *  documented "body 50–100K, jewelry 5–20K" guidance, low enough to
 *  block obviously-malformed uploads. */
export const MAX_TRIANGLES_DEFAULT = 200_000;

// ---------------------------------------------------------------------------
// Types — narrow subset of glTF 2.0 we touch
// ---------------------------------------------------------------------------
interface GltfAccessor {
    /** Number of elements (triangles need ×3 indices for mode=4). */
    count: number;
}

interface GltfPrimitive {
    /** Topology mode (default 4 = TRIANGLES, per spec). */
    mode?: number;
    /** Accessor index for the index buffer, when indexed. */
    indices?: number;
    /** Attribute → accessor map. POSITION is required. */
    attributes: Record<string, number>;
}

interface GltfMesh {
    primitives: GltfPrimitive[];
}

interface GltfRoot {
    accessors?: GltfAccessor[];
    meshes?: GltfMesh[];
}

export type GlbParseError =
    | "invalid_magic"
    | "unsupported_version"
    | "truncated_header"
    | "truncated_chunk"
    | "missing_json_chunk"
    | "invalid_json"
    | "invalid_gltf_structure";

export interface GlbParseResult {
    triangles: number;
    meshes: number;
    primitives: number;
    jsonChunkBytes: number;
}

export type GlbParseOutcome =
    | { ok: true; result: GlbParseResult }
    | { ok: false; error: GlbParseError };

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Read the GLB header from a buffer and return how many bytes are required
 * to cover the JSON chunk. Returns `null` when the magic / version is wrong
 * or the buffer is too short for the header.
 *
 * Useful when the caller wants to range-GET more bytes after an initial
 * 32-byte sniff: this function tells you exactly how many bytes to fetch.
 */
export function requiredBytesForJsonChunk(buf: Buffer): number | null {
    if (buf.length < GLB_HEADER_LENGTH + CHUNK_HEADER_LENGTH) return null;
    const magic = buf.readUInt32LE(0);
    if (magic !== GLB_MAGIC) return null;
    const version = buf.readUInt32LE(4);
    if (version !== 2) return null;
    const jsonLength = buf.readUInt32LE(GLB_HEADER_LENGTH);
    const jsonType = buf.readUInt32LE(GLB_HEADER_LENGTH + 4);
    if (jsonType !== CHUNK_TYPE_JSON) return null;
    return GLB_HEADER_LENGTH + CHUNK_HEADER_LENGTH + jsonLength;
}

/**
 * Parse a GLB prefix that includes at least the JSON chunk, count
 * triangles, return the totals.
 */
export function parseGlbTriangles(buf: Buffer): GlbParseOutcome {
    if (buf.length < GLB_HEADER_LENGTH) return { ok: false, error: "truncated_header" };

    const magic = buf.readUInt32LE(0);
    if (magic !== GLB_MAGIC) return { ok: false, error: "invalid_magic" };

    const version = buf.readUInt32LE(4);
    if (version !== 2) return { ok: false, error: "unsupported_version" };

    if (buf.length < GLB_HEADER_LENGTH + CHUNK_HEADER_LENGTH) {
        return { ok: false, error: "truncated_chunk" };
    }
    const jsonLength = buf.readUInt32LE(GLB_HEADER_LENGTH);
    const jsonType = buf.readUInt32LE(GLB_HEADER_LENGTH + 4);
    if (jsonType !== CHUNK_TYPE_JSON) {
        return { ok: false, error: "missing_json_chunk" };
    }
    const jsonStart = GLB_HEADER_LENGTH + CHUNK_HEADER_LENGTH;
    const jsonEnd = jsonStart + jsonLength;
    if (buf.length < jsonEnd) return { ok: false, error: "truncated_chunk" };

    let root: GltfRoot;
    try {
        // The JSON chunk is space-padded to a 4-byte boundary; trimming the
        // tail keeps `JSON.parse` happy.
        const text = buf
            .subarray(jsonStart, jsonEnd)
            .toString("utf8")
            .replace(/\u0000+$/, "");
        root = JSON.parse(text) as GltfRoot;
    } catch {
        return { ok: false, error: "invalid_json" };
    }

    if (!root || typeof root !== "object") {
        return { ok: false, error: "invalid_gltf_structure" };
    }

    const accessors = root.accessors ?? [];
    const meshes = root.meshes ?? [];

    let triangles = 0;
    let primitiveCount = 0;

    for (const mesh of meshes) {
        if (!mesh || !Array.isArray(mesh.primitives)) continue;
        for (const prim of mesh.primitives) {
            primitiveCount += 1;
            const mode = prim.mode ?? 4; // default TRIANGLES
            // Resolve element count: indexed → indices accessor; otherwise
            // POSITION attribute (every glTF mesh primitive declares one).
            let elementCount: number | null = null;
            if (typeof prim.indices === "number") {
                elementCount = accessors[prim.indices]?.count ?? null;
            } else if (prim.attributes && typeof prim.attributes.POSITION === "number") {
                elementCount = accessors[prim.attributes.POSITION]?.count ?? null;
            }
            if (elementCount === null || elementCount < 0) continue;

            switch (mode) {
                case 4: // TRIANGLES
                    triangles += Math.floor(elementCount / 3);
                    break;
                case 5: // TRIANGLE_STRIP
                case 6: // TRIANGLE_FAN
                    triangles += Math.max(0, elementCount - 2);
                    break;
                default: // POINTS / LINES / LINE_LOOP / LINE_STRIP — no tris
                    break;
            }
        }
    }

    return {
        ok: true,
        result: {
            triangles,
            meshes: meshes.length,
            primitives: primitiveCount,
            jsonChunkBytes: jsonLength,
        },
    };
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------
export const __testing__ = {
    GLB_MAGIC,
    CHUNK_TYPE_JSON,
    GLB_HEADER_LENGTH,
    CHUNK_HEADER_LENGTH,
};
