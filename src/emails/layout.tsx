/**
 * Shared email layout. Russian-only, dark steel-atelier palette,
 * monospace for instrument-spec values (price, reference number, dates).
 *
 * Kept intentionally minimal — most clients (Gmail, Yandex, Mail.ru) strip
 * advanced CSS. Inline-friendly subset only.
 */
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

const colors = {
    bg: "#0e0e10",
    bgElev: "#16161a",
    ink: "#f5f5f7",
    inkMuted: "#9a9aa2",
    accent: "#f25195",
    rule: "#27272d",
};

const baseFont =
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export interface EmailLayoutProps {
    preview: string;
    children: ReactNode;
}

export function EmailLayout({ preview, children }: EmailLayoutProps) {
    return (
        <Html lang="ru">
            <Head />
            <Preview>{preview}</Preview>
            <Body
                style={{
                    backgroundColor: colors.bg,
                    color: colors.ink,
                    fontFamily: baseFont,
                    margin: 0,
                    padding: "32px 16px",
                }}
            >
                <Container
                    style={{
                        maxWidth: "560px",
                        margin: "0 auto",
                        backgroundColor: colors.bgElev,
                        border: `1px solid ${colors.rule}`,
                        padding: "32px 28px",
                    }}
                >
                    <Section>
                        <Text
                            style={{
                                fontFamily: '"JetBrains Mono", "Menlo", monospace',
                                fontSize: "11px",
                                letterSpacing: "0.18em",
                                textTransform: "uppercase",
                                color: colors.accent,
                                margin: 0,
                            }}
                        >
                            PiercerKZN — студия пирсинга
                        </Text>
                    </Section>
                    <Hr style={{ borderColor: colors.rule, margin: "20px 0" }} />
                    {children}
                    <Hr style={{ borderColor: colors.rule, margin: "32px 0 16px" }} />
                    <Text
                        style={{
                            fontSize: "11px",
                            color: colors.inkMuted,
                            margin: 0,
                        }}
                    >
                        Если письмо пришло по ошибке — просто проигнорируйте его.
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

export const emailColors = colors;
export const emailFont = baseFont;
