/**
 * Mint a NextAuth session for a seeded customer through Playwright's
 * `request` context, mirroring the production login flow at
 * `src/app/auth/login/page.tsx`:
 *
 *   1. GET  /api/auth/csrf                  → returns `{ csrfToken }` and
 *                                             sets the `next-auth.csrf-token`
 *                                             cookie on the browser context.
 *   2. POST /api/auth/callback/credentials  → body is the form-encoded
 *                                             `{ email, password, csrfToken,
 *                                                callbackUrl, redirect:"false",
 *                                                json:"true" }` payload the
 *                                             customer-facing UI submits.
 *
 * Because `page.request` shares the cookie jar of the parent
 * `BrowserContext`, the `next-auth.session-token` cookie minted on a
 * successful POST is automatically attached to subsequent `page.goto()`
 * calls. No `context.addCookies()` / `context.storageState()` mutation,
 * no reaching into NextAuth internals — the helper goes through the
 * exact same Auth.js v5 credentials route a real browser would hit.
 *
 * Per AC 4.8, every Playwright spec that needs an authenticated session
 * MUST mint it via this helper (or another flow that calls the real
 * sign-in route) rather than mutating cookies directly.
 */
import type { Page } from "@playwright/test";

export interface SignInOptions {
    /**
     * Where Auth.js redirects on success. The credentials callback uses
     * this only to populate the `url` field of its JSON response — the
     * actual navigation is left to the caller. Defaults to `/account`,
     * matching `src/app/auth/login/page.tsx`.
     */
    callbackUrl?: string;
}

/**
 * Mint a NextAuth session cookie on `page.context()` by posting `email`
 * + `password` to the customer credentials provider. Throws on failure
 * so specs fail loudly rather than continuing unauthenticated.
 */
export async function signInAs(
    page: Page,
    email: string,
    password: string,
    options: SignInOptions = {}
): Promise<void> {
    const callbackUrl = options.callbackUrl ?? "/account";

    // 1. Fetch the CSRF token. Auth.js sets the `next-auth.csrf-token`
    //    cookie on this response, which `page.request` persists on the
    //    shared browser-context cookie jar.
    const csrfRes = await page.request.get("/api/auth/csrf");
    if (!csrfRes.ok()) {
        throw new Error(`signInAs: failed to fetch CSRF token (HTTP ${csrfRes.status()})`);
    }
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    // 2. Post the credentials payload. `redirect: "false"` + `json: "true"`
    //    matches the production login form in `auth/login/page.tsx`, so
    //    Auth.js returns `{ url }` instead of a 302 we'd then have to
    //    follow ourselves.
    const res = await page.request.post("/api/auth/callback/credentials", {
        form: {
            email,
            password,
            csrfToken,
            callbackUrl,
            redirect: "false",
            json: "true",
        },
    });
    if (!res.ok()) {
        const body = await res.text().catch(() => "");
        throw new Error(
            `signInAs: credentials POST failed (HTTP ${res.status()}): ${body.slice(0, 200)}`
        );
    }

    // Auth.js v5 returns 200 even for failed credentials, encoding the
    // failure as `?error=CredentialsSignin` in the `url` field. Parse it
    // to surface bad seed data as a thrown error rather than a silently
    // unauthenticated session.
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (data?.url?.includes("error=")) {
        throw new Error(`signInAs: credentials rejected — ${data.url}`);
    }
}
