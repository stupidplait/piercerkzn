/**
 * GET /api/categories — flat list of active product categories.
 *
 * Read-through cached via `getActiveCategoriesCached()` (TTL 10 min with
 * ±10% jitter + SWR). Admin save paths invalidate the cache.
 */
import { internal, ok } from "@/lib/api";
import { getActiveCategoriesCached } from "@/lib/products/catalog-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const categories = await getActiveCategoriesCached();
        return ok({ categories });
    } catch (error) {
        console.error("[/api/categories] failed", error);
        return internal();
    }
}
