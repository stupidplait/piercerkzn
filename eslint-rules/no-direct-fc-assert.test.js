"use strict";

const { RuleTester } = require("eslint");
const rule = require("./no-direct-fc-assert.js");

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-direct-fc-assert", rule, {
    valid: [
        // fcAssert wrapper call — not flagged
        { code: "fcAssert(fc.property(fc.integer(), () => {}))" },
        // fc.assert inside the wrapper file itself — not flagged
        {
            code: "fc.assert(property, { numRuns: 100 })",
            filename: "/project/src/test/property/fc-config.ts",
        },
        // fc.assert inside the wrapper file (Windows path)
        {
            code: "fc.assert(property, { numRuns: 100 })",
            filename: "C:\\Users\\dev\\project\\src\\test\\property\\fc-config.ts",
        },
        // Unrelated member expression
        { code: "other.assert(something)" },
    ],
    invalid: [
        // Direct fc.assert in a test file
        {
            code: "fc.assert(fc.property(fc.integer(), (n) => n >= 0))",
            filename: "/project/src/lib/cors.property.test.ts",
            errors: [{ messageId: "useWrapper" }],
        },
        // Direct fc.assert in another test file
        {
            code: "fc.assert(prop, { numRuns: 50 })",
            filename: "/project/src/lib/captcha/verify.property.test.ts",
            errors: [{ messageId: "useWrapper" }],
        },
    ],
});
