-- Russian-language full-text search index over product.title + description.
-- Backs the `search` filter on /api/products and unlocks `sort=relevance`.
-- Function-based GIN keeps the schema column-free; if write volume grows
-- we can promote this to a stored generated `search_vector` column later.
CREATE INDEX IF NOT EXISTS "idx_product_search" ON "product"
USING gin (
    to_tsvector(
        'russian',
        coalesce("title", '') || ' ' || coalesce("description", '')
    )
);
