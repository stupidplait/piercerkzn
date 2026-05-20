/**
 * One-off: row counts per public table to know what's seeded.
 *
 *   pnpm exec tsx scripts/db-counts.ts
 */
import "../src/db/load-env";
import postgres from "postgres";

async function main(): Promise<void> {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

    const tables = await sql<{ tablename: string }[]>`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
    `;

    const rows: { table: string; count: number }[] = [];
    for (const { tablename } of tables) {
        const [{ count }] = await sql<{ count: number }[]>`
            SELECT count(*)::int AS count FROM ${sql(tablename)}
        `;
        rows.push({ table: tablename, count });
    }

    rows.sort((a, b) => b.count - a.count || a.table.localeCompare(b.table));

    const pad = Math.max(...rows.map((r) => r.table.length));
    for (const r of rows) {
        console.log(r.table.padEnd(pad), r.count.toString().padStart(6));
    }

    await sql.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
