/**
 * Env Schema Parity Check — Phase 3 AC 3.1, 3.2, 3.11, 3.12
 * Compares keys in .env.example with `vercel env ls --json` per environment.
 * Enforces the Sensitive-flag rule for secret-shaped keys.
 *
 * Run: pnpm tsx scripts/check-env-schema.ts
 * Requires: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID in env.
 * Exit 0 = parity, 1 = drift detected.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_ROOT = resolve(__dirname, "..");
const SENSITIVE_RE = /^(.*_(SECRET|TOKEN|KEY|PASSWORD)|DATABASE_URL.*|REDIS_URL)$/;
const ENVS = ["preview", "staging", "production"] as const;
type EnvName = (typeof ENVS)[number];

interface VercelEnvVar {
    key: string;
    target: string[];
    type: "encrypted" | "plain" | "system" | "secret" | "sensitive";
}

function templateKeys(): Set<string> {
    const text = readFileSync(resolve(APP_ROOT, ".env.example"), "utf8");
    const keys = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
        const m = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(line.trim());
        if (m) keys.add(m[1]);
    }
    return keys;
}

function vercelEnvVars(env: EnvName): VercelEnvVar[] {
    const json = execSync(`vercel env ls --json --environment ${env}`, {
        encoding: "utf8",
        env: {
            ...process.env,
            VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
            VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
        },
    });
    return JSON.parse(json) as VercelEnvVar[];
}

function checkOne(env: EnvName, want: Set<string>): string[] {
    const have = vercelEnvVars(env);
    const haveKeys = new Set(have.map((v) => v.key));
    const errs: string[] = [];
    for (const k of want) {
        if (!haveKeys.has(k)) errs.push(`[${env}] missing key ${k}`);
    }
    for (const k of haveKeys) {
        if (!want.has(k)) errs.push(`[${env}] extra key ${k}`);
    }
    for (const v of have) {
        if (
            SENSITIVE_RE.test(v.key) &&
            v.type !== "encrypted" &&
            v.type !== "secret" &&
            v.type !== "sensitive"
        ) {
            errs.push(`[${env}] key ${v.key} matches sensitive pattern but type=${v.type}`);
        }
    }
    return errs;
}

function main(): number {
    const want = templateKeys();
    const errs = ENVS.flatMap((e) => checkOne(e, want));
    for (const e of errs) process.stderr.write(`check-env-schema: ${e}\n`);
    if (errs.length === 0) {
        process.stdout.write(`check-env-schema: OK (${want.size} keys, 3 environments)\n`);
    }
    return errs.length === 0 ? 0 : 1;
}

process.exit(main());
