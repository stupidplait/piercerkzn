/**
 * Replaces direct `fc.assert(` calls with `fcAssert(` in test files,
 * adding the import if not already present.
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// Find all test files with fc.assert
const files = execSync(
  'git grep -l "fc\\.assert(" -- "src/**/*.test.ts" "src/**/*.test.tsx"',
  { encoding: "utf-8", cwd: "." }
).trim().split("\n").filter(Boolean);

// Exclude the fc-config.ts file itself (it's the only legal call site)
const targets = files.filter(f => !f.includes("fc-config"));

console.log(`Found ${targets.length} files to fix`);

for (const file of targets) {
  let content = readFileSync(file, "utf-8");
  
  // Skip if already uses fcAssert
  if (content.includes("fcAssert(") && !content.includes("fc.assert(")) {
    console.log(`  SKIP ${file} (already uses fcAssert)`);
    continue;
  }

  // Replace fc.assert( with fcAssert(
  // Handle both `fc.assert(` and `await fc.assert(`
  content = content.replace(/\bfc\.assert\(/g, "fcAssert(");

  // Check if fcAssert is already imported
  const hasFcAssertImport = /import\s+.*\bfcAssert\b/.test(content) ||
                            /\{\s*[^}]*\bfcAssert\b[^}]*\}/.test(content);

  if (!hasFcAssertImport) {
    // Check if there's already an import from fc-config
    const fcConfigImportRe = /import\s+\{([^}]*)\}\s+from\s+["']@\/test\/property\/fc-config["'];?/;
    const match = content.match(fcConfigImportRe);
    if (match) {
      // Add fcAssert to existing import
      const existingImports = match[1];
      content = content.replace(fcConfigImportRe, `import { ${existingImports.trim()}, fcAssert } from "@/test/property/fc-config";`);
    } else {
      // Check for relative path import
      const relFcConfigRe = /import\s+\{([^}]*)\}\s+from\s+["']\.\.?\/[^"']*fc-config["'];?/;
      const relMatch = content.match(relFcConfigRe);
      if (relMatch) {
        const existingImports = relMatch[1];
        content = content.replace(relFcConfigRe, (m) => m.replace("{" + existingImports + "}", `{ ${existingImports.trim()}, fcAssert }`));
      } else {
        // Add new import after the last import statement
        const lastImportIdx = content.lastIndexOf("\nimport ");
        if (lastImportIdx !== -1) {
          const endOfLine = content.indexOf("\n", lastImportIdx + 1);
          // Find the actual end of this import (could be multi-line)
          let insertPos = endOfLine;
          // Simple heuristic: find next line that starts with import or is blank
          const lines = content.split("\n");
          let lineIdx = content.substring(0, lastImportIdx + 1).split("\n").length - 1;
          // Walk forward to find end of import block
          while (lineIdx < lines.length - 1) {
            lineIdx++;
            const line = lines[lineIdx];
            if (line.startsWith("import ") || line.trim() === "" || line.startsWith("//") || line.startsWith("/*")) {
              if (line.startsWith("import ")) continue;
              break;
            }
            // Multi-line import continuation
            if (line.includes(" from ")) break;
          }
          insertPos = lines.slice(0, lineIdx).join("\n").length;
          content = content.slice(0, insertPos) + '\nimport { fcAssert } from "@/test/property/fc-config";' + content.slice(insertPos);
        } else {
          // No imports at all, add at top after any comments/directives
          content = 'import { fcAssert } from "@/test/property/fc-config";\n' + content;
        }
      }
    }
  }

  // Also check: if `fc` is imported from fast-check and fcAssert is now the only usage,
  // we still need `fc` for fc.property, fc.asyncProperty, etc. So keep it.

  writeFileSync(file, content);
  console.log(`  FIXED ${file}`);
}

console.log("\nDone!");
