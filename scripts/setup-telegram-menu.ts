/**
 * One-shot setup: register the Telegram WebApp chat menu button so
 * customers can open the 3D visualizer Mini-App with a single tap.
 *
 * Run once per environment after deploy:
 *
 *   pnpm exec tsx scripts/setup-telegram-menu.ts
 *
 * Reads:
 *   TELEGRAM_BOT_TOKEN     — from BotFather (same one used by `@/lib/telegram/bot`)
 *   NEXT_PUBLIC_SITE_URL   — public origin (must be HTTPS for Telegram)
 *   TG_MENU_BUTTON_TEXT    — optional override (default "3D-примерка")
 *   TG_MENU_BUTTON_PATH    — optional override (default "/visualizer?tgmini=1")
 *
 * What this does:
 *   - Calls `setChatMenuButton` with a `web_app` type pointing at the
 *     visualizer URL. The query flag `tgmini=1` makes the page strip its
 *     public chrome (see `@/lib/telegram/mini-app`).
 *   - Calls `setMyCommands` so /my_reservations, /my_appointments, /help
 *     appear in Telegram's command picker.
 *
 * Idempotent — re-running just overwrites the same configuration.
 */
import "../src/db/load-env";

interface MenuButtonResponse {
    ok: boolean;
    description?: string;
}

async function call<T>(method: string, body: unknown, token: string): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const json = (await res.json()) as T & MenuButtonResponse;
    if (!json.ok) {
        throw new Error(`Telegram ${method} failed: ${json.description ?? "(no description)"}`);
    }
    return json;
}

async function main(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        throw new Error("TELEGRAM_BOT_TOKEN is not set. See .env.example.");
    }
    const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/u, "");
    if (!origin || !origin.startsWith("https://")) {
        throw new Error(
            "NEXT_PUBLIC_SITE_URL must be set to an HTTPS origin (Telegram refuses non-HTTPS Web Apps)."
        );
    }
    const path = process.env.TG_MENU_BUTTON_PATH ?? "/visualizer?tgmini=1";
    const text = process.env.TG_MENU_BUTTON_TEXT ?? "3D-примерка";
    const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;

    console.log(`Registering menu button → ${url}`);
    await call(
        "setChatMenuButton",
        {
            menu_button: {
                type: "web_app",
                text,
                web_app: { url },
            },
        },
        token
    );

    console.log("Registering /commands");
    await call(
        "setMyCommands",
        {
            commands: [
                { command: "start", description: "Привязать чат к профилю" },
                { command: "visualizer", description: "Открыть 3D-примерку" },
                { command: "my_reservations", description: "Мои брони" },
                { command: "my_appointments", description: "Мои записи" },
                { command: "help", description: "Подсказка" },
            ],
        },
        token
    );

    console.log("✓ Telegram menu + commands registered.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
