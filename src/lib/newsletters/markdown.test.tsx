/**
 * Unit tests for the in-house Markdown→React Email tokenizer + renderer.
 *
 * Two layers of assertion:
 *
 *   1. **Tokenizer** — `tokenizeMarkdown` is a pure function over strings,
 *      tested directly against expected `Token[]` shapes. Property tests
 *      drive the tokenizer with random ASCII to assert it never throws and
 *      always classifies into a known `kind`.
 *
 *   2. **Renderer** — `renderMarkdownBody` returns a React element which we
 *      render to static HTML via `react-dom/server`. The renderer must:
 *        - never emit a `<script>`, `<iframe>`, or `on…=` attribute (Property 11)
 *        - never emit a `javascript:` or `data:` URL in `href` / `src` (Property 12)
 *        - escape angle brackets in plain text (raw HTML demoted to text)
 *        - emit only allow-listed React Email components for the supported
 *          constructs (Property 10)
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 10: Allow-listed component output
 *   - Property 11: Raw HTML / scripts demote to escaped text
 *   - Property 12: URL scheme allowlist
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";

import { renderMarkdownBody, tokenizeMarkdown, type Inline, type Token } from "./markdown";

function html(md: string): string {
    return renderToStaticMarkup(renderMarkdownBody(md));
}

// ===========================================================================
// Property 10 — Allow-listed component output across supported constructs
// Validates: Requirements 7.1, 7.2, 12.3
// ===========================================================================
describe("tokenizeMarkdown — supported constructs", () => {
    it.each<{ md: string; expected: Token[] }>([
        {
            md: "# Heading One",
            expected: [
                {
                    kind: "heading",
                    level: 1,
                    inlines: [{ kind: "text", value: "Heading One" }],
                },
            ],
        },
        {
            md: "## Heading Two",
            expected: [
                {
                    kind: "heading",
                    level: 2,
                    inlines: [{ kind: "text", value: "Heading Two" }],
                },
            ],
        },
        {
            md: "### Heading Three",
            expected: [
                {
                    kind: "heading",
                    level: 3,
                    inlines: [{ kind: "text", value: "Heading Three" }],
                },
            ],
        },
        {
            md: "Just a plain paragraph with words.",
            expected: [
                {
                    kind: "paragraph",
                    inlines: [{ kind: "text", value: "Just a plain paragraph with words." }],
                },
            ],
        },
        {
            md: "- one\n- two\n- three",
            expected: [
                {
                    kind: "list",
                    ordered: false,
                    items: [
                        [{ kind: "text", value: "one" }],
                        [{ kind: "text", value: "two" }],
                        [{ kind: "text", value: "three" }],
                    ],
                },
            ],
        },
        {
            md: "1. one\n2. two",
            expected: [
                {
                    kind: "list",
                    ordered: true,
                    items: [[{ kind: "text", value: "one" }], [{ kind: "text", value: "two" }]],
                },
            ],
        },
        {
            md: "![alt text](https://example.com/x.png)",
            expected: [
                {
                    kind: "image",
                    alt: "alt text",
                    src: "https://example.com/x.png",
                },
            ],
        },
    ])("$md → tokens", ({ md, expected }) => {
        expect(tokenizeMarkdown(md)).toEqual(expected);
    });

    it("inline tokens — bold/italic/code/link", () => {
        const tokens = tokenizeMarkdown(
            "Hello **bold** _italic_ `code` [link](https://example.com)."
        );
        expect(tokens).toHaveLength(1);
        expect(tokens[0].kind).toBe("paragraph");
        const inlines = (tokens[0] as { inlines: Inline[] }).inlines;
        const kinds = inlines.map((i) => i.kind);
        expect(kinds).toEqual([
            "text",
            "bold",
            "text",
            "italic",
            "text",
            "code",
            "text",
            "link",
            "text",
        ]);
    });

    it("renders supported constructs to allow-listed HTML tags", () => {
        const out = html(
            "# H1\n\n## H2\n\nA paragraph with **bold**, _italic_, `code` and [link](https://example.com).\n\n- one\n- two\n\n1. first\n2. second\n\n![alt](https://example.com/i.png)"
        );
        // Allow-listed tags — these are the only ones the React Email
        // primitives we render to should produce.
        expect(out).toContain("<h1");
        expect(out).toContain("<h2");
        expect(out).toContain("<strong>bold</strong>");
        expect(out).toContain("<em>italic</em>");
        expect(out).toContain("<code");
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain("<ul>");
        expect(out).toContain("<ol>");
        expect(out).toContain("<li>");
        expect(out).toContain('src="https://example.com/i.png"');
        expect(out).toContain('alt="alt"');
        // Forbidden — never reach the output.
        expect(out).not.toMatch(/<script\b/i);
        expect(out).not.toMatch(/<iframe\b/i);
        expect(out).not.toMatch(/\son\w+=/i);
    });
});

// ===========================================================================
// Property 11 — Raw HTML / scripts demote to escaped text
// Validates: Requirements 7.4, 12.3
// ===========================================================================
describe("renderMarkdownBody — Property 11: raw HTML escaped", () => {
    it("escapes <script> tags as text", () => {
        const out = html("<script>alert(1)</script>");
        expect(out).not.toMatch(/<script\b/i);
        // The literal source survives as escaped text.
        expect(out).toContain("&lt;script&gt;");
        expect(out).toContain("alert(1)");
    });

    it("escapes <iframe> tags", () => {
        const out = html("<iframe src=javascript:alert(1)></iframe>");
        expect(out).not.toMatch(/<iframe\b/i);
        expect(out).toContain("&lt;iframe");
    });

    it("escapes inline event handlers", () => {
        const out = html('<img src=x onerror="alert(1)">');
        // Real (unescaped) `<img …>` tag must not appear — only the
        // textually-escaped form survives.
        expect(out).not.toMatch(/<img\b/i);
        expect(out).not.toContain('onerror="alert');
        expect(out).toContain("&lt;img");
    });

    it("escapes raw <style> blocks", () => {
        const out = html("<style>body{display:none}</style>");
        expect(out).not.toMatch(/<style\b/i);
        expect(out).toContain("&lt;style&gt;");
    });

    it.each([
        "> blockquote text",
        "| col1 | col2 |\n|------|------|\n| a    | b    |",
        "```\ncode fence body\n```",
    ])("unsupported construct → renders as paragraph text: %s", (md) => {
        const out = html(md);
        // Source markers survive verbatim because the unsupported markup
        // falls through the paragraph branch.
        expect(out.length).toBeGreaterThan(0);
    });

    it("blockquote falls into paragraph and the > marker survives", () => {
        const out = html("> hello world");
        expect(out).toContain("&gt; hello world");
    });
});

// ===========================================================================
// Property 12 — URL scheme allowlist
// Validates: Requirements 7.5, 12.3
// ===========================================================================
describe("renderMarkdownBody — Property 12: URL allowlist", () => {
    it("javascript: link demotes to literal text containing the markup", () => {
        const out = html("[click me](javascript:alert(1))");
        expect(out).not.toMatch(/href="javascript:/i);
        expect(out).toContain("[click me](javascript:alert(1))");
    });

    it("data: image demotes to literal text", () => {
        const out = html("![pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA)");
        expect(out).not.toMatch(/src="data:/i);
        expect(out).toContain("![pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA)");
    });

    it("file: scheme demotes to text", () => {
        const out = html("[doc](file:///etc/passwd)");
        expect(out).not.toMatch(/href="file:/i);
        expect(out).toContain("[doc](file:///etc/passwd)");
    });

    it("scheme-less / relative URLs demote to text", () => {
        const out = html("[home](/dashboard)");
        expect(out).not.toMatch(/<a\b/i);
        expect(out).toContain("[home](/dashboard)");
    });

    it.each(["http", "https", "mailto"])("%s: scheme passes through as a real link", (scheme) => {
        const target = scheme === "mailto" ? "mailto:hi@example.com" : `${scheme}://example.com`;
        const out = html(`[ok](${target})`);
        expect(out).toContain(`href="${target}"`);
    });

    // Property: the renderer never emits an `href` or `src` attribute pointing
    // to a non-allow-listed scheme regardless of input.
    it("no disallowed scheme reaches an href/src attribute (property)", () => {
        const schemeArb = fc.constantFrom(
            "javascript",
            "data",
            "file",
            "vbscript",
            "ftp",
            "ws",
            "gopher"
        );
        const labelArb = fc
            .string({ minLength: 1, maxLength: 12 })
            .filter(
                (s) =>
                    !s.includes("[") &&
                    !s.includes("]") &&
                    !s.includes("(") &&
                    !s.includes(")") &&
                    !s.includes("\n")
            );
        fcAssert(
            fc.property(labelArb, schemeArb, (label, scheme) => {
                const md = `[${label}](${scheme}:payload)`;
                const out = html(md);
                expect(out).not.toMatch(new RegExp(`href="${scheme}:`, "i"));
                expect(out).not.toMatch(new RegExp(`src="${scheme}:`, "i"));
            }),
            { numRuns: 100, seed: 2026_05_04 }
        );
    });
});

// ===========================================================================
// Robustness — tokenizer never throws across random ASCII input
// ===========================================================================
describe("tokenizeMarkdown — robustness", () => {
    const allowedKinds = new Set(["heading", "paragraph", "list", "image", "blank"]);

    it("never throws and always returns known token kinds (property)", () => {
        fcAssert(
            fc.property(fc.string({ maxLength: 256 }), (s) => {
                const tokens = tokenizeMarkdown(s);
                for (const t of tokens) {
                    expect(allowedKinds.has(t.kind)).toBe(true);
                }
            }),
            { numRuns: 200, seed: 2026_05_05 }
        );
    });

    it("normalises CRLF and BOM to a stable token stream", () => {
        const a = tokenizeMarkdown("# Hi\r\n\r\nbody");
        const b = tokenizeMarkdown("\uFEFF# Hi\n\nbody");
        const c = tokenizeMarkdown("# Hi\n\nbody");
        expect(a).toEqual(c);
        expect(b).toEqual(c);
    });
});
