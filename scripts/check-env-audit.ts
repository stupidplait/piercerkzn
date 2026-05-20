/**
 * Env Audit Script — Phase 1 AC 1.3, 1.3a, 1.5
 * Enumerates every `process.env.<KEY>` read in app/src and verifies
 * each key exists in app/.env.example.
 *
 * Run: pnpm tsx scripts/check-env-audit.ts
 * Exit 0 = OK, 1 = missing keys or malformed .env.example.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const APP_ROOT = resolve(__dirname, "..");
const ENV_FILE = resolve(APP_ROOT, ".env.example");
const SRC_DIR = resolve(APP_ROOT, "src");
const ENV_KEY_RE = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

function walkFiles(dir: string, exts: string[]): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(full, exts));
        } else if (exts.some((e) => entry.name.endsWith(e))) {
            results.push(full);
        }
    }
    return results;
}

function parseDotenvKeys(text: string): {
    keys: Set<string>;
    error?: { line: number; reason: string };
} {
    const keys = new Set<string>();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("#")) continue;
        const m = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
        if (!m) return { keys, error: { line: i + 1, reason: "malformed assignment" } };
        if (keys.has(m[1]))
            return { keys, error: { line: i + 1, reason: `duplicate key ${m[1]}` } };
        keys.add(m[1]);
    }
    return { keys };
}

function collectSourceKeys(): Set<string> {
    const files = walkFiles(SRC_DIR, [".ts", ".tsx"]);
    const keys = new Set<string>();
    for (const f of files) {
        const text = readFileSync(f, "utf8");
        for (const m of text.matchAll(ENV_KEY_RE)) keys.add(m[1]);
    }
    return keys;
}

function main(): number {
    const envText = readFileSync(ENV_FILE, "utf8");
    const { keys: envKeys, error } = parseDotenvKeys(envText);
    if (error) {
        process.stderr.write(`check-env-audit: ${ENV_FILE}:${error.line}: ${error.reason}\n`);
        return 1;
    }
    const srcKeys = collectSourceKeys();
    const missing = [...srcKeys].filter((k) => !envKeys.has(k)).sort();
    const orphan = [...envKeys].filter((k) => !srcKeys.has(k)).sort();
    for (const k of orphan) process.stderr.write(`check-env-audit: WARN orphan key ${k}\n`);
    if (missing.length > 0) {
        for (const k of missing) process.stderr.write(`check-env-audit: ERROR missing key ${k}\n`);
        return 1;
    }
    process.stdout.write(
        `check-env-audit: OK (${srcKeys.size} keys in source, ${envKeys.size} in template)\n`
    );
    return 0;
}

process.exit(main());
