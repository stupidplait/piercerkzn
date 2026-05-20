/**
 * Outbound Telegram notifications.
 *
 * These are called from Server Actions and route handlers after a domain
 * event (reservation created, appointment confirmed, etc.). They look up
 * the customer's linked telegram chat id and send a formatted message.
 *
 * Failures are swallowed (logged) — we never want to roll back a domain
 * event because Telegram was unreachable.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db, notificationLogs, telegramBotUsers, type Appointment, type Reservation } from "@/db";
import { capture } from "@/lib/posthog";
import { formatStudioDateTime } from "@/lib/booking/time";
import type { AftercareStep } from "@/lib/aftercare/time";
import type { BookingReminderKind } from "@/emails/booking-reminder";
import { getBot } from "./bot";

interface SendOptions {
    /**
     * `notification_log` audit row written after a successful send. Skipped
     * when omitted — used by transient pushes (e.g. confirmations) where
     * we already have a separate audit pipe (PostHog + email log).
     */
    log?: {
        type: string;
        metadata?: Record<string, unknown>;
    };
}

async function sendToCustomer(
    customerId: string,
    text: string,
    options: SendOptions = {}
): Promise<boolean> {
    try {
        const [user] = await db
            .select({
                telegramId: telegramBotUsers.telegramId,
                notificationsEnabled: telegramBotUsers.notificationsEnabled,
            })
            .from(telegramBotUsers)
            .where(eq(telegramBotUsers.customerId, customerId))
            .limit(1);
        if (!user || !user.notificationsEnabled) return false;
        const bot = getBot();
        await bot.api.sendMessage(user.telegramId, text, { parse_mode: "HTML" });
        if (options.log) {
            await db
                .insert(notificationLogs)
                .values({
                    customerId,
                    channel: "telegram",
                    type: options.log.type,
                    recipient: String(user.telegramId),
                    contentPreview: text.replace(/<[^>]*>/g, "").slice(0, 500),
                    status: "sent",
                    metadata: options.log.metadata ?? {},
                })
                .catch((err) => {
                    // Audit miss is preferable to a duplicate send — never
                    // surface this to the caller.
                    console.error("[telegram] notification_log insert failed", err);
                });
        }
        return true;
    } catch (err) {
        console.error("[telegram] sendToCustomer failed", err);
        return false;
    }
}

function formatRub(kopecks: number): string {
    return `${(kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}\u00A0₽`;
}

export async function notifyReservationCreated(
    reservation: Reservation,
    options: { itemTitles: string[] } = { itemTitles: [] }
): Promise<void> {
    if (!reservation.customerId) return;
    const expiresAt = reservation.expiresAt
        .toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour12: false })
        .replace(",", "");
    const items = options.itemTitles
        .slice(0, 5)
        .map((t) => `• ${t}`)
        .join("\n");
    const more = options.itemTitles.length > 5 ? `\n…и ещё ${options.itemTitles.length - 5}` : "";
    const text =
        `<b>Бронь принята</b>\n` +
        `${reservation.referenceNumber}\n\n` +
        `${items}${more}\n\n` +
        `Сумма к оплате при визите: <b>${formatRub(reservation.total)}</b>\n` +
        `Действует до: <b>${expiresAt}</b>`;
    const ok = await sendToCustomer(reservation.customerId, text);
    if (ok) {
        capture({
            event: "telegram_notification_sent",
            distinctId: reservation.customerId,
            properties: { kind: "reservation_created", reference: reservation.referenceNumber },
        });
    }
}

/**
 * "Bronze about to expire" push. Fired by the daily cron sweeper for
 * reservations whose `expiresAt` falls within the next ~24h.
 *
 * Writes a `notification_log` row keyed by `reservationId` so re-ticks
 * never produce a duplicate push. Returns `true` only on actual delivery.
 */
export async function notifyReservationExpiring(reservation: Reservation): Promise<boolean> {
    if (!reservation.customerId) return false;
    const expiresAt = reservation.expiresAt
        .toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour12: false })
        .replace(",", "");
    const text =
        `<b>Бронь скоро истечёт</b>\n` +
        `${reservation.referenceNumber}\n\n` +
        `Срок брони истекает <b>${expiresAt}</b> (менее чем через 24 часа). ` +
        `Если планы изменились — отмените её, чтобы вернуть украшение в продажу.`;
    const ok = await sendToCustomer(reservation.customerId, text, {
        log: {
            type: "reservation_expiring",
            metadata: { reservationId: reservation.id },
        },
    });
    if (ok) {
        capture({
            event: "telegram_notification_sent",
            distinctId: reservation.customerId,
            properties: { kind: "reservation_expiring", reference: reservation.referenceNumber },
        });
    }
    return ok;
}

export async function notifyReservationExpired(reservation: Reservation): Promise<void> {
    if (!reservation.customerId) return;
    const text =
        `<b>Бронь истекла</b>\n` +
        `${reservation.referenceNumber} — украшение возвращено в продажу.`;
    await sendToCustomer(reservation.customerId, text);
}

/**
 * Booking reminder push (24h or 2h before the appointment). Writes a
 * `notification_log` row tagged with `metadata.appointmentId + kind` so the
 * cron sweeper can skip already-sent reminders on the next tick.
 *
 * Returns `true` when a message was actually sent (chat linked, opted-in).
 */
export async function notifyBookingReminder(
    appointment: Pick<
        Appointment,
        "id" | "referenceNumber" | "customerId" | "date" | "timeStart" | "timeEnd"
    >,
    kind: BookingReminderKind,
    options: { serviceTitles?: string[]; startUtc?: Date | null } = {}
): Promise<boolean> {
    if (!appointment.customerId) return false;
    const services = options.serviceTitles ?? [];
    const items = services
        .slice(0, 5)
        .map((t) => `• ${t}`)
        .join("\n");
    const more = services.length > 5 ? `\n…и ещё ${services.length - 5}` : "";
    const headline =
        kind === "24h" ? "Напоминание: запись завтра" : "Через 2 часа ждём вас в студии";
    const whenLine = options.startUtc
        ? `<b>${formatStudioDateTime(options.startUtc)}</b>`
        : `<b>${appointment.date}</b>, ${appointment.timeStart}—${appointment.timeEnd} МСК`;
    const text =
        `<b>${headline}</b>\n` +
        `${appointment.referenceNumber}\n\n` +
        `${whenLine}` +
        (services.length > 0 ? `\n\n${items}${more}` : "");

    const ok = await sendToCustomer(appointment.customerId, text, {
        log: {
            type: `appointment_reminder_${kind}`,
            metadata: { appointmentId: appointment.id, kind },
        },
    });
    if (ok) {
        capture({
            event: "telegram_notification_sent",
            distinctId: appointment.customerId,
            properties: {
                kind: `appointment_reminder_${kind}`,
                reference: appointment.referenceNumber,
            },
        });
    }
    return ok;
}

/**
 * New-arrival fanout push. Audience differentiation drives copy: wishlist
 * recipients get a "from your wishlist" headline, marketing opt-ins get a
 * generic "new in catalog" headline. Logged so the fanout sweeper can skip
 * already-pushed customers.
 *
 * Returns `true` only when the message was actually delivered.
 */
export async function notifyNewArrival(options: {
    customerId: string;
    productId: string;
    productTitle: string;
    productUrl: string;
    audience: "wishlist" | "marketing";
    fromPriceKopecks?: number | null;
}): Promise<boolean> {
    const headline =
        options.audience === "wishlist"
            ? "Украшение из вишлиста — в наличии"
            : "Новинка в каталоге";
    const lines = [`<b>${headline}</b>`, options.productTitle];
    if (typeof options.fromPriceKopecks === "number") {
        lines.push(`от <b>${formatRub(options.fromPriceKopecks)}</b>`);
    }
    lines.push(`\n<a href="${options.productUrl}">Открыть украшение →</a>`);
    const text = lines.join("\n");

    const ok = await sendToCustomer(options.customerId, text, {
        log: {
            type: "new_arrival",
            metadata: { productId: options.productId, audience: options.audience },
        },
    });
    if (ok) {
        capture({
            event: "telegram_notification_sent",
            distinctId: options.customerId,
            properties: {
                kind: "new_arrival",
                product_id: options.productId,
                audience: options.audience,
            },
        });
    }
    return ok;
}

const AFTERCARE_HEADLINE: Record<AftercareStep, string> = {
    day1: "День 1 — спокойно ухаживаем за проколом",
    day3: "День 3 — отёк должен пойти на спад",
    day7: "1 неделя — продолжаем уход",
    day14: "2 недели — заживление по плану",
    day30: "1 месяц — поверхностный этап позади",
    day60: "2 месяца — глубокое заживление продолжается",
    day90: "3 месяца — финиш базового заживления",
};

/**
 * Aftercare drip push (Day 1 / 3 / 7 / 14 / 30 / 60 / 90). Writes a
 * `notification_log` row tagged with `metadata.trackingId + step` so the
 * cron sweeper skips already-sent reminders.
 *
 * Returns `true` only when an actual chat message was delivered.
 */
export async function notifyAftercareStep(options: {
    customerId: string;
    trackingId: string;
    step: AftercareStep;
    piercingDate: string;
    piercingTypeLabel?: string | null;
    guideUrl?: string | null;
    appointmentId?: string | null;
}): Promise<boolean> {
    const lines = [
        `<b>${AFTERCARE_HEADLINE[options.step]}</b>`,
        `Прокол: <b>${options.piercingDate}</b>` +
            (options.piercingTypeLabel ? ` · ${options.piercingTypeLabel}` : ""),
    ];
    if (options.guideUrl) {
        lines.push(`\n<a href="${options.guideUrl}">Полный гайд по уходу →</a>`);
    }
    const text = lines.join("\n");

    const ok = await sendToCustomer(options.customerId, text, {
        log: {
            type: `aftercare_${options.step}`,
            metadata: {
                trackingId: options.trackingId,
                appointmentId: options.appointmentId ?? null,
                step: options.step,
            },
        },
    });
    if (ok) {
        capture({
            event: "telegram_notification_sent",
            distinctId: options.customerId,
            properties: {
                kind: `aftercare_${options.step}`,
                tracking_id: options.trackingId,
            },
        });
    }
    return ok;
}
