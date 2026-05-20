/**
 * Auth.js v5 — module augmentation for Session / User / JWT.
 *
 * Adds the domain fields we attach in `auth.config.ts` callbacks:
 *   - `id`         — auth_user.id (token.sub)
 *   - `customerId` — domain customer.id (separate table)
 *   - `role`       — 'customer' | 'admin' | 'staff'
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            customerId?: string;
            role: "customer" | "admin" | "staff";
        } & DefaultSession["user"];
    }

    interface User {
        customerId?: string;
        role?: "customer" | "admin" | "staff";
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        customerId?: string;
        role?: "customer" | "admin" | "staff";
    }
}

export {};
