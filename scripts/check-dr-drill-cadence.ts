/**
 * DR Drill Cadence Checker — Phase 7 AC 7.5, 7.6, 7.7, 7.8
 * Parses docs/dr-drill-log.md, validates typed fields, and fires
 * BetterStack Warning webhook when cadence is missed or RTO/RPO breached.
 *
 * Run: pnpm tsx scripts/check-dr-drill-cadence.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOG_PATH = resolve(__dirname, "..", "..", "docs", "dr-drill-log.md");
const DRILL_TYPES = ["PITR", "Snapshot", "Rollback"] as const;
type DrillType = (typeof DRILL_TYPES)[number];

interface Drill {
    date: string;
    drill_type: DrillType;
    operator: string;
    observed_rto_minutes: number;
    observed_rpo_minutes: number;
    remediation_items: string[] | null;
}

function parseDrills(text: string): Drill[] {
    const drills: Drill[] = [];
    const sections = text.split(/^## /m).slice(1);
    for (const section of sections) {
        const get = (key: string): string | undefined => {
            const m = new RegExp(`^- \\*\\*${key}:\\*\\*\\s*(.+)$`, "m").exec(section);
            return m?.[1]?.trim();
        };
        const dateStr = get("date");
        const typeStr = get("drill_type");
        const operator = get("operator");
        const rtoStr = get("observed_rto_minutes");
        const rpoStr = get("observed_rpo_minutes");
        const remStr = get("remediation_items");

        if (!dateStr || !typeStr || !operator || !rtoStr || !rpoStr) continue;
        if (!DRILL_TYPES.includes(typeStr as DrillType)) {
            process.stderr.write(`check-dr-drill-cadence: invalid drill_type "${typeStr}"\n`);
            continue;
        }
        const rto = parseInt(rtoStr, 10);
        const rpo = parseInt(rpoStr, 10);
        if (isNaN(rto) || isNaN(rpo)) continue;

        const remediation =
            remStr === "null" || !remStr
                ? null
                : remStr
                      .replace(/^\[|\]$/g, "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
        drills.push({
            date: dateStr,
            drill_type: typeStr as DrillType,
            operator,
            observed_rto_minutes: rto,
            observed_rpo_minutes: rpo,
            remediation_items: remediation,
        });
    }
    return drills;
}

function daysSince(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

async function fireWarning(title: string): Promise<void> {
    const url = process.env.BETTERSTACK_INCOMING_WEBHOOK;
    if (!url) {
        process.stderr.write(`check-dr-drill-cadence: WARNING (no webhook): ${title}\n`);
        return;
    }
    await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ severity: "warning", title }),
    });
}

async function main(): Promise<number> {
    let text: string;
    try {
        text = readFileSync(LOG_PATH, "utf8");
    } catch {
        process.stderr.write(`check-dr-drill-cadence: cannot read ${LOG_PATH}\n`);
        return 1;
    }

    const drills = parseDrills(text);
    const warnings: string[] = [];

    // Check cadence per drill type
    const latest: Record<DrillType, string | null> = { PITR: null, Snapshot: null, Rollback: null };
    for (const d of drills) {
        if (!latest[d.drill_type] || d.date > latest[d.drill_type]!) {
            latest[d.drill_type] = d.date;
        }
    }

    if (!latest.Snapshot || daysSince(latest.Snapshot) > 7) {
        warnings.push("Snapshot drill overdue (>7 days)");
    }
    if (!latest.PITR || daysSince(latest.PITR) > 90) {
        warnings.push("PITR drill overdue (>1 quarter)");
    }
    if (!latest.Rollback || daysSince(latest.Rollback) > 90) {
        warnings.push("Rollback drill overdue (>1 quarter)");
    }

    // Check RTO/RPO breaches without remediation
    for (const d of drills) {
        if ((d.observed_rto_minutes > 240 || d.observed_rpo_minutes > 60) && !d.remediation_items) {
            warnings.push(`${d.drill_type} on ${d.date}: RTO/RPO breach without remediation_items`);
        }
    }

    for (const w of warnings) {
        process.stderr.write(`check-dr-drill-cadence: ${w}\n`);
        await fireWarning(w);
    }

    return warnings.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
