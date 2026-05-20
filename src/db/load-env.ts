/**
 * Side-effect module — loads .env.local then .env into process.env.
 *
 * Must be imported BEFORE any module that reads env vars at top level
 * (e.g. ./index, which initializes the postgres client at import time).
 *
 * ESM evaluates imports in source order, so this file's side effects run
 * before downstream imports — unlike inline `config()` calls in the same
 * file, which are hoisted below the imports.
 *
 * Mirrors Next.js env loading order: .env.local takes precedence.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
