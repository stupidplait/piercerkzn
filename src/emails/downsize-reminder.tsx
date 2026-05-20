/**
 * Downsize reminder email — fired ~6 weeks (42 days) after a piercing was
 * marked completed, only for piercing types in the studio settings list.
 * Russian-only. Layout matches the aftercare drip cadence so the customer
 * recognises it as part of the same studio thread.
 */
import { Heading, Link, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface DownsizeReminderEmailProps {
    /** Customer's first name (or appointment snapshot fallback). */
    customerFirstName: string;
    /** Studio-local ISO date `YYYY-MM-DD` of the piercing. */
    piercingDate: string;
    /** Display label, e.g. "Прокол хеликса". */
    piercingTypeLabel: string;
    /** Absolute URL to the booking flow on the storefront. */
    bookingUrl?: string | null;
    /** Direct link to the studio's Telegram chat. */
    telegramUrl?: string | null;
}

const PREVIEW = "6 недель после прокола — время на downsize";
const HEADING = "Шесть недель — пора подумать о downsize";
const PRIMARY_CTA = "Записаться на downsize →";
const SECONDARY_CTA = "Написать в Telegram";

export default function DownsizeReminderEmail(props: DownsizeReminderEmailProps) {
    const lead = `прошло 6 недель с прокола ${props.piercingDate} (${props.piercingTypeLabel}); пора заменить стартовую штангу на постоянную, более короткую.`;

    const paragraphs = [
        "Зачем нужен downsize: длинная штанга травмирует уже сформировавшийся канал — может появиться шишечка, гипергрануляция, искажение угла прокола.",
        "Сколько займёт визит: 15–20 минут, без повторного прокола; стерильный инструмент, обезболивание по желанию.",
        "Что делать сейчас: записаться на ближайший удобный слот; если нужна консультация — напишите.",
    ];

    return (
        <EmailLayout preview={PREVIEW}>
            <Heading
                as="h1"
                style={{
                    fontSize: "24px",
                    margin: "0 0 12px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                {HEADING}
            </Heading>
            <Text
                style={{
                    fontSize: "14px",
                    color: emailColors.inkMuted,
                    margin: "0 0 24px",
                }}
            >
                {props.customerFirstName}, {lead}
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
                    Дата прокола
                </Text>
                <Text
                    style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "16px",
                        margin: "4px 0 0",
                        color: emailColors.ink,
                    }}
                >
                    {props.piercingDate}{" "}
                    <span style={{ color: emailColors.inkMuted }}>· {props.piercingTypeLabel}</span>
                </Text>
            </Section>

            {paragraphs.map((p, idx) => (
                <Text
                    key={idx}
                    style={{
                        fontSize: "14px",
                        color: emailColors.ink,
                        margin: "0 0 12px",
                        lineHeight: "1.55",
                    }}
                >
                    {p}
                </Text>
            ))}

            {props.bookingUrl && (
                <Section style={{ marginTop: "16px" }}>
                    <Link
                        href={props.bookingUrl}
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
                        {PRIMARY_CTA}
                    </Link>
                </Section>
            )}

            {props.telegramUrl && (
                <Section style={{ marginTop: "12px" }}>
                    <Link
                        href={props.telegramUrl}
                        style={{
                            display: "inline-block",
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "12px",
                            letterSpacing: "0.05em",
                            color: emailColors.accent,
                            textDecoration: "underline",
                        }}
                    >
                        {SECONDARY_CTA}
                    </Link>
                </Section>
            )}
        </EmailLayout>
    );
}
