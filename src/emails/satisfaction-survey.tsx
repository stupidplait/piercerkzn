/**
 * Satisfaction survey email — fired seven days after an appointment is
 * marked completed. Subject «Запись `<referenceNumber>` — расскажите, как
 * прошло». Russian-only; the studio is fixed at МСК and the brand voice
 * matches the rest of the transactional pipeline.
 */
import { Heading, Link, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface SatisfactionSurveyEmailProps {
    /** Customer's first name (or appointment snapshot fallback). */
    customerFirstName: string;
    /** Studio-local ISO date `YYYY-MM-DD` of the visit. */
    appointmentDate: string;
    /** Public reference number of the appointment. */
    referenceNumber: string;
    /** Absolute URL to the studio's feedback target (Yandex/2GIS). */
    feedbackUrl?: string | null;
    /** Deep-link to the studio Telegram bot/chat. */
    telegramUrl?: string | null;
}

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
    return `${day} ${month}`;
}

export default function SatisfactionSurveyEmail(props: SatisfactionSurveyEmailProps) {
    const preview = "Прошла неделя после визита — поделитесь впечатлениями";
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
                Прошла неделя — как ощущения?
            </Heading>
            <Text
                style={{
                    fontSize: "14px",
                    color: emailColors.inkMuted,
                    margin: "0 0 24px",
                }}
            >
                {props.customerFirstName}, прошло 7 дней с визита{" "}
                {formatRussianDate(props.appointmentDate)} — короткий вопрос: всё ли в порядке с
                проколом и насколько комфортно было в студии.
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
                        fontSize: "16px",
                        margin: "4px 0 0",
                        color: emailColors.ink,
                    }}
                >
                    {props.referenceNumber}{" "}
                    <span style={{ color: emailColors.inkMuted }}>· {props.appointmentDate}</span>
                </Text>
            </Section>

            <Text
                style={{
                    fontSize: "14px",
                    color: emailColors.ink,
                    margin: "0 0 12px",
                    lineHeight: "1.55",
                }}
            >
                Если что-то идёт не так с заживлением — напишите нам в Telegram или на почту,
                разберёмся бесплатно.
            </Text>
            <Text
                style={{
                    fontSize: "14px",
                    color: emailColors.ink,
                    margin: "0 0 12px",
                    lineHeight: "1.55",
                }}
            >
                Если всё в порядке — оставьте отзыв в Яндексе или 2ГИС, либо ответьте этим письмом.
                Нам важно ваше слово.
            </Text>

            {props.feedbackUrl && (
                <Section style={{ marginTop: "16px" }}>
                    <Link
                        href={props.feedbackUrl}
                        style={{
                            display: "inline-block",
                            padding: "12px 18px",
                            backgroundColor: emailColors.accent,
                            color: "#0e0e10",
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "13px",
                            letterSpacing: "0.05em",
                            textDecoration: "none",
                        }}
                    >
                        Оставить отзыв →
                    </Link>
                </Section>
            )}

            {props.telegramUrl && (
                <Section style={{ marginTop: "12px" }}>
                    <Link
                        href={props.telegramUrl}
                        style={{
                            fontSize: "13px",
                            color: emailColors.accent,
                            textDecoration: "underline",
                        }}
                    >
                        Написать в Telegram
                    </Link>
                </Section>
            )}
        </EmailLayout>
    );
}
