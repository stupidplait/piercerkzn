/**
 * Appointment confirmation email — sent immediately after a successful
 * `POST /api/booking/appointments`. Mirrors the look and tone of
 * `reservation-confirmation.tsx`.
 */
import { Heading, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface AppointmentConfirmationProps {
    referenceNumber: string;
    customerFirstName: string;
    /** ISO date `YYYY-MM-DD` of the appointment (studio-local). */
    date: string;
    /** `HH:MM` start time. */
    timeStart: string;
    /** `HH:MM` end time. */
    timeEnd: string;
    /** Display names of the booked services, in order. */
    services: string[];
    /** Estimated total in kopecks (cash-at-studio, informational). */
    estimatedTotal: number;
    studioAddress?: string;
}

const formatRub = (kopecks: number) =>
    `${(kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

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

export default function AppointmentConfirmation(props: AppointmentConfirmationProps) {
    const preview = `Запись ${props.referenceNumber} подтверждена`;
    return (
        <EmailLayout preview={preview}>
            <Heading
                as="h1"
                style={{
                    fontSize: "24px",
                    margin: "0 0 12px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                Запись принята
            </Heading>
            <Text style={{ fontSize: "14px", color: emailColors.inkMuted, margin: "0 0 24px" }}>
                {props.customerFirstName}, ждём вас в студии. Подробности ниже.
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
                <Text
                    style={{
                        fontSize: "16px",
                        margin: "4px 0 0",
                        color: emailColors.ink,
                    }}
                >
                    {formatRussianDate(props.date)}
                    <br />
                    <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        {props.timeStart} — {props.timeEnd}
                    </span>
                    <span style={{ color: emailColors.inkMuted, fontSize: "12px" }}> МСК</span>
                </Text>
            </Section>

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

            <Section
                style={{
                    borderTop: `1px solid ${emailColors.rule}`,
                    paddingTop: "12px",
                    marginBottom: "24px",
                }}
            >
                <Text style={{ fontSize: "14px", margin: 0 }}>
                    Стоимость (предварительно):{" "}
                    <strong
                        style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            color: emailColors.ink,
                        }}
                    >
                        {formatRub(props.estimatedTotal)}
                    </strong>
                </Text>
                <Text style={{ fontSize: "12px", color: emailColors.inkMuted, margin: "8px 0 0" }}>
                    Оплата наличными в студии. Финальная сумма зависит от выбранного украшения.
                </Text>
            </Section>

            {props.studioAddress && (
                <Section>
                    <Text style={{ fontSize: "13px", margin: 0 }}>
                        Адрес: {props.studioAddress}
                    </Text>
                </Section>
            )}
        </EmailLayout>
    );
}
