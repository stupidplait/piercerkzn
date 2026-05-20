/**
 * Cron-route auth helper.
 *
 * Vercel Cron requests carry an `Authorization: Bearer <CRON_SECRET>` header
 * (the secret comes from `CRON_SECRET` env). For local dev we accept either
 * the header or `?key=` query param; in production the env var is required.
 *
 * Spec: https://vercel.com/docs/cron-jobs#securing-cron-jobs
 */
import "server-only";

export function isAuthorizedCron(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        // Dev mode without a secret — block in production-like environments.
        return process.env.NODE_ENV !== "production";
    }
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;

    if (process.env.NODE_ENV !== "production") {
        const url = new URL(req.url);
        if (url.searchParams.get("key") === secret) return true;
    }
    return false;
}
