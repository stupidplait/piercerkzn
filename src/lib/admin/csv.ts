/**
 * Tiny CSV serializer for admin export endpoints.
 *
 * - RFC 4180-style escaping (quote when value contains comma / quote / newline)
 * - UTF-8 BOM prefix so Excel opens Russian text correctly
 * - Synchronous string assembly — fine for studio-scale exports (≤ tens of
 *   thousands of rows). Swap to a streaming writer if we ever cross that.
 */

const NEEDS_QUOTE_RE = /[",\r\n]/u;

function escape(cell: unknown): string {
    if (cell === null || cell === undefined) return "";
    const s = cell instanceof Date ? cell.toISOString() : String(cell);
    return NEEDS_QUOTE_RE.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvColumn<Row> {
    header: string;
    value: (row: Row) => unknown;
}

/**
 * Render `rows` as a UTF-8 BOM-prefixed CSV string.
 */
export function rowsToCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
    const header = columns.map((c) => escape(c.header)).join(",");
    const body = rows.map((row) => columns.map((c) => escape(c.value(row))).join(",")).join("\r\n");
    return `\uFEFF${header}\r\n${body}\r\n`;
}

/** Build a `Response` whose body is the CSV with appropriate headers. */
export function csvResponse(filename: string, body: string): Response {
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(body, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${safeName}"`,
            "Cache-Control": "no-store",
        },
    });
}
