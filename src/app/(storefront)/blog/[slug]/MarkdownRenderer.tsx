/**
 * MarkdownRenderer — renders Markdown content as HTML.
 *
 * The blog post `content` field stores Markdown text. This component
 * converts it to HTML and renders it within a styled container.
 * For simple Markdown without external dependencies, we use a lightweight
 * regex-based parser. For production with complex content, consider
 * replacing with `react-markdown` or `unified`.
 */

import styles from "./blog-post.module.css";

// ---------------------------------------------------------------------------
// Lightweight Markdown → HTML converter
// ---------------------------------------------------------------------------

function markdownToHtml(markdown: string): string {
    let html = markdown;

    // Normalize line endings
    html = html.replace(/\r\n/g, "\n");

    // Code blocks (fenced)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
        const escaped = escapeHtml(code.trimEnd());
        return `<pre><code>${escaped}</code></pre>`;
    });

    // Inline code (before other inline processing)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Headings
    html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

    // Horizontal rules
    html = html.replace(/^---$/gm, "<hr>");
    html = html.replace(/^\*\*\*$/gm, "<hr>");

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');

    // Links
    html = html.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

    // Unordered lists
    html = html.replace(/(?:^[-*] .+\n?)+/gm, (match) => {
        const items = match
            .trim()
            .split("\n")
            .map((line) => `<li>${line.replace(/^[-*] /, "")}</li>`)
            .join("\n");
        return `<ul>\n${items}\n</ul>`;
    });

    // Ordered lists
    html = html.replace(/(?:^\d+\. .+\n?)+/gm, (match) => {
        const items = match
            .trim()
            .split("\n")
            .map((line) => `<li>${line.replace(/^\d+\. /, "")}</li>`)
            .join("\n");
        return `<ol>\n${items}\n</ol>`;
    });

    // Paragraphs: wrap remaining text blocks
    html = html
        .split("\n\n")
        .map((block) => {
            const trimmed = block.trim();
            if (!trimmed) return "";
            // Don't wrap blocks that are already HTML elements
            if (
                trimmed.startsWith("<h") ||
                trimmed.startsWith("<ul") ||
                trimmed.startsWith("<ol") ||
                trimmed.startsWith("<blockquote") ||
                trimmed.startsWith("<pre") ||
                trimmed.startsWith("<hr") ||
                trimmed.startsWith("<img")
            ) {
                return trimmed;
            }
            return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
        })
        .join("\n\n");

    return html;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MarkdownRendererProps {
    content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
    // Try to detect if content is JSON (Lexical rich-text)
    // If it starts with { or [, treat as plain text fallback
    let html: string;

    if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
        // Rich-text JSON — render as plain text for now
        // In production, integrate a Lexical renderer
        try {
            const parsed = JSON.parse(content);
            // Extract text from Lexical-style JSON
            html = `<p>${extractTextFromRichText(parsed)}</p>`;
        } catch {
            // If JSON parsing fails, treat as markdown
            html = markdownToHtml(content);
        }
    } else {
        html = markdownToHtml(content);
    }

    return <div className={styles.markdownContent} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------
// Rich-text JSON text extraction (basic Lexical support)
// ---------------------------------------------------------------------------

function extractTextFromRichText(data: unknown): string {
    if (!data || typeof data !== "object") return "";

    const obj = data as Record<string, unknown>;

    // Lexical root → children
    if (obj.root && typeof obj.root === "object") {
        return extractTextFromRichText(obj.root);
    }

    // Node with children array
    if (Array.isArray(obj.children)) {
        return (obj.children as unknown[])
            .map((child) => {
                if (typeof child === "string") return child;
                if (typeof child === "object" && child !== null) {
                    const c = child as Record<string, unknown>;
                    if (c.text && typeof c.text === "string") return c.text;
                    return extractTextFromRichText(c);
                }
                return "";
            })
            .join(" ");
    }

    if (obj.text && typeof obj.text === "string") return obj.text;

    return "";
}
