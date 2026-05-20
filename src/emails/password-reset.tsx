/**
 * Password reset email — sent in response to POST /api/auth/forgot-password.
 *
 * The link points at /auth/reset-password?token=<plain> where <plain> is the
 * raw token. The DB stores only its sha256 hash (see
 * `/api/auth/forgot-password/route.ts`). The link is single-use and expires
 * after 30 minutes.
 */
import { Heading, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface PasswordResetEmailProps {
    customerFirstName: string;
    resetUrl: string;
    /** Minutes until the link expires. */
    ttlMinutes: number;
}

export default function PasswordReset(props: PasswordResetEmailProps) {
    return (
        <EmailLayout preview="Сброс пароля PiercerKZN">
            <Heading
                as="h1"
                style={{
                    fontSize: "22px",
                    margin: "0 0 12px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                Сброс пароля
            </Heading>
            <Text
                style={{
                    fontSize: "14px",
                    color: emailColors.inkMuted,
                    margin: "0 0 16px",
                }}
            >
                {props.customerFirstName}, мы получили запрос на сброс пароля для вашего аккаунта
                PiercerKZN. Перейдите по ссылке ниже, чтобы задать новый пароль.
            </Text>

            <Section style={{ margin: "0 0 20px" }}>
                <a
                    href={props.resetUrl}
                    style={{
                        display: "inline-block",
                        backgroundColor: emailColors.accent,
                        color: "#0e0e10",
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: "12px",
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        padding: "12px 20px",
                        textDecoration: "none",
                        fontWeight: 600,
                    }}
                >
                    Задать новый пароль
                </a>
            </Section>

            <Text
                style={{
                    fontSize: "12px",
                    color: emailColors.inkMuted,
                    margin: "0 0 8px",
                }}
            >
                Если кнопка не работает, скопируйте ссылку в адресную строку:
            </Text>
            <Text
                style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "12px",
                    color: emailColors.ink,
                    margin: "0 0 16px",
                    wordBreak: "break-all",
                }}
            >
                <a
                    href={props.resetUrl}
                    style={{ color: emailColors.accent, textDecoration: "underline" }}
                >
                    {props.resetUrl}
                </a>
            </Text>

            <Text
                style={{
                    fontSize: "12px",
                    color: emailColors.inkMuted,
                    margin: 0,
                }}
            >
                Ссылка действует {props.ttlMinutes} мин и подходит только для одного входа. Если
                запрос отправили не вы — просто проигнорируйте письмо: пароль не изменится.
            </Text>
        </EmailLayout>
    );
}
