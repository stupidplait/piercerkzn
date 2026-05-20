/**
 * Render React Email templates to {html, text} payloads suitable for
 * `sendEmail()`. `@react-email/render` walks the React tree and produces
 * inline-styled HTML + a text fallback.
 *
 * Kept as a thin re-export so call sites import a single helper:
 *
 *   import { renderEmail } from "@/emails/render";
 *   const { html, text } = await renderEmail(<Welcome ... />);
 */
import "server-only";

import { render } from "@react-email/render";
import type { ReactElement } from "react";

export async function renderEmail(node: ReactElement): Promise<{ html: string; text: string }> {
    const [html, text] = await Promise.all([
        render(node, { pretty: false }),
        render(node, { plainText: true }),
    ]);
    return { html, text };
}
