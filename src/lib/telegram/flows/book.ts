/**
 * `/book` interactive flow for the Telegram bot.
 *
 * Walks the customer through:
 *   select_service → select_date → select_time → collect_contact (optional) → confirm
 *
 * State lives in the `telegramBotUsers.botState` jsonb column via
 * `lib/telegram/fsm.ts`. Every callback handler in this module follows the
 * same recipe:
 *
 *   1. Parse the `bk:*` payload via `parseBook`. Unknown payload →
 *      `answerCallbackQuery({ text: "Неизвестная команда" })` and return.
 *   2. ALWAYS call `ctx.answerCallbackQuery()` first (Requirement 3.6) — no
 *      DB read, no message edit, no FSM write happens before the ack.
 *   3. Load current state and validate flow + step. Stale or wrong-flow
 *      state is ignored; the handler short-circuits with a clear/cancel.
 *   4. Compute the next state, write it via `saveBotState`, then re-render
 *      the matching keyboard via `editMessageText` (or `editMessageReplyMarkup`
 *      for in-place pagination).
 *
 * Availability is computed by composing
 * `lib/booking/availability.computeSlotsForDay` with `getBookingSettings()`
 * directly — there is no HTTP round-trip to `/api/booking/availability`
 * (Requirement 5.1).
 *
 * Terminal step `confirm` calls `createAppointment(input, ctx)` with a
 * synthetic `waiverSignatureData = "tg-consent:<tgId>:<ISO>"` so the schema's
 * `appointment.waiver_id` constraint is satisfied (design §9.2). On the
 * `slot_unavailable` path the FSM is rewound to `select_time` rather than
 * cleared — the customer keeps their service + date and just picks a new
 * time (design §4.9, Requirement 13.2).
 *
 * Requirements covered: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4,
 * 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 11.3,
 * 13.1, 13.2, 13.3.
 */
import "server-only";

import type { Context as GrammyContext } from "grammy";
import { and, asc, eq, gte, lte, ne, notInArray } from "drizzle-orm";

import {
    appointments,
    customers,
    db,
    piercerSchedule,
    scheduleExceptions,
    services as servicesTable,
    telegramBotUsers,
    timeBlocks,
} from "@/db";

import { addDaysIso } from "@/lib/aftercare/time";
import { AppointmentError, createAppointment } from "@/lib/booking/appointments";
import {
    computeSlotsForDay,
    dayOfWeekForDate,
    parseHmsToMinutes,
    type TimeRange,
} from "@/lib/booking/availability";
import { getBookingSettings, type BookingSettings } from "@/lib/settings";
import type { BookAppointmentInput } from "@/lib/validations";
import { emailSchema, phoneSchema } from "@/lib/validations/common";

import { type BotStateBook, clearBotState, loadBotState, saveBotState } from "../fsm";
import { parseBook } from "./callback-data";
import {
    buildConfirmKeyboard,
    buildContactReplyKeyboard,
    buildDatePicker,
    buildServiceList,
    buildTimePicker,
} from "./keyboards";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on how far ahead we render dates, regardless of advance_days. */
const DATE_WINDOW_MAX = 21;
const TIME_PAGE_SIZE = 12;
const STUDIO_TZ = "Europe/Moscow";

// Surface text — Russian copy in one place per design §12.
const TXT_LINK_REQUIRED = "Привяжите чат к профилю на сайте.";
const TXT_NO_SERVICES = "Услуги не настроены.";
const TXT_PICK_SERVICE = "Выберите услугу";
const TXT_PICK_DATE = "Выберите дату";
const TXT_PICK_TIME = "Выберите время";
const TXT_NO_DATES = "Свободных дат нет. Попробуйте позже.";
const TXT_NO_TIMES = "Свободного времени нет. Выберите другую дату.";
const TXT_SERVICE_UNAVAILABLE = "Услуга недоступна.";
const TXT_CANCELLED = "Действие отменено.";
const TXT_UNKNOWN_PAGE = "На такой странице пусто";
const TXT_UNKNOWN_CALLBACK = "Неизвестная команда";
const TXT_GENERIC_ERROR = "Ошибка. Попробуйте позже.";
const TXT_CONFIRMING_BOOKING = "Подтверждаю запись…";
const TXT_BACK_NOT_AVAILABLE = "Назад невозможен";
const TXT_PHONE_PROMPT = "Поделитесь номером телефона или введите его текстом.";
const TXT_EMAIL_PROMPT = "Введите email текстом.";
const TXT_PHONE_INVALID = "Не удалось распознать номер. Попробуйте ещё раз.";
const TXT_EMAIL_INVALID = "Не удалось распознать email. Попробуйте ещё раз.";
const TXT_SLOT_TAKEN = "Время занято. Выберите другой слот.";
const TXT_BOOKING_FAILED_PREFIX = "Не получилось подтвердить запись: ";
const TXT_BOOKING_FAILED_GENERIC = "Не получилось подтвердить запись. Попробуйте позже.";
const TXT_CHAT_NOT_LINKED = "Чат не привязан";
const TXT_CONTACT_DROP_KEYBOARD = "Готово.";
const TXT_RESERVE_CANCEL_BUTTON = "Отмена";

// ---------------------------------------------------------------------------
// Helpers — runtime + URL
// ---------------------------------------------------------------------------

/** Site origin used inside HTML hyperlinks; mirrors `bot.ts.siteOrigin`. */
function siteOrigin(): string {
    const v = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.AUTH_URL;
    return (v ?? "https://piercerkzn.ru").replace(/\/$/u, "");
}

/** Best-effort callback-query ack; never throws. */
async function safeAck(
    ctx: GrammyContext,
    opts?: { text?: string; show_alert?: boolean }
): Promise<void> {
    try {
        await ctx.answerCallbackQuery(opts);
    } catch (err) {
        console.error("[tg.book] answerCallbackQuery failed", err);
    }
}

// ---------------------------------------------------------------------------
// Helpers — date / time
// ---------------------------------------------------------------------------

interface MoscowNow {
    /** YYYY-MM-DD in studio-local time. */
    date: string;
    /** Minutes from midnight, studio-local. */
    minutes: number;
}

function studioNow(): MoscowNow {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: STUDIO_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const date = `${parts.find((p) => p.type === "year")?.value}-${
        parts.find((p) => p.type === "month")?.value
    }-${parts.find((p) => p.type === "day")?.value}`;
    const minutes = get("hour") * 60 + get("minute");
    return { date, minutes };
}

const PRETTY_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
});

/** "понедельник, 16 мая" — used inside the confirm summary. */
function prettyDate(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return PRETTY_DATE_FORMATTER.format(d);
}

// ---------------------------------------------------------------------------
// Helpers — schedule loading + slot composition (reused from availability route)
// ---------------------------------------------------------------------------

/** Decode jsonb `breaks` array into TimeRange[]. */
function parseBreaks(raw: unknown): TimeRange[] {
    if (!Array.isArray(raw)) return [];
    const out: TimeRange[] = [];
    for (const b of raw) {
        if (!b || typeof b !== "object") continue;
        const def = b as { start?: string | null; end?: string | null };
        const s = parseHmsToMinutes(def.start ?? null);
        const e = parseHmsToMinutes(def.end ?? null);
        if (s !== null && e !== null && e > s) out.push({ start: s, end: e });
    }
    return out;
}

/**
 * Resolve a single day's working window + breaks from the pre-loaded weekly
 * schedule and per-day exception, mirroring the logic in
 * `app/api/booking/availability/route.ts`.
 */
function resolveWorkingWindow(
    dateIso: string,
    weeklyByDay: Map<number, typeof piercerSchedule.$inferSelect>,
    exceptionByDate: Map<string, typeof scheduleExceptions.$inferSelect>
): { workingWindow: TimeRange | null; breaks: TimeRange[] } {
    const exception = exceptionByDate.get(dateIso);
    if (exception) {
        if (!exception.isWorking) return { workingWindow: null, breaks: [] };
        const s = parseHmsToMinutes(exception.startTime);
        const e = parseHmsToMinutes(exception.endTime);
        if (s === null || e === null || e <= s) return { workingWindow: null, breaks: [] };
        return { workingWindow: { start: s, end: e }, breaks: [] };
    }
    const dow = dayOfWeekForDate(dateIso);
    if (dow === null) return { workingWindow: null, breaks: [] };
    const weekly = weeklyByDay.get(dow);
    if (!weekly?.isWorking) return { workingWindow: null, breaks: [] };
    const s = parseHmsToMinutes(weekly.startTime);
    const e = parseHmsToMinutes(weekly.endTime);
    if (s === null || e === null || e <= s) return { workingWindow: null, breaks: [] };
    return { workingWindow: { start: s, end: e }, breaks: parseBreaks(weekly.breaks) };
}

interface ScheduleData {
    weeklyByDay: Map<number, typeof piercerSchedule.$inferSelect>;
    exceptionByDate: Map<string, typeof scheduleExceptions.$inferSelect>;
    blocksByDate: Map<string, TimeRange[]>;
    appointmentsByDate: Map<string, TimeRange[]>;
}

/**
 * Bulk-load all schedule + appointment data for a `[startDate, endDate]`
 * inclusive range. The four parallel queries match the shape of the
 * availability route handler so the bot path doesn't drift over time.
 */
async function loadScheduleData(startDate: string, endDate: string): Promise<ScheduleData> {
    const [weeklyRows, exceptionRows, blockRows, appointmentRows] = await Promise.all([
        db.select().from(piercerSchedule),
        db
            .select()
            .from(scheduleExceptions)
            .where(
                and(gte(scheduleExceptions.date, startDate), lte(scheduleExceptions.date, endDate))
            ),
        db
            .select()
            .from(timeBlocks)
            .where(and(gte(timeBlocks.date, startDate), lte(timeBlocks.date, endDate))),
        db
            .select({
                date: appointments.date,
                timeStart: appointments.timeStart,
                timeEnd: appointments.timeEnd,
            })
            .from(appointments)
            .where(
                and(
                    gte(appointments.date, startDate),
                    lte(appointments.date, endDate),
                    notInArray(appointments.status, ["cancelled", "no_show"]),
                    ne(appointments.status, "rescheduled")
                )
            ),
    ]);

    const weeklyByDay = new Map<number, (typeof weeklyRows)[number]>();
    for (const w of weeklyRows) weeklyByDay.set(w.dayOfWeek, w);

    const exceptionByDate = new Map<string, (typeof exceptionRows)[number]>();
    for (const e of exceptionRows) exceptionByDate.set(e.date, e);

    const blocksByDate = new Map<string, TimeRange[]>();
    for (const b of blockRows) {
        const s = parseHmsToMinutes(b.startTime);
        const e = parseHmsToMinutes(b.endTime);
        if (s === null || e === null || e <= s) continue;
        const list = blocksByDate.get(b.date) ?? [];
        list.push({ start: s, end: e });
        blocksByDate.set(b.date, list);
    }

    const appointmentsByDate = new Map<string, TimeRange[]>();
    for (const a of appointmentRows) {
        const s = parseHmsToMinutes(a.timeStart);
        const e = parseHmsToMinutes(a.timeEnd);
        if (s === null || e === null || e <= s) continue;
        const list = appointmentsByDate.get(a.date) ?? [];
        list.push({ start: s, end: e });
        appointmentsByDate.set(a.date, list);
    }

    return { weeklyByDay, exceptionByDate, blocksByDate, appointmentsByDate };
}

/** Compute the slot list for a single date using pre-loaded schedule data. */
function slotsForDate(
    dateIso: string,
    durationMin: number,
    settings: BookingSettings,
    schedule: ScheduleData,
    now: MoscowNow
): string[] {
    const { workingWindow, breaks } = resolveWorkingWindow(
        dateIso,
        schedule.weeklyByDay,
        schedule.exceptionByDate
    );
    if (!workingWindow) return [];

    const earliestStartMin = dateIso === now.date ? now.minutes + settings.minNoticeHours * 60 : 0;

    const day = computeSlotsForDay({
        date: dateIso,
        workingWindow,
        breaks,
        blocks: schedule.blocksByDate.get(dateIso) ?? [],
        appointments: schedule.appointmentsByDate.get(dateIso) ?? [],
        earliestStartMin,
        requiredDurationMin: durationMin + settings.bufferMinutes,
        slotStepMin: settings.slotDurationMinutes,
    });
    return day.slots;
}

/**
 * Compute the list of bookable dates for a service in studio-local time.
 * Window is `min(advanceDays, DATE_WINDOW_MAX)` days starting at "today"
 * (Europe/Moscow). Dates with zero slots are filtered out.
 */
async function computeBookableDates(
    durationMin: number,
    settings: BookingSettings
): Promise<string[]> {
    const window = Math.min(settings.advanceDays ?? DATE_WINDOW_MAX, DATE_WINDOW_MAX);
    if (window <= 0) return [];

    const now = studioNow();
    const startDate = now.date;
    const endDate = addDaysIso(startDate, window - 1) ?? startDate;

    const schedule = await loadScheduleData(startDate, endDate);

    const out: string[] = [];
    for (let i = 0; i < window; i += 1) {
        const iso = addDaysIso(startDate, i);
        if (!iso) continue;
        const slots = slotsForDate(iso, durationMin, settings, schedule, now);
        if (slots.length > 0) out.push(iso);
    }
    return out;
}

/**
 * Compute the slot list for a single date — used by `bk:date` taps and the
 * slot-conflict recovery path (design §4.9).
 */
async function computeSlotsForSingleDate(
    dateIso: string,
    durationMin: number,
    settings: BookingSettings
): Promise<string[]> {
    const schedule = await loadScheduleData(dateIso, dateIso);
    return slotsForDate(dateIso, durationMin, settings, schedule, studioNow());
}

// ---------------------------------------------------------------------------
// Helpers — DB (customer + services + linked tg user)
// ---------------------------------------------------------------------------

async function findLinkedCustomerId(tgId: number): Promise<string | null> {
    const [row] = await db
        .select({ customerId: telegramBotUsers.customerId })
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.telegramId, tgId))
        .limit(1);
    return row?.customerId ?? null;
}

interface BookCustomer {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    dateOfBirth: string | null;
}

async function loadCustomer(customerId: string): Promise<BookCustomer | null> {
    const [row] = await db
        .select({
            id: customers.id,
            firstName: customers.firstName,
            lastName: customers.lastName,
            email: customers.email,
            phone: customers.phone,
            dateOfBirth: customers.dateOfBirth,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
    return row ?? null;
}

async function loadServices(): Promise<
    Array<{ id: string; title: string; durationMinutes: number }>
> {
    const rows = await db
        .select({
            id: servicesTable.id,
            name: servicesTable.name,
            durationMinutes: servicesTable.durationMinutes,
        })
        .from(servicesTable)
        .where(eq(servicesTable.isActive, true))
        .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.name));
    // The keyboards module's `ServiceItem` shape uses `title`; map here.
    return rows.map((r) => ({ id: r.id, title: r.name, durationMinutes: r.durationMinutes }));
}

async function loadServiceById(serviceId: string): Promise<{
    id: string;
    title: string;
    durationMinutes: number;
    isActive: boolean | null;
} | null> {
    const [row] = await db
        .select({
            id: servicesTable.id,
            name: servicesTable.name,
            durationMinutes: servicesTable.durationMinutes,
            isActive: servicesTable.isActive,
        })
        .from(servicesTable)
        .where(eq(servicesTable.id, serviceId))
        .limit(1);
    if (!row) return null;
    return {
        id: row.id,
        title: row.name,
        durationMinutes: row.durationMinutes,
        isActive: row.isActive,
    };
}

async function persistCustomerPhone(customerId: string, phone: string): Promise<void> {
    await db
        .update(customers)
        .set({ phone, updatedAt: new Date() })
        .where(eq(customers.id, customerId));
}

async function persistCustomerEmail(customerId: string, email: string): Promise<void> {
    await db
        .update(customers)
        .set({ email, updatedAt: new Date() })
        .where(eq(customers.id, customerId));
}

// ---------------------------------------------------------------------------
// Helpers — confirm body
// ---------------------------------------------------------------------------

function buildConfirmBody(serviceTitle: string, dateIso: string, time: string): string {
    return [
        "<b>Подтверждение записи</b>",
        `Услуга: ${serviceTitle}`,
        `Дата: ${prettyDate(dateIso)}`,
        `Время: ${time}`,
        "",
        `Перед визитом ознакомьтесь с <a href="${siteOrigin()}/waiver">соглашением о пирсинге</a>.`,
        "Нажимая «Подтвердить», вы подтверждаете согласие с условиями.",
    ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers — contact transition
// ---------------------------------------------------------------------------

/**
 * After a successful contact persist that leaves no missing fields, drop the
 * reply keyboard with a short ack and render the confirm summary as a fresh
 * message. The double-reply pattern is required because Telegram only allows
 * a single reply_markup per message and we need to (a) hide the contact reply
 * keyboard and (b) attach an inline confirm keyboard.
 */
async function transitionToConfirm(
    ctx: GrammyContext,
    tgId: number,
    state: BotStateBook,
    service: { id: string; title: string; durationMinutes: number },
    dateIso: string,
    time: string
): Promise<void> {
    const next: BotStateBook = {
        flow: "book",
        step: "confirm",
        data: {
            serviceId: service.id,
            durationMin: service.durationMinutes,
            date: dateIso,
            time,
            dates: state.data.dates,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);

    // First message: drop the reply keyboard. Telegram requires a non-empty
    // text body, so we send a short ack rather than an empty string.
    await ctx.reply(TXT_CONTACT_DROP_KEYBOARD, {
        reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(buildConfirmBody(service.title, dateIso, time), {
        parse_mode: "HTML",
        reply_markup: buildConfirmKeyboard("bk"),
    });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * `/book` typed-command entry. Initialises state to
 * `{ flow: "book", step: "select_service", data: {} }` and renders the
 * service keyboard. No-op when the chat is not linked to a customer.
 */
export async function enter(ctx: GrammyContext): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") return;

    try {
        const customerId = await findLinkedCustomerId(tgId);
        if (!customerId) {
            await ctx.reply(TXT_LINK_REQUIRED);
            return;
        }

        const services = await loadServices();
        if (services.length === 0) {
            await ctx.reply(TXT_NO_SERVICES);
            return;
        }

        const next: BotStateBook = {
            flow: "book",
            step: "select_service",
            data: {},
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.reply(TXT_PICK_SERVICE, {
            reply_markup: buildServiceList(services.map((s) => ({ id: s.id, title: s.title }))),
        });
    } catch (err) {
        console.error("[tg.book] enter failed", err);
        try {
            await ctx.reply(TXT_GENERIC_ERROR);
        } catch (replyErr) {
            console.error("[tg.book] enter reply failed", replyErr);
        }
    }
}

// ---------------------------------------------------------------------------
// Callback dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a `bk:*` inline-keyboard callback. The bot.ts dispatcher only
 * checks the prefix; this function owns everything inside the namespace.
 *
 * Always answers the callback query before any DB read or write
 * (Requirement 3.6). Wraps the body in try/catch and surfaces a generic
 * toast on failure rather than silently dropping the user.
 */
export async function handleCallback(ctx: GrammyContext, raw: string): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") {
        await safeAck(ctx, { text: TXT_GENERIC_ERROR });
        return;
    }

    const parsed = parseBook(raw);
    if (!parsed) {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    try {
        switch (parsed.kind) {
            case "start":
                await handleStart(ctx, tgId);
                return;
            case "service":
                await handleService(ctx, tgId, parsed.serviceId);
                return;
            case "date":
                await handleDate(ctx, tgId, parsed.date);
                return;
            case "timePage":
                await handleTimePage(ctx, tgId, parsed.page);
                return;
            case "time":
                await handleTime(ctx, tgId, parsed.time);
                return;
            case "confirm":
                await handleConfirm(ctx, tgId);
                return;
            case "cancel":
                await handleCancel(ctx, tgId);
                return;
            case "back":
                await handleBack(ctx, tgId);
                return;
        }
    } catch (err) {
        console.error("[tg.book] handleCallback failed", { kind: parsed.kind, err });
        await safeAck(ctx, { text: TXT_GENERIC_ERROR, show_alert: true });
    }
}

// ---------------------------------------------------------------------------
// Per-action handlers
// ---------------------------------------------------------------------------

/**
 * Inline "Записаться" greeting button → same destination as `enter`,
 * but we edit the greeting message in-place rather than send a new one.
 */
async function handleStart(ctx: GrammyContext, tgId: number): Promise<void> {
    await safeAck(ctx);
    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await ctx.reply(TXT_LINK_REQUIRED);
        return;
    }

    const services = await loadServices();
    if (services.length === 0) {
        await ctx.reply(TXT_NO_SERVICES);
        return;
    }

    const next: BotStateBook = {
        flow: "book",
        step: "select_service",
        data: {},
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(TXT_PICK_SERVICE, {
        reply_markup: buildServiceList(services.map((s) => ({ id: s.id, title: s.title }))),
    });
}

async function handleService(ctx: GrammyContext, tgId: number, serviceId: string): Promise<void> {
    await safeAck(ctx);
    const state = await loadBotState(tgId);
    if (state?.flow !== "book" || state.step !== "select_service") return;

    const service = await loadServiceById(serviceId);
    if (!service || !service.isActive) {
        await ctx.reply(TXT_SERVICE_UNAVAILABLE);
        return;
    }

    const settings = await getBookingSettings();
    const dates = await computeBookableDates(service.durationMinutes, settings);
    if (dates.length === 0) {
        await ctx.reply(TXT_NO_DATES);
        await clearBotState(tgId);
        return;
    }

    const next: BotStateBook = {
        flow: "book",
        step: "select_date",
        data: {
            serviceId: service.id,
            durationMin: service.durationMinutes,
            dates,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(TXT_PICK_DATE, {
        reply_markup: buildDatePicker(dates),
    });
}

async function handleDate(ctx: GrammyContext, tgId: number, dateIso: string): Promise<void> {
    await safeAck(ctx);
    const state = await loadBotState(tgId);
    if (
        state?.flow !== "book" ||
        state.step !== "select_date" ||
        !state.data.serviceId ||
        !state.data.durationMin
    ) {
        return;
    }

    // Validate the tapped date is one of the cached bookable dates so we
    // don't end up rendering the picker for a stale or spoofed date.
    const cachedDates = state.data.dates ?? [];
    if (!cachedDates.includes(dateIso)) {
        await ctx.reply(TXT_NO_TIMES);
        return;
    }

    const settings = await getBookingSettings();
    const slots = await computeSlotsForSingleDate(dateIso, state.data.durationMin, settings);

    if (slots.length === 0) {
        await ctx.reply(TXT_NO_TIMES);
        // Re-render the date picker so the user can try a different day.
        await ctx.reply(TXT_PICK_DATE, { reply_markup: buildDatePicker(cachedDates) });
        return;
    }

    const next: BotStateBook = {
        flow: "book",
        step: "select_time",
        data: {
            serviceId: state.data.serviceId,
            durationMin: state.data.durationMin,
            date: dateIso,
            dates: cachedDates,
            page: 0,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageText(TXT_PICK_TIME, {
        reply_markup: buildTimePicker(slots, 0, TIME_PAGE_SIZE),
    });
}

async function handleTimePage(ctx: GrammyContext, tgId: number, page: number): Promise<void> {
    const state = await loadBotState(tgId);
    if (
        state?.flow !== "book" ||
        state.step !== "select_time" ||
        !state.data.serviceId ||
        !state.data.durationMin ||
        !state.data.date
    ) {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    const settings = await getBookingSettings();
    const slots = await computeSlotsForSingleDate(
        state.data.date,
        state.data.durationMin,
        settings
    );
    const totalPages = Math.max(1, Math.ceil(slots.length / TIME_PAGE_SIZE));
    if (page < 0 || page >= totalPages) {
        await safeAck(ctx, { text: TXT_UNKNOWN_PAGE });
        return;
    }

    await safeAck(ctx);
    const next: BotStateBook = {
        flow: "book",
        step: "select_time",
        data: {
            serviceId: state.data.serviceId,
            durationMin: state.data.durationMin,
            date: state.data.date,
            dates: state.data.dates,
            page,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);
    await ctx.editMessageReplyMarkup({
        reply_markup: buildTimePicker(slots, page, TIME_PAGE_SIZE),
    });
}

async function handleTime(ctx: GrammyContext, tgId: number, time: string): Promise<void> {
    await safeAck(ctx);
    const state = await loadBotState(tgId);
    if (
        state?.flow !== "book" ||
        state.step !== "select_time" ||
        !state.data.serviceId ||
        !state.data.durationMin ||
        !state.data.date
    ) {
        return;
    }

    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await ctx.reply(TXT_LINK_REQUIRED);
        await clearBotState(tgId);
        return;
    }
    const customer = await loadCustomer(customerId);
    if (!customer) {
        await ctx.reply(TXT_LINK_REQUIRED);
        await clearBotState(tgId);
        return;
    }
    const service = await loadServiceById(state.data.serviceId);
    if (!service || !service.isActive) {
        await ctx.reply(TXT_SERVICE_UNAVAILABLE);
        await clearBotState(tgId);
        return;
    }

    const missing: Array<"email" | "phone"> = [];
    if (!customer.email) missing.push("email");
    if (!customer.phone) missing.push("phone");

    if (missing.length === 0) {
        const next: BotStateBook = {
            flow: "book",
            step: "confirm",
            data: {
                serviceId: state.data.serviceId,
                durationMin: state.data.durationMin,
                date: state.data.date,
                time,
                dates: state.data.dates,
            },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(buildConfirmBody(service.title, state.data.date, time), {
            parse_mode: "HTML",
            reply_markup: buildConfirmKeyboard("bk"),
        });
        return;
    }

    // Contact step required.
    const next: BotStateBook = {
        flow: "book",
        step: "collect_contact",
        data: {
            serviceId: state.data.serviceId,
            durationMin: state.data.durationMin,
            date: state.data.date,
            time,
            dates: state.data.dates,
            missing,
        },
        updatedAt: "",
    };
    await saveBotState(tgId, next);

    if (missing.includes("phone")) {
        await ctx.reply(TXT_PHONE_PROMPT, {
            reply_markup: buildContactReplyKeyboard(missing),
        });
    } else {
        // Only email is missing — the contact reply keyboard is empty for
        // that case, so we send a plain text prompt.
        await ctx.reply(TXT_EMAIL_PROMPT);
    }
}

async function handleConfirm(ctx: GrammyContext, tgId: number): Promise<void> {
    const state = await loadBotState(tgId);
    if (
        state?.flow !== "book" ||
        state.step !== "confirm" ||
        !state.data.serviceId ||
        !state.data.date ||
        !state.data.time ||
        !state.data.durationMin
    ) {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    await safeAck(ctx, { text: TXT_CONFIRMING_BOOKING });

    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await ctx.reply(TXT_CHAT_NOT_LINKED);
        await clearBotState(tgId);
        return;
    }
    const customer = await loadCustomer(customerId);
    if (!customer || !customer.email || !customer.phone) {
        // We should never reach this branch because the contact step is
        // mandatory when either field is null. Surface a generic error.
        await ctx.reply(TXT_BOOKING_FAILED_GENERIC);
        await clearBotState(tgId);
        return;
    }
    const service = await loadServiceById(state.data.serviceId);
    if (!service || !service.isActive) {
        await ctx.reply(TXT_SERVICE_UNAVAILABLE);
        await clearBotState(tgId);
        return;
    }

    const nowIso = new Date().toISOString();
    const input: BookAppointmentInput = {
        serviceIds: [state.data.serviceId],
        date: state.data.date,
        time: state.data.time,
        customer: {
            firstName: customer.firstName,
            lastName: customer.lastName ?? undefined,
            email: customer.email,
            phone: customer.phone,
            dateOfBirth: customer.dateOfBirth ?? undefined,
        },
        waiverSigned: true,
        waiverSignatureData: `tg-consent:${tgId}:${nowIso}`,
        createAccount: false,
    };

    try {
        const result = await createAppointment(input, {
            sessionCustomerId: customer.id,
            ipAddress: null,
            userAgent: "telegram-bot",
        });
        await clearBotState(tgId);
        await ctx.reply(
            [
                "✓ Запись подтверждена.",
                `${result.appointment.referenceNumber} — ${prettyDate(state.data.date)}, ${state.data.time}`,
                `Услуга: ${service.title}`,
            ].join("\n")
        );
        return;
    } catch (err) {
        if (err instanceof AppointmentError) {
            if (err.code === "slot_unavailable") {
                // Recovery path (design §4.9): keep the service + date,
                // drop the time, re-render the time picker.
                const settings = await getBookingSettings();
                const slots = await computeSlotsForSingleDate(
                    state.data.date,
                    state.data.durationMin,
                    settings
                );
                const next: BotStateBook = {
                    flow: "book",
                    step: "select_time",
                    data: {
                        serviceId: state.data.serviceId,
                        durationMin: state.data.durationMin,
                        date: state.data.date,
                        dates: state.data.dates,
                        page: 0,
                    },
                    updatedAt: "",
                };
                await saveBotState(tgId, next);
                await ctx.reply(TXT_SLOT_TAKEN);
                await ctx.reply(TXT_PICK_TIME, {
                    reply_markup: buildTimePicker(slots, 0, TIME_PAGE_SIZE),
                });
                return;
            }
            await clearBotState(tgId);
            await ctx.reply(`${TXT_BOOKING_FAILED_PREFIX}${err.message}`);
            return;
        }
        console.error("[tg.book] createAppointment unknown error", err);
        await clearBotState(tgId);
        await ctx.reply(TXT_BOOKING_FAILED_GENERIC);
    }
}

async function handleCancel(ctx: GrammyContext, tgId: number): Promise<void> {
    await safeAck(ctx);
    await clearBotState(tgId);
    try {
        await ctx.editMessageText(TXT_CANCELLED);
    } catch (err) {
        console.error("[tg.book] cancel editMessageText failed", err);
        await ctx.reply(TXT_CANCELLED);
    }
}

async function handleBack(ctx: GrammyContext, tgId: number): Promise<void> {
    const state = await loadBotState(tgId);
    if (state?.flow !== "book") {
        await safeAck(ctx, { text: TXT_UNKNOWN_CALLBACK });
        return;
    }

    if (state.step === "select_date") {
        // Back to service select.
        await safeAck(ctx);
        const services = await loadServices();
        if (services.length === 0) {
            await ctx.reply(TXT_NO_SERVICES);
            await clearBotState(tgId);
            return;
        }
        const next: BotStateBook = {
            flow: "book",
            step: "select_service",
            data: {},
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(TXT_PICK_SERVICE, {
            reply_markup: buildServiceList(services.map((s) => ({ id: s.id, title: s.title }))),
        });
        return;
    }

    if (state.step === "select_time") {
        // Back to date select — reuse cached date list to avoid a re-query.
        if (!state.data.serviceId || !state.data.durationMin) {
            await safeAck(ctx, { text: TXT_BACK_NOT_AVAILABLE });
            return;
        }
        await safeAck(ctx);
        let dates = state.data.dates;
        if (!dates || dates.length === 0) {
            const settings = await getBookingSettings();
            dates = await computeBookableDates(state.data.durationMin, settings);
        }
        if (dates.length === 0) {
            await ctx.reply(TXT_NO_DATES);
            await clearBotState(tgId);
            return;
        }
        const next: BotStateBook = {
            flow: "book",
            step: "select_date",
            data: {
                serviceId: state.data.serviceId,
                durationMin: state.data.durationMin,
                dates,
            },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(TXT_PICK_DATE, {
            reply_markup: buildDatePicker(dates),
        });
        return;
    }

    if (state.step === "confirm") {
        if (!state.data.serviceId || !state.data.durationMin || !state.data.date) {
            await safeAck(ctx, { text: TXT_BACK_NOT_AVAILABLE });
            return;
        }
        await safeAck(ctx);
        const settings = await getBookingSettings();
        const slots = await computeSlotsForSingleDate(
            state.data.date,
            state.data.durationMin,
            settings
        );
        if (slots.length === 0) {
            await ctx.reply(TXT_NO_TIMES);
            return;
        }
        const next: BotStateBook = {
            flow: "book",
            step: "select_time",
            data: {
                serviceId: state.data.serviceId,
                durationMin: state.data.durationMin,
                date: state.data.date,
                dates: state.data.dates,
                page: 0,
            },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.editMessageText(TXT_PICK_TIME, {
            reply_markup: buildTimePicker(slots, 0, TIME_PAGE_SIZE),
        });
        return;
    }

    // select_service / collect_contact have nowhere to back-navigate to via
    // this callback (collect_contact uses a reply keyboard and the inline
    // Cancel button instead).
    await safeAck(ctx, { text: TXT_BACK_NOT_AVAILABLE });
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

/**
 * Validate and normalise a phone string against `phoneSchema`. Returns the
 * normalised value on success or `null` on failure. The schema trims whitespace
 * and rejects formats that do not match the +7XXXXXXXXXX / 8XXXXXXXXXX shape.
 */
function validatePhone(raw: string): string | null {
    const trimmed = raw.trim().replace(/[\s\-()]/g, "");
    const result = phoneSchema.safeParse(trimmed);
    return result.success ? result.data : null;
}

function validateEmail(raw: string): string | null {
    const result = emailSchema.safeParse(raw);
    return result.success ? result.data : null;
}

/**
 * Telegram `message:contact` handler — invoked when the customer taps the
 * "Поделиться номером" reply-keyboard button during the `collect_contact`
 * step. Reads the phone from the contact payload, validates, persists, and
 * either advances to confirm (if no email is missing) or prompts for email.
 */
export async function handleContactMessage(ctx: GrammyContext): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") return;

    const state = await loadBotState(tgId);
    if (
        state?.flow !== "book" ||
        state.step !== "collect_contact" ||
        !state.data.serviceId ||
        !state.data.durationMin ||
        !state.data.date ||
        !state.data.time
    ) {
        return;
    }

    const phoneRaw = ctx.message?.contact?.phone_number;
    if (!phoneRaw) return;

    const normalised = validatePhone(phoneRaw);
    if (!normalised) {
        await ctx.reply(TXT_PHONE_INVALID);
        return;
    }

    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await ctx.reply(TXT_LINK_REQUIRED);
        await clearBotState(tgId);
        return;
    }

    await persistCustomerPhone(customerId, normalised);

    const missing = (state.data.missing ?? []).filter((m) => m !== "phone");
    if (missing.includes("email")) {
        // Email still missing — drop the reply keyboard and prompt for it.
        const next: BotStateBook = {
            flow: "book",
            step: "collect_contact",
            data: { ...state.data, missing },
            updatedAt: "",
        };
        await saveBotState(tgId, next);
        await ctx.reply(TXT_EMAIL_PROMPT, {
            reply_markup: { remove_keyboard: true },
        });
        return;
    }

    // No fields missing — transition to confirm.
    const service = await loadServiceById(state.data.serviceId);
    if (!service || !service.isActive) {
        await ctx.reply(TXT_SERVICE_UNAVAILABLE);
        await clearBotState(tgId);
        return;
    }
    await transitionToConfirm(ctx, tgId, state, service, state.data.date, state.data.time);
}

/**
 * Telegram `message:text` handler for the `collect_contact` step. Routes the
 * text input to phone or email validation depending on which field is still
 * missing. Also handles the "Отмена" reply-keyboard button (text-mode) since
 * tapping it sends a plain message rather than a callback.
 */
export async function handleTextMessage(ctx: GrammyContext): Promise<void> {
    const tgId = ctx.from?.id;
    if (typeof tgId !== "number") return;

    const state = await loadBotState(tgId);
    if (
        state?.flow !== "book" ||
        state.step !== "collect_contact" ||
        !state.data.serviceId ||
        !state.data.durationMin ||
        !state.data.date ||
        !state.data.time
    ) {
        return;
    }

    const text = ctx.message?.text?.trim();
    if (!text) return;

    // Special-case the reply-keyboard cancel button.
    if (text === TXT_RESERVE_CANCEL_BUTTON) {
        await clearBotState(tgId);
        await ctx.reply(TXT_CANCELLED, { reply_markup: { remove_keyboard: true } });
        return;
    }

    const customerId = await findLinkedCustomerId(tgId);
    if (!customerId) {
        await ctx.reply(TXT_LINK_REQUIRED);
        await clearBotState(tgId);
        return;
    }

    const missing = state.data.missing ?? [];

    if (missing.includes("phone")) {
        const normalised = validatePhone(text);
        if (!normalised) {
            await ctx.reply(TXT_PHONE_INVALID);
            return;
        }
        await persistCustomerPhone(customerId, normalised);

        const remaining = missing.filter((m) => m !== "phone");
        if (remaining.includes("email")) {
            const next: BotStateBook = {
                flow: "book",
                step: "collect_contact",
                data: { ...state.data, missing: remaining },
                updatedAt: "",
            };
            await saveBotState(tgId, next);
            await ctx.reply(TXT_EMAIL_PROMPT, {
                reply_markup: { remove_keyboard: true },
            });
            return;
        }

        const service = await loadServiceById(state.data.serviceId);
        if (!service || !service.isActive) {
            await ctx.reply(TXT_SERVICE_UNAVAILABLE);
            await clearBotState(tgId);
            return;
        }
        await transitionToConfirm(ctx, tgId, state, service, state.data.date, state.data.time);
        return;
    }

    if (missing.includes("email")) {
        const normalised = validateEmail(text);
        if (!normalised) {
            await ctx.reply(TXT_EMAIL_INVALID);
            return;
        }
        await persistCustomerEmail(customerId, normalised);

        const service = await loadServiceById(state.data.serviceId);
        if (!service || !service.isActive) {
            await ctx.reply(TXT_SERVICE_UNAVAILABLE);
            await clearBotState(tgId);
            return;
        }

        // No "phone" left — but `transitionToConfirm` always sends the
        // remove_keyboard ack first. There's no reply keyboard active here
        // (it would have been dropped when phone was first persisted), so
        // sending an extra empty-state message is harmless and idempotent
        // from the user's perspective.
        const remaining = missing.filter((m) => m !== "email");
        const stripped: BotStateBook = {
            ...state,
            data: { ...state.data, missing: remaining },
        };
        await transitionToConfirm(ctx, tgId, stripped, service, state.data.date, state.data.time);
        return;
    }
}
