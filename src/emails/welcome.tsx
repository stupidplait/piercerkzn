/**
 * Account-created welcome — sent after a successful `registerAction`.
 * For visitors who registered as part of a reservation flow we include the
 * temporary password they'll need until they reset it.
 */
import { Heading, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export interface WelcomeEmailProps {
    customerFirstName: string;
    accountUrl: string;
    /** Set when the account was created server-side during checkout. */
    temporaryPassword?: string;
}

export default function Welcome(props: WelcomeEmailProps) {
    return (
        <EmailLayout preview="Аккаунт PiercerKZN создан">
            <Heading
                as="h1"
                style={{
                    fontSize: "22px",
                    margin: "0 0 12px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                Аккаунт создан
            </Heading>
            <Text style={{ fontSize: "14px", color: emailColors.inkMuted, margin: "0 0 16px" }}>
                {props.customerFirstName}, теперь вы можете отслеживать брони и записи в личном
                кабинете.
            </Text>

            {props.temporaryPassword ? (
                <Section
                    style={{
                        border: `1px solid ${emailColors.rule}`,
                        padding: "12px 16px",
                        marginBottom: "20px",
                    }}
                >
                    <Text
                        style={{
                            fontSize: "12px",
                            color: emailColors.inkMuted,
                            margin: 0,
                        }}
                    >
                        Временный пароль
                    </Text>
                    <Text
                        style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "16px",
                            color: emailColors.ink,
                            margin: "4px 0 0",
                        }}
                    >
                        {props.temporaryPassword}
                    </Text>
                    <Text
                        style={{
                            fontSize: "11px",
                            color: emailColors.inkMuted,
                            margin: "8px 0 0",
                        }}
                    >
                        Поменяйте пароль в личном кабинете при первом входе.
                    </Text>
                </Section>
            ) : null}

            <Section>
                <Text style={{ fontSize: "14px", margin: 0 }}>
                    <a href={props.accountUrl} style={{ color: emailColors.accent }}>
                        Войти в личный кабинет
                    </a>
                </Text>
            </Section>
        </EmailLayout>
    );
}
