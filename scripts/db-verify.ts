/**
 * One-off verification script: list public tables + applied Drizzle
 * migrations to confirm `pnpm db:migrate` reached the configured DB.
 *
 *   pnpm exec tsx scripts/db-verify.ts
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
    console.log(`public.* tables: ${tables.length}`);
    for (const t of tables) console.log("  -", t.tablename);

    const migrations = await sql<{ hash: string; created_at: bigint }[]>`
        SELECT hash, created_at
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at
    `;
    console.log(`\napplied migrations: ${migrations.length}`);
    for (const m of migrations) {
        const ts = new Date(Number(m.created_at)).toISOString();
        console.log("  -", m.hash.slice(0, 12), ts);
    }

    await sql.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
