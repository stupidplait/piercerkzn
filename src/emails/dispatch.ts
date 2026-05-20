/**
 * High-level "send email X for domain event Y" helpers. These are the
 * functions route handlers / server actions / workers should call — they
 * tie React Email templates to `@/lib/resend` and persist a
 * `notification_log` row for audit.
 */
import "server-only";

import React from "react";
import { eq, sql } from "drizzle-orm";

import { db, notificationLogs } from "@/db";
import type { AftercareStep } from "@/lib/aftercare/time";
import { pgErrorCode } from "@/lib/api";
import { buildUnsubscribeToken } from "@/lib/newsletters/unsubscribe-token";
import { sendEmail } from "@/lib/resend";
import { getNewsletterSettings } from "@/lib/settings";

import AftercareStepEmail, { type AftercareStepEmailProps } from "./aftercare-step";
import AppointmentConfirmation, {
    type AppointmentConfirmationProps,
} from "./appointment-confirmation";
import BookingReminder, { type BookingReminderProps } from "./booking-reminder";
import DownsizeReminderEmail, { type DownsizeReminderEmailProps } from "./downsize-reminder";
import NewArrival, { type NewArrivalProps } from "./new-arrival";
import NewsletterCampaignEmail, { type NewsletterCampaignEmailProps } from "./newsletter-campaign";
import PasswordReset, { type PasswordResetEmailProps } from "./password-reset";
import ReservationConfirmation, {
    type ReservationConfirmationProps,
} from "./reservation-confirmation";
import ReservationExpired, { type ReservationExpiredProps } from "./reservation-expired";
import SatisfactionSurveyEmail, { type SatisfactionSurveyEmailProps } from "./satisfaction-survey";
import Welcome, { type WelcomeEmailProps } from "./welcome";
import { renderEmail } from "./render";

interface DispatchEnvelope {
    to: string;
    type: string;
    customerId?: string | null;
    /** Extra fields persisted on `notification_log.metadata` — used for
     * idempotency lookups by domain ID (e.g. `{ appointmentId, kind }`). */
    metadata?: Record<string, unknown>;
}

async function dispatch(
    envelope: DispatchEnvelope,
    component: React.ReactElement,
    subject: string,
    contentPreview: string
): Promise<string | null> {
    try {
        const { html, text } = await renderEmail(component);
        const messageId = await sendEmail({ to: envelope.to, subject, html, text });

        await db.insert(notificationLogs).values({
            customerId: envelope.customerId ?? null,
            channel: "email",
            type: envelope.type,
            recipient: envelope.to,
            subject,
            contentPreview: contentPreview.slice(0, 500),
            status: "sent",
            providerId: messageId,
            metadata: envelope.metadata ?? {},
        });

        return messageId;
    } catch (err) {
        console.error(`[email:${envelope.type}] dispatch failed`, err);
        await db
            .insert(notificationLogs)
            .values({
                customerId: envelope.customerId ?? null,
                channel: "email",
                type: envelope.type,
                recipient: envelope.to,
                subject,
                contentPreview: contentPreview.slice(0, 500),
                status: "failed",
                metadata: {
                    ...(envelope.metadata ?? {}),
                    error: err instanceof Error ? err.message : String(err),
                },
            })
            .catch(() => {});
        return null;
    }
}

export async function sendReservationConfirmationEmail(
    props: ReservationConfirmationProps & { to: string; customerId?: string | null }
): Promise<string | null> {
    const { to, customerId, ...rest } = props;
    return dispatch(
        { to, customerId, type: "reservation_confirmation" },
        React.createElement(ReservationConfirmation, rest),
        `Бронь ${rest.referenceNumber} принята`,
        `Сумма к оплате при визите: ${(rest.totalKopecks / 100).toFixed(2)} ₽`
    );
}

export async function sendReservationExpiredEmail(
    props: ReservationExpiredProps & { to: string; customerId?: string | null }
): Promise<string | null> {
    const { to, customerId, ...rest } = props;
    return dispatch(
        { to, customerId, type: "reservation_expired" },
        React.createElement(ReservationExpired, rest),
        `Бронь ${rest.referenceNumber} истекла`,
        "Срок брони закончился."
    );
}

export async function sendPasswordResetEmail(
    props: PasswordResetEmailProps & { to: string; customerId?: string | null }
): Promise<string | null> {
    const { to, customerId, ...rest } = props;
    return dispatch(
        { to, customerId, type: "password_reset" },
        React.createElement(PasswordReset, rest),
        "Сброс пароля PiercerKZN",
        `Ссылка для сброса пароля действует ${rest.ttlMinutes} мин.`
    );
}

export async function sendWelcomeEmail(
    props: WelcomeEmailProps & { to: string; customerId?: string | null }
): Promise<string | null> {
    const { to, customerId, ...rest } = props;
    return dispatch(
        { to, customerId, type: "welcome" },
        React.createElement(Welcome, rest),
        "Добро пожаловать в PiercerKZN",
        "Аккаунт создан, можно отслеживать брони и записи."
    );
}

export async function sendAppointmentConfirmationEmail(
    props: AppointmentConfirmationProps & { to: string; customerId?: string | null }
): Promise<string | null> {
    const { to, customerId, ...rest } = props;
    return dispatch(
        { to, customerId, type: "appointment_confirmation" },
        React.createElement(AppointmentConfirmation, rest),
        `Запись ${rest.referenceNumber} подтверждена`,
        `${rest.date} ${rest.timeStart}—${rest.timeEnd}, услуг: ${rest.services.length}.`
    );
}

export async function sendAftercareStepEmail(
    props: Omit<AftercareStepEmailProps, "step"> & {
        // Accept the canonical 7-step union from `lib/aftercare/time` so
        // every drip step (`day1` … `day90`) flows through this helper. The
        // legacy `aftercare-step.tsx` template still types its `step` prop
        // against the older 4-step union; task 1.6 widens the template.
        step: AftercareStep;
        to: string;
        customerId?: string | null;
        trackingId: string;
        /** Convenience — the appointment that produced this tracking row.
         *  Stored in metadata so the cron sweeper can reconcile multi-channel
         *  idempotency by `trackingId` OR `appointmentId`. */
        appointmentId?: string | null;
    }
): Promise<string | null> {
    const { to, customerId, trackingId, appointmentId, ...rest } = props;
    // Compact Russian subject lines, one per step in the 7-step drip. These
    // are intentionally distinct from the Telegram `AFTERCARE_HEADLINE` map
    // so the inbox preview reads cleanly even when the recipient is also
    // subscribed to the Telegram channel.
    const STEP_TITLE: Record<AftercareStep, string> = {
        day1: "День 1 после прокола — уход",
        day3: "День 3 после прокола — на что обратить внимание",
        day7: "Неделя после прокола — продолжаем уход",
        day14: "2 недели после прокола — точка отсчёта",
        day30: "Месяц после прокола — поверхностный этап",
        day60: "2 месяца — следим за заживлением",
        day90: "3 месяца — итоги",
    };
    const subject = STEP_TITLE[rest.step];
    return dispatch(
        {
            to,
            customerId,
            // Persisted as e.g. `aftercare_day1`, `aftercare_day3`, ...,
            // `aftercare_day90` — the literal `aftercare_<step>` form
            // contracted by Requirement 4.6.
            type: `aftercare_${rest.step}`,
            metadata: { trackingId, appointmentId: appointmentId ?? null, step: rest.step },
        },
        // Bridge cast: the template's `AftercareStep` is still the legacy
        // 4-key union until task 1.6 widens it. This cast is safe so long
        // as the template's COPY map has an entry for the incoming step —
        // which is guaranteed once task 1.6 lands.
        React.createElement(AftercareStepEmail, rest as AftercareStepEmailProps),
        subject,
        `${subject} (прокол ${rest.piercingDate}).`
    );
}

export async function sendNewArrivalEmail(
    props: NewArrivalProps & {
        to: string;
        customerId?: string | null;
        productId: string;
    }
): Promise<string | null> {
    const { to, customerId, productId, ...rest } = props;
    const subject =
        rest.audience === "wishlist"
            ? `Из вашего вишлиста: ${rest.productTitle} — теперь в наличии`
            : `Новинка: ${rest.productTitle}`;
    return dispatch(
        {
            to,
            customerId,
            type: "new_arrival",
            // Idempotency key for the fanout — see
            // `@/lib/products/new-arrival` `hasSentNewArrival()`.
            metadata: { productId, audience: rest.audience },
        },
        React.createElement(NewArrival, rest),
        subject,
        `Новинка в каталоге: ${rest.productTitle}.`
    );
}

export async function sendBookingReminderEmail(
    props: BookingReminderProps & {
        to: string;
        customerId?: string | null;
        appointmentId: string;
    }
): Promise<string | null> {
    const { to, customerId, appointmentId, ...rest } = props;
    const subject =
        rest.kind === "24h"
            ? `Запись ${rest.referenceNumber} — завтра в студии`
            : `Запись ${rest.referenceNumber} — через 2 часа в студии`;
    return dispatch(
        {
            to,
            customerId,
            type: `appointment_reminder_${rest.kind}`,
            // Idempotency key for the cron sweeper — see
            // `@/lib/booking/reminders` `hasSentReminder()`.
            metadata: { appointmentId, kind: rest.kind },
        },
        React.createElement(BookingReminder, rest),
        subject,
        `${rest.date} ${rest.timeStart} — ${rest.timeEnd}, услуг: ${rest.services.length}.`
    );
}

export async function sendSatisfactionSurveyEmail(
    props: SatisfactionSurveyEmailProps & {
        to: string;
        customerId?: string | null;
        appointmentId: string;
    }
): Promise<string | null> {
    const { to, customerId, appointmentId, ...rest } = props;
    return dispatch(
        {
            to,
            customerId,
            type: "satisfaction_survey",
            // Idempotency key for the cron sweeper — see
            // `@/lib/booking/satisfaction-survey` `hasSentSurvey()`.
            metadata: { appointmentId },
        },
        React.createElement(SatisfactionSurveyEmail, rest),
        `Запись ${rest.referenceNumber} — расскажите, как прошло`,
        `Прошла неделя после визита (${rest.appointmentDate}). Расскажите, как всё прошло.`
    );
}

export async function sendDownsizeReminderEmail(
    props: DownsizeReminderEmailProps & {
        to: string;
        customerId?: string | null;
        trackingId: string;
        appointmentId?: string | null;
    }
): Promise<string | null> {
    const { to, customerId, trackingId, appointmentId, ...rest } = props;
    return dispatch(
        {
            to,
            customerId,
            type: "downsize_reminder",
            // Idempotency key for the cron sweeper — see
            // `@/lib/booking/downsize` `hasSentDownsizeReminder()`.
            metadata: { trackingId, appointmentId: appointmentId ?? null },
        },
        React.createElement(DownsizeReminderEmail, rest),
        `Прокол ${rest.piercingDate} — пора на замену украшения`,
        `6 недель после прокола (${rest.piercingTypeLabel}). Пора на downsize.`
    );
}

// ---------------------------------------------------------------------------
// Newsletter campaign — special-shape dispatcher
// ---------------------------------------------------------------------------
//
// Unlike the generic `dispatch()` envelope (which writes the audit row AFTER
// the Resend call), the newsletter sender INSERTs a `notification_log` row
// with `status='pending'` BEFORE the send so the partial unique index
// `uniq_notif_newsletter_recipient` (on `(type, metadata->>'campaignId',
// metadata->>'customerId') WHERE type='newsletter_campaign'`) can claim the
// per-recipient slot atomically. Two concurrent worker jobs racing on the
// same `(campaignId, customerId)` will see exactly one INSERT succeed; the
// loser observes a Postgres `23505 unique_violation` and short-circuits to
// `{ skipped: 'already_sent' }` without calling Resend.
//
// This is the contract that makes per-recipient idempotency hold across
// the queue worker + the cron sweeper's recovery pass: the row IS the
// claim.

export interface SendNewsletterCampaignParams {
    to: string;
    customerId: string;
    campaignId: string;
    customerFirstName?: string | null;
    subject: string;
    preheader?: string | null;
    bodyMarkdown: string;
}

export interface NewsletterDispatchResult {
    sent: boolean;
    /** Set when the partial unique index rejected the claim — a prior send
     *  already exists for this `(campaignId, customerId)` pair. */
    skipped?: "already_sent";
    /** Set on dispatch failure; the row is updated to `status='failed'`
     *  with `metadata.error = <message>` (best-effort). */
    failed?: string;
    /** Resend message id when `sent === true`. */
    messageId?: string;
}

/**
 * Send one newsletter campaign email to one recipient with INSERT-claim
 * semantics. See the block comment above for why this dispatcher does not
 * route through the generic `dispatch()` helper.
 *
 * Flow:
 *   1. Insert `notification_log` row (status='pending'). On 23505 → return
 *      `{ skipped: 'already_sent' }`.
 *   2. Render template + send via Resend with RFC 8058 List-Unsubscribe
 *      headers and `Content-Language: ru`.
 *   3. On success: update row to status='sent' with `providerId` + `sentAt`.
 *   4. On dispatch failure: update row to status='failed', writing
 *      `metadata.error` via JSONB merge; result is `{ failed: <message> }`.
 *
 * Throws when newsletter `from_address` is unset — callers (the
 * orchestration module) are expected to gate on `getNewsletterSettings()`
 * before scheduling, but the throw remains as a defensive guardrail.
 */
export async function sendNewsletterCampaignEmail(
    params: SendNewsletterCampaignParams
): Promise<NewsletterDispatchResult> {
    // Build unsubscribe URL. The token is a `customerId`-scoped HMAC, so
    // the recipient and only the recipient can opt out via the link.
    const token = buildUnsubscribeToken(params.customerId);
    const origin = (
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.AUTH_URL ??
        "https://piercerkzn.ru"
    ).replace(/\/$/u, "");
    const unsubscribeUrl = `${origin}/api/unsubscribe?token=${token}`;

    // Settings — fail-fast when the From address is not configured.
    const settings = await getNewsletterSettings();
    if (!settings.fromAddress) {
        throw new Error("newsletter from_address is not configured");
    }

    // 1. INSERT the claim row. The partial unique index gates duplicates.
    let inserted: { id: string } | undefined;
    try {
        const [row] = await db
            .insert(notificationLogs)
            .values({
                customerId: params.customerId,
                channel: "email",
                type: "newsletter_campaign",
                recipient: params.to,
                subject: params.subject,
                contentPreview: (params.preheader ?? params.subject).slice(0, 500),
                status: "pending",
                metadata: {
                    campaignId: params.campaignId,
                    customerId: params.customerId,
                },
            })
            .returning({ id: notificationLogs.id });
        inserted = row;
    } catch (err) {
        if (pgErrorCode(err) === "23505") {
            return { sent: false, skipped: "already_sent" };
        }
        throw err;
    }

    if (!inserted) {
        // Drizzle is documented to return the inserted row; this branch
        // exists only as a defensive guardrail for the type narrowing.
        return { sent: false, failed: "claim_insert_returned_no_row" };
    }

    // 2. Render template + send via Resend with the RFC 8058 headers.
    try {
        const { html, text } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                customerFirstName: params.customerFirstName,
                subject: params.subject,
                preheader: params.preheader,
                bodyMarkdown: params.bodyMarkdown,
                unsubscribeUrl,
            } satisfies NewsletterCampaignEmailProps)
        );

        const messageId = await sendEmail({
            to: params.to,
            subject: params.subject,
            html,
            text,
            from: settings.fromAddress,
            replyTo: settings.replyTo ?? settings.fromAddress,
            headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                "Content-Language": "ru",
            },
        });

        // 3. Mark sent. `sentAt` is also written so the audit row records
        //    the actual dispatch time (not just the claim time).
        await db
            .update(notificationLogs)
            .set({
                status: "sent",
                providerId: messageId,
                sentAt: new Date(),
            })
            .where(eq(notificationLogs.id, inserted.id));

        return { sent: true, messageId };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[email:newsletter_campaign] dispatch failed`, err);
        // 4. Mark failed (best effort — never let this throw and mask the
        //    original dispatch error). Merge the error string into the
        //    existing JSONB metadata so the campaignId/customerId keys
        //    written at insert time are preserved.
        await db
            .update(notificationLogs)
            .set({
                status: "failed",
                metadata: sql`${notificationLogs.metadata} || ${JSON.stringify({ error: errorMsg })}::jsonb`,
            })
            .where(eq(notificationLogs.id, inserted.id))
            .catch(() => {});
        return { sent: false, failed: errorMsg };
    }
}
