import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local first (gitignored, takes precedence), then .env as fallback.
// Mirrors Next.js env loading order so drizzle-kit CLI sees the same vars as the app.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
    schema: "./src/db/schema/index.ts",
    out: "./src/db/migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
    verbose: true,
    strict: true,
});
