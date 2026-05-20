/**
 * Reservation expired notification — sent when the 72h hold elapses without
 * a pickup. Friendly, low-stakes copy: the visitor can rebook anytime.
 */
import { Heading, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface ReservationExpiredProps {
    referenceNumber: string;
    customerFirstName: string;
    rebookUrl?: string;
}

export default function ReservationExpired(props: ReservationExpiredProps) {
    return (
        <EmailLayout preview={`Бронь ${props.referenceNumber} истекла`}>
            <Heading
                as="h1"
                style={{
                    fontSize: "22px",
                    margin: "0 0 12px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                Бронь истекла
            </Heading>
            <Text style={{ fontSize: "14px", color: emailColors.inkMuted, margin: "0 0 16px" }}>
                {props.customerFirstName}, срок брони{" "}
                <span
                    style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        color: emailColors.accent,
                    }}
                >
                    {props.referenceNumber}
                </span>{" "}
                закончился, украшение возвращено в продажу.
            </Text>
            <Section>
                <Text style={{ fontSize: "14px", margin: 0 }}>
                    Если планы изменились — просто откройте новую бронь
                    {props.rebookUrl ? (
                        <>
                            {" "}
                            на сайте:{" "}
                            <a href={props.rebookUrl} style={{ color: emailColors.accent }}>
                                {props.rebookUrl}
                            </a>
                        </>
                    ) : (
                        "."
                    )}
                </Text>
            </Section>
        </EmailLayout>
    );
}
