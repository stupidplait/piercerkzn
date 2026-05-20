"use strict";

// Local ESLint rule: `local/no-direct-fc-assert`.
//
// Per Requirement 11.5 of the public-form-abuse-hardening spec, every
// property test in this repo must run at minimum 100 fast-check iterations.
// That floor is enforced by the shared `fcAssert` wrapper exported from
// `src/test/property/fc-config.ts`, which is the ONLY legal call site for
// `fc.assert` in this repo. This rule flags any direct `fc.assert(...)`
// call elsewhere so a test cannot bypass the floor by calling fast-check
// directly.

const ALLOWED_FILE_SUFFIX = "src/test/property/fc-config.ts";

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
    meta: {
        type: "problem",
        docs: {
            description:
                "Disallow direct calls to `fc.assert` outside the shared `fcAssert` wrapper at `src/test/property/fc-config.ts`.",
            recommended: false,
        },
        schema: [],
        messages: {
            useWrapper:
                "Do not call `fc.assert` directly. Import `fcAssert` from `@/test/property/fc-config` (or the relative path) so the 100-run floor from Requirement 11.5 is enforced.",
        },
    },
    create(context) {
        const filename =
            (typeof context.filename === "string" && context.filename) ||
            (typeof context.getFilename === "function" && context.getFilename()) ||
            "";
        const normalized = String(filename).replace(/\\/g, "/");
        if (normalized.endsWith(ALLOWED_FILE_SUFFIX)) {
            return {};
        }
        return {
            "CallExpression[callee.type='MemberExpression'][callee.object.name='fc'][callee.property.name='assert']"(
                node,
            ) {
                context.report({ node, messageId: "useWrapper" });
            },
        };
    },
};

module.exports = rule;
