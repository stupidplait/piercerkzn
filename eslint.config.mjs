import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Local ESLint rules live as CommonJS modules under `eslint-rules/` so they
// can be loaded from this ESM config without a build step. See
// `eslint-rules/no-direct-fc-assert.js` for the rule body and Requirement
// 11.5 of the public-form-abuse-hardening spec for the rationale.
const require = createRequire(import.meta.url);
const noDirectFcAssertRule = require("./eslint-rules/no-direct-fc-assert.js");

const localPlugin = {
    rules: {
        "no-direct-fc-assert": noDirectFcAssertRule,
    },
};

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        ".next/**",
        "out/**",
        "build/**",
        "next-env.d.ts",
    ]),
    {
        // Forbid direct `fc.assert(...)` calls in test files. The shared
        // wrapper at `src/test/property/fc-config.ts` is the only legal
        // call site (it allow-lists itself by filename suffix).
        files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        plugins: { local: localPlugin },
        rules: {
            "local/no-direct-fc-assert": "error",
        },
    },
    {
        // Three.js / R3F components legitimately mutate buffers and refs
        // inside useFrame callbacks. The React Compiler immutability and
        // purity rules produce false positives for this pattern.
        // Experimental design pages also use setState-in-effect for
        // animation state machines which is intentional.
        files: [
            "src/app/new-design/**",
            "src/app/new-design-cinematic/**",
            "src/app/new-design-editorial/**",
            "src/app/new-design-copy/**",
            "src/app/page12/**",
            "src/app/carousel-lab/**",
            "src/app/storytelling-lab/**",
        ],
        rules: {
            "react-hooks/immutability": "off",
            "react-hooks/purity": "off",
            "react-hooks/set-state-in-effect": "off",
            "react-hooks/refs": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@next/next/no-html-link-for-pages": "off",
        },
    },
    {
        // Storefront components that sync local state with URL params or
        // external APIs (embla carousel, nuqs) use setState in effects
        // intentionally. The admin layout uses it for hydration detection.
        // The visualizer mini-app context initializes from the Telegram SDK.
        files: [
            "src/app/(storefront)/**",
            "src/app/admin/layout.tsx",
            "src/components/visualizer/mini-app-context.tsx",
        ],
        rules: {
            "react-hooks/set-state-in-effect": "warn",
        },
    },
    {
        // Test files and seed scripts use `as any` for mocking and
        // dynamic table references. This is acceptable in non-production code.
        files: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "src/**/*.integration.test.ts",
            "src/db/seed.ts",
        ],
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
    {
        // E2E setup/teardown scripts use require() for conditional imports
        // and dynamic module loading which is standard in Playwright configs.
        files: [
            "e2e/**",
        ],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
]);

export default eslintConfig;
