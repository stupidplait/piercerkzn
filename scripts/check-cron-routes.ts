/**
 * Cron-route coverage check — Cross-phase invariant 1
 * Verifies every crons[].path in vercel.json has a matching route.ts file.
 *
 * Run: pnpm tsx scripts/check-cron-routes.ts
 * Exit 0 = all routes exist, 1 = mismatch.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_ROOT = resolve(__dirname, "..");

interface VercelConfig {
    crons?: { path: string; schedule: string }[];
}

function main(): number {
    const cfg: VercelConfig = JSON.parse(readFileSync(resolve(APP_ROOT, "vercel.json"), "utf8"));
    const crons = cfg.crons ?? [];
    if (crons.length === 0) {
        process.stderr.write("check-cron-routes: no crons found in vercel.json\n");
        return 1;
    }
    let bad = 0;
    for (const c of crons) {
        const file = resolve(APP_ROOT, "src/app", c.path.slice(1), "route.ts");
        if (existsSync(file)) {
            process.stdout.write(`✓ ${c.path}  (${c.schedule})\n`);
        } else {
            process.stderr.write(`✗ ${c.path}  (${c.schedule})  →  missing: ${file}\n`);
            bad++;
        }
    }
    return bad === 0 ? 0 : 1;
}

process.exit(main());
