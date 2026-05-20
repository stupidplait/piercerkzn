/**
 * Verify the FTS index exists and runs against the seeded catalogue.
 *
 *   pnpm exec tsx scripts/db-fts-check.ts
 */
import "../src/db/load-env";
import postgres from "postgres";

async function main(): Promise<void> {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

    const idx = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='product' AND indexname='idx_product_search'
    `;
    console.log("idx_product_search:", idx[0]?.indexdef ?? "MISSING");

    const queries = ["титан", "золото", "циркон", "пупок"];
    for (const q of queries) {
        const rows = await sql<{ handle: string; rank: number }[]>`
            SELECT handle,
                   ts_rank_cd(
                       to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(description,'')),
                       plainto_tsquery('russian', ${q})
                   ) AS rank
            FROM product
            WHERE to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(description,''))
                  @@ plainto_tsquery('russian', ${q})
            ORDER BY rank DESC
            LIMIT 5
        `;
        console.log(`\nquery="${q}" → ${rows.length} hits`);
        for (const r of rows) {
            console.log(`  ${r.rank.toFixed(4)}  ${r.handle}`);
        }
    }

    await sql.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
