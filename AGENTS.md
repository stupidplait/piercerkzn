<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:design-context -->

# Design Context

Before any UI or visual work, read [../PRODUCT.md](../PRODUCT.md) (strategic: register, users, voice, anti-references, principles) and [../DESIGN.md](../DESIGN.md) (visual: tokens, typography, components, do's/don'ts). The canonical design lives at [src/app/new-design/](src/app/new-design/); variants at `src/app/page12/` and `src/app/new-design-copy/` are preserved as an idea bank, not dead code.

The skill `.agents/skills/impeccable/` defines the design vocabulary — load `node .agents/skills/impeccable/scripts/load-context.mjs` once per session to refresh PRODUCT.md / DESIGN.md into context.

<!-- END:design-context -->
