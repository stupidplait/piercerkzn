/**
 * Reservation confirmation email — sent immediately after a successful
 * `POST /api/reservations`. Includes reference number, line items, total,
 * and the studio pickup window.
 */
import { Heading, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface ReservationConfirmationProps {
    referenceNumber: string;
    customerFirstName: string;
    items: { title: string; variantTitle?: string | null; quantity: number; total: number }[];
    totalKopecks: number;
    expiresAt: Date;
    studioAddress?: string;
    studioHours?: string;
}

const formatRub = (kopecks: number) =>
    `${(kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

const formatDate = (d: Date) =>
    d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour12: false }).replace(",", "");

export default function ReservationConfirmation(props: ReservationConfirmationProps) {
    const preview = `Бронь ${props.referenceNumber} принята`;
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
                Бронь принята
            </Heading>
            <Text style={{ fontSize: "14px", color: emailColors.inkMuted, margin: "0 0 24px" }}>
                {props.customerFirstName}, мы отложили украшения для вас на 72 часа.
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
                    Номер брони
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

            <Section style={{ marginBottom: "20px" }}>
                {props.items.map((item, idx) => (
                    <Text
                        key={idx}
                        style={{
                            fontSize: "14px",
                            color: emailColors.ink,
                            margin: "6px 0",
                        }}
                    >
                        <strong>{item.title}</strong>
                        {item.variantTitle ? ` — ${item.variantTitle}` : ""}
                        <br />
                        <span style={{ color: emailColors.inkMuted, fontSize: "12px" }}>
                            {item.quantity} × {formatRub(item.total / item.quantity)}
                        </span>
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
                    Сумма к оплате при визите:{" "}
                    <strong
                        style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            color: emailColors.ink,
                        }}
                    >
                        {formatRub(props.totalKopecks)}
                    </strong>
                </Text>
                <Text style={{ fontSize: "12px", color: emailColors.inkMuted, margin: "8px 0 0" }}>
                    Бронь действует до{" "}
                    <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        {formatDate(props.expiresAt)}
                    </span>{" "}
                    (МСК).
                </Text>
            </Section>

            {(props.studioAddress || props.studioHours) && (
                <Section>
                    {props.studioAddress && (
                        <Text style={{ fontSize: "13px", margin: "0 0 4px" }}>
                            Адрес: {props.studioAddress}
                        </Text>
                    )}
                    {props.studioHours && (
                        <Text style={{ fontSize: "13px", margin: 0, color: emailColors.inkMuted }}>
                            Часы работы: {props.studioHours}
                        </Text>
                    )}
                </Section>
            )}
        </EmailLayout>
    );
}
