/**
 * Pure helpers used by `auth-customer-sync.ts`. Kept in a DB-free module so
 * unit tests can import them without booting the postgres client.
 */

/**
 * Split an Auth.js display name into the first/last fields stored on
 * `customer`. `customer.first_name` is NOT NULL, so we always return a
 * non-empty string — falling back to the email local-part (capitalised)
 * if the name is missing or whitespace-only.
 *
 * Both fields are clipped to 100 characters to match the column length.
 */
export function splitDisplayName(
    name: string | null | undefined,
    email: string
): { firstName: string; lastName: string | null } {
    const trimmed = (name ?? "").trim();
    if (trimmed.length > 0) {
        const parts = trimmed.split(/\s+/u);
        const first = parts.shift()!.slice(0, 100);
        const last = parts.length > 0 ? parts.join(" ").slice(0, 100) : null;
        return { firstName: first, lastName: last };
    }
    const local =
        email
            .split("@")[0]
            ?.replace(/[._-]+/gu, " ")
            .trim() || "Гость";
    const capitalised = local.charAt(0).toUpperCase() + local.slice(1);
    return { firstName: capitalised.slice(0, 100), lastName: null };
}

const KNOWN_OAUTH_PROVIDERS = new Set(["vk", "telegram"]);

/**
 * Map an Auth.js account provider to the value we store on
 * `customer.oauth_provider`. Returns `null` for sign-ins that are not
 * meaningful as long-term provider tags (Resend magic-link, raw email,
 * Credentials).
 */
export function mapOauthProvider(provider: string | null | undefined): string | null {
    if (!provider) return null;
    const p = provider.toLowerCase();
    if (KNOWN_OAUTH_PROVIDERS.has(p)) return p;
    if (p === "resend" || p === "email" || p === "credentials") return null;
    return p;
}

/**
 * `postgres` driver surfaces SQLSTATE on the error object. `23505` is the
 * unique-violation code; we use it to detect concurrent first-sign-in races
 * on the `customer.email` index.
 */
export function isUniqueViolation(err: unknown): boolean {
    const code = (err as { code?: string })?.code;
    return code === "23505";
}
