/**
 * Site-wide constants — single source of truth for studio contact info,
 * external destinations, and brand metadata. Swap these values when the
 * real Telegram bot / domain / contacts come online.
 */
export const SITE = {
    telegram: "https://t.me/piercerkzn",
    instagram: "https://instagram.com/piercer.kzn",
    email: "hello@piercerkzn.ru",
    phone: "+7 (843) 000-00-00",
    address: "Баумана 38 · Казань",
    foundedYear: 2016,
} as const;
