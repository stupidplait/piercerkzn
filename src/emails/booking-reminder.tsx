/**
 * Booking reminder email — fired 24h and 2h before an appointment by the
 * BullMQ worker (or the Vercel cron sweeper). Same look as
 * `appointment-confirmation.tsx`; copy diverges based on `kind`.
 */
import { Heading, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export type BookingReminderKind = "24h" | "2h";

export interface BookingReminderProps {
    referenceNumber: string;
    customerFirstName: string;
    /** ISO date `YYYY-MM-DD` of the appointment (studio-local). */
    date: string;
    /** `HH:MM` start time (studio-local). */
    timeStart: string;
    /** `HH:MM` end time (studio-local). */
    timeEnd: string;
    /** Display names of the booked services. */
    services: string[];
    /** Studio address — pulled from the `studio.address` setting at dispatch time. */
    studioAddress?: string;
    kind: BookingReminderKind;
}

const RU_DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const RU_MONTHS = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
];

function formatRussianDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    const day = d.getUTCDate();
    const month = RU_MONTHS[d.getUTCMonth()];
    const dow = RU_DAYS[d.getUTCDay()];
    return `${dow}, ${day} ${month}`;
}

const COPY: Record<BookingReminderKind, { heading: string; lead: string; preview: string }> = {
    "24h": {
        heading: "Напоминание: вы записаны завтра",
        lead: "Напоминаем, что ждём вас в студии завтра. Если планы изменились — отмените или перенесите запись в личном кабинете.",
        preview: "Запись завтра — напоминание из PiercerKZN",
    },
    "2h": {
        heading: "Через 2 часа ждём вас в студии",
        lead: "Скоро встречаемся. Возьмите с собой паспорт. Перекусите перед визитом — лёгкий приём пищи помогает легче переносить процедуру.",
        preview: "До приёма 2 часа — напоминание из PiercerKZN",
    },
};

export default function BookingReminder(props: BookingReminderProps) {
    const copy = COPY[props.kind];
    return (
        <EmailLayout preview={copy.preview}>
            <Heading
                as="h1"
                style={{
                    fontSize: "24px",
                    margin: "0 0 12px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                {copy.heading}
            </Heading>
            <Text style={{ fontSize: "14px", color: emailColors.inkMuted, margin: "0 0 24px" }}>
                {props.customerFirstName}, {copy.lead}
            </Text>

            <Section
                style={{
                    border: `1px solid ${emailColors.rule}`,
                    padding: "16px",
                    marginBottom: "20px",
                }}
            >
                <Text
                    style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "12px",
                        letterSpacing: "0.1em",
                        color: emailColors.inkMuted,
                        margin: 0,
                    }}
                >
                    Номер записи
                </Text>
                <Text
                    style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "20px",
                        margin: "4px 0 0",
                        color: emailColors.accent,
                    }}
                >
                    {props.referenceNumber}
                </Text>
            </Section>

            <Section
                style={{
                    border: `1px solid ${emailColors.rule}`,
                    padding: "16px",
                    marginBottom: "20px",
                }}
            >
                <Text
                    style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "12px",
                        letterSpacing: "0.1em",
                        color: emailColors.inkMuted,
                        margin: 0,
                    }}
                >
                    Когда
                </Text>
                <Text style={{ fontSize: "16px", margin: "4px 0 0", color: emailColors.ink }}>
                    {formatRussianDate(props.date)}
                    <br />
                    <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        {props.timeStart} — {props.timeEnd}
                    </span>
                    <span style={{ color: emailColors.inkMuted, fontSize: "12px" }}> МСК</span>
                </Text>
            </Section>

            {props.services.length > 0 && (
                <Section style={{ marginBottom: "20px" }}>
                    <Text
                        style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "12px",
                            letterSpacing: "0.1em",
                            color: emailColors.inkMuted,
                            margin: "0 0 8px",
                        }}
                    >
                        Услуги
                    </Text>
                    {props.services.map((title, idx) => (
                        <Text
                            key={idx}
                            style={{
                                fontSize: "14px",
                                color: emailColors.ink,
                                margin: "4px 0",
                            }}
                        >
                            • {title}
                        </Text>
                    ))}
                </Section>
            )}

            {props.studioAddress && (
                <Section
                    style={{
                        borderTop: `1px solid ${emailColors.rule}`,
                        paddingTop: "12px",
                    }}
                >
                    <Text style={{ fontSize: "13px", margin: 0 }}>
                        Адрес: {props.studioAddress}
                    </Text>
                </Section>
            )}
        </EmailLayout>
    );
}
