/**
 * Auth.js v5 catch-all route — handles /api/auth/*.
 * The actual configuration lives in `@/lib/auth`.
 */
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;

// Auth.js routes are dynamic (depend on cookies / search params).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
