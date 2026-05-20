/**
 * Newsletter body Markdown → React Email renderer.
 *
 * This is a hand-rolled, deliberately minimal renderer. The security surface
 * needs to stay auditable, so we don't pull in a third-party Markdown library:
 *
 * - The tokenizer never branches on `<`, so raw `<script>`, `<style>`,
 *   `<iframe>`, and `onfoo=` content survives only as escaped text inside a
 *   JSX child (Requirement 7.4).
 * - We never call `dangerouslySetInnerHTML`. React handles all escaping by
 *   construction.
 * - Link and image URLs go through a strict scheme allowlist
 *   (`http`/`https`/`mailto`); any other scheme demotes back to the original
 *   `[label](href)` / `![alt](src)` literal as plain text (Requirement 7.5).
 * - Unsupported constructs (blockquote, table, code fence, raw HTML, …)
 *   classify as `paragraph` so they render as plain prose with the source
 *   markers visible (Requirement 7.3).
 *
 * Used both server-side from `processRecipientJob` and indirectly inside the
 * React Email render pipeline. No `"use client"` — the module is pure
 * server-render.
 */
import "server-only";
import { Fragment, type ReactElement, type ReactNode } from "react";
import { Heading, Img, Link, Section, Text } from "@react-email/components";

// ---------------------------------------------------------------------------
// Token model (Requirement 7.1)
// ---------------------------------------------------------------------------

export type Inline =
    | { kind: "text"; value: string }
    | { kind: "bold"; inlines: Inline[] }
    | { kind: "italic"; inlines: Inline[] }
    | { kind: "code"; value: string }
    | { kind: "link"; href: string; inlines: Inline[] };

export type Token =
    | { kind: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
    | { kind: "paragraph"; inlines: Inline[] }
    | { kind: "list"; ordered: boolean; items: Inline[][] }
    | { kind: "image"; alt: string; src: string }
    | { kind: "blank" };

// ---------------------------------------------------------------------------
// URL scheme allowlist (Requirement 7.5)
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * `true` only when `url` starts with a recognised scheme from the allowlist.
 * Relative or scheme-less URLs return `false` — outbound newsletter emails
 * have no concept of "relative", so any href without an explicit scheme is
 * treated the same as a `javascript:` payload and demoted to plain text.
 */
function isAllowedUrl(url: string): boolean {
    const m = /^([a-zA-Z][a-zA-Z0-9+\-.]*):/.exec(url);
    if (!m) return false;
    return ALLOWED_SCHEMES.has(m[1].toLowerCase());
}

// ---------------------------------------------------------------------------
// Pipeline step 1 — Normalize
// ---------------------------------------------------------------------------

function normalize(md: string): string {
    // Strip a leading BOM if present.
    let s = md.charCodeAt(0) === 0xfeff ? md.slice(1) : md;
    // CRLF / lone CR → LF.
    s = s.replace(/\r\n?/g, "\n");
    // Unicode normalisation so visually-identical strings tokenise the same.
    if (typeof s.normalize === "function") {
        s = s.normalize("NFC");
    }
    return s;
}

// ---------------------------------------------------------------------------
// Pipeline step 2 — Block split (split on blank-line groups)
// ---------------------------------------------------------------------------

function splitBlocks(md: string): string[] {
    // Trim outer whitespace so leading/trailing blank lines don't yield empty
    // blocks. Internal blocks are separated by one or more blank lines.
    const trimmed = md.replace(/^\n+/, "").replace(/\n+$/, "");
    if (!trimmed) return [];
    return trimmed.split(/\n{2,}/);
}

// ---------------------------------------------------------------------------
// Pipeline step 3 — Block classify
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const LIST_ITEM_RE = /^(?:[-*]|\d+\.)\s+(.*)$/;
const ORDERED_MARKER_RE = /^\d+\./;
const LONE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

function classifyBlock(block: string): Token {
    // Lone image: a single trimmed line of the form `![alt](src)`. URL scheme
    // is gated by the allowlist; failing schemes demote the whole block to a
    // paragraph carrying the original literal.
    const trimmed = block.trim();
    const imgMatch = LONE_IMAGE_RE.exec(trimmed);
    if (imgMatch && !trimmed.includes("\n")) {
        const [, alt, src] = imgMatch;
        if (isAllowedUrl(src)) {
            return { kind: "image", alt, src };
        }
        return { kind: "paragraph", inlines: [{ kind: "text", value: trimmed }] };
    }

    // Heading: only when the entire block is a single `# … ` line.
    const headingMatch = HEADING_RE.exec(trimmed);
    if (headingMatch && !trimmed.includes("\n")) {
        const level = headingMatch[1].length as 1 | 2 | 3;
        return {
            kind: "heading",
            level,
            inlines: inlineTokenize(headingMatch[2]),
        };
    }

    // List: the first line matches a list marker. Subsequent lines are either
    // additional list items (when they themselves are markers) or
    // continuations folded into the previous item with a space separator.
    const lines = block.split("\n");
    const firstItemMatch = LIST_ITEM_RE.exec(lines[0]);
    if (firstItemMatch) {
        const ordered = ORDERED_MARKER_RE.test(lines[0]);
        const items: string[] = [firstItemMatch[1]];
        for (let i = 1; i < lines.length; i++) {
            const m = LIST_ITEM_RE.exec(lines[i]);
            if (m) {
                items.push(m[1]);
            } else if (items.length > 0) {
                items[items.length - 1] += " " + lines[i].trim();
            }
        }
        return {
            kind: "list",
            ordered,
            items: items.map((item) => inlineTokenize(item)),
        };
    }

    // Default — paragraph. Internal newlines collapse to single spaces so
    // wrapped prose flows naturally; the markers of any unsupported construct
    // (blockquote `> `, table `|...|`, fence ` ``` `, raw HTML) survive
    // verbatim because we never branched on them.
    const paragraphText = lines
        .map((l) => l.trim())
        .join(" ")
        .trim();
    return { kind: "paragraph", inlines: inlineTokenize(paragraphText) };
}

// ---------------------------------------------------------------------------
// Pipeline step 4 — Inline tokenize
// ---------------------------------------------------------------------------

const INLINE_LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)\)/;

function inlineTokenize(text: string): Inline[] {
    const out: Inline[] = [];
    let buf = "";
    let i = 0;

    const flushBuf = () => {
        if (buf.length > 0) {
            out.push({ kind: "text", value: buf });
            buf = "";
        }
    };

    while (i < text.length) {
        const rest = text.slice(i);

        // 1. Link `[label](href)`. URL gate (Requirement 7.5): unsupported
        //    schemes demote to literal text containing the original markup.
        const linkMatch = INLINE_LINK_RE.exec(rest);
        if (linkMatch) {
            const [whole, label, href] = linkMatch;
            if (isAllowedUrl(href)) {
                flushBuf();
                out.push({
                    kind: "link",
                    href,
                    inlines: inlineTokenize(label),
                });
            } else {
                buf += whole;
            }
            i += whole.length;
            continue;
        }

        // 2. Bold `**...**`. Tried before italic so the `**` opener can't be
        //    misread as two italic stars.
        if (rest.startsWith("**")) {
            const end = text.indexOf("**", i + 2);
            if (end !== -1 && end > i + 2) {
                const inner = text.slice(i + 2, end);
                flushBuf();
                out.push({ kind: "bold", inlines: inlineTokenize(inner) });
                i = end + 2;
                continue;
            }
        }

        // 3. Italic `*...*` or `_..._`. Skip if the next character is the
        //    same delimiter — that's a bold opener (handled above) or a
        //    heavy-underscore variant we don't support.
        const ch = text[i];
        if ((ch === "*" || ch === "_") && text[i + 1] !== ch) {
            const end = text.indexOf(ch, i + 1);
            if (end !== -1 && end > i + 1) {
                const inner = text.slice(i + 1, end);
                flushBuf();
                out.push({
                    kind: "italic",
                    inlines: inlineTokenize(inner),
                });
                i = end + 1;
                continue;
            }
        }

        // 4. Inline code `` `...` ``.
        if (ch === "`") {
            const end = text.indexOf("`", i + 1);
            if (end !== -1 && end > i + 1) {
                const inner = text.slice(i + 1, end);
                flushBuf();
                out.push({ kind: "code", value: inner });
                i = end + 1;
                continue;
            }
        }

        // 5. Default — accumulate as plain text. The buffer is the only path
        //    by which `<`, `>`, and other source characters reach the
        //    rendered output, and they reach it as JSX children which React
        //    escapes by construction.
        buf += ch;
        i++;
    }

    flushBuf();
    return out;
}

// ---------------------------------------------------------------------------
// Public tokenizer
// ---------------------------------------------------------------------------

export function tokenizeMarkdown(md: string): Token[] {
    const normalized = normalize(md);
    const blocks = splitBlocks(normalized);
    return blocks.map(classifyBlock);
}

// ---------------------------------------------------------------------------
// Renderer (Requirement 7.2)
// ---------------------------------------------------------------------------

const HEADING_STYLE = {
    1: { fontSize: 24, fontWeight: 600, margin: "16px 0 8px" } as const,
    2: { fontSize: 20, fontWeight: 600, margin: "16px 0 8px" } as const,
    3: { fontSize: 16, fontWeight: 600, margin: "12px 0 6px" } as const,
};

const PARAGRAPH_STYLE = {
    fontSize: 14,
    margin: "0 0 12px",
    lineHeight: 1.55,
} as const;

const CODE_STYLE = {
    fontFamily: '"JetBrains Mono", monospace',
} as const;

const IMAGE_STYLE = { maxWidth: "100%" } as const;

function renderInline(inlines: Inline[]): ReactNode {
    return inlines.map((node, index) => {
        switch (node.kind) {
            case "text":
                return <Fragment key={index}>{node.value}</Fragment>;
            case "bold":
                return <strong key={index}>{renderInline(node.inlines)}</strong>;
            case "italic":
                return <em key={index}>{renderInline(node.inlines)}</em>;
            case "code":
                return (
                    <code key={index} style={CODE_STYLE}>
                        {node.value}
                    </code>
                );
            case "link":
                return (
                    <Link key={index} href={node.href}>
                        {renderInline(node.inlines)}
                    </Link>
                );
        }
    });
}

function renderToken(token: Token, key: number): ReactNode {
    switch (token.kind) {
        case "heading": {
            const tag = `h${token.level}` as "h1" | "h2" | "h3";
            return (
                <Heading key={key} as={tag} style={HEADING_STYLE[token.level]}>
                    {renderInline(token.inlines)}
                </Heading>
            );
        }
        case "paragraph":
            return (
                <Text key={key} style={PARAGRAPH_STYLE}>
                    {renderInline(token.inlines)}
                </Text>
            );
        case "list": {
            // React Email has no list primitive; raw `<ol>` / `<ul>` inside a
            // `<Section>` is the documented escape hatch.
            const items = token.items.map((item, idx) => (
                <li key={idx}>
                    <Text style={PARAGRAPH_STYLE}>{renderInline(item)}</Text>
                </li>
            ));
            return (
                <Section key={key}>{token.ordered ? <ol>{items}</ol> : <ul>{items}</ul>}</Section>
            );
        }
        case "image":
            return <Img key={key} src={token.src} alt={token.alt} style={IMAGE_STYLE} />;
        case "blank":
            return null;
    }
}

export function renderMarkdownBody(md: string): ReactElement {
    const tokens = tokenizeMarkdown(md);
    return <>{tokens.map((token, index) => renderToken(token, index))}</>;
}
