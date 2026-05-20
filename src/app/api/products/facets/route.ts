/**
 * GET /api/products/facets
 *
 * Filter-sidebar aggregates for the catalogue:
 *   - distinct materials with counts
 *   - distinct jewelry types with counts
 *   - distinct piercing areas with counts
 *   - price bounds (min/max RUB across active variants)
 *   - total count of published products
 *
 * Read-through cached for 10 minutes via `getProductFacetsCached()` (±10%
 * jitter + SWR grace). Admin product / category save paths invalidate.
 */
import { internal, ok } from "@/lib/api";
import { getProductFacetsCached } from "@/lib/products/catalog-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const facets = await getProductFacetsCached();
        return ok(facets);
    } catch (error) {
        console.error("[/api/products/facets] failed", error);
        return internal();
    }
}
