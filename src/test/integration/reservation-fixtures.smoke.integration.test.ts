import { describe, it } from "vitest";
import { sql } from "drizzle-orm";

import { db, products, productVariants, customers, reservations } from "@/db";
import { expectRowCountUnchanged } from "@/test/integration/helpers";
import {
    seedReservationFixtures,
    cleanupReservationRows,
} from "@/test/integration/reservation-fixtures";

async function snapshotCounts(): Promise<Record<string, number>> {
    const [[p], [v], [c], [r]] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(products),
        db.select({ count: sql<number>`count(*)::int` }).from(productVariants),
        db.select({ count: sql<number>`count(*)::int` }).from(customers),
        db.select({ count: sql<number>`count(*)::int` }).from(reservations),
    ]);
    return {
        products: p.count,
        productVariants: v.count,
        customers: c.count,
        reservations: r.count,
    };
}

describe("reservation-fixtures smoke", () => {
    it("seed + cleanup leaves row counts unchanged", async () => {
        const before = await snapshotCounts();
        await seedReservationFixtures("phase1-smoke");
        await cleanupReservationRows("phase1-smoke");
        const after = await snapshotCounts();
        expectRowCountUnchanged(before, after);
    });
});
