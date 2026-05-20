/**
 * Newsletter campaign email — admin-authored marketing broadcast sent to
 * the marketing-opt-in audience. Russian-only static copy; the body is
 * rendered through the in-house Markdown→React Email pipeline.
 *
 * The unsubscribe URL is the same one used by the RFC 8058 one-click
 * `List-Unsubscribe` header — surfacing it in the visible footer keeps the
 * opt-out reachable from clients that don't expose the header control.
 */
import { Link, Section, Text } from "@react-email/components";

import { renderMarkdownBody } from "@/lib/newsletters/markdown";

import { EmailLayout, emailColors } from "./layout";

export interface NewsletterCampaignEmailProps {
    /** Customer's first name. When absent the greeting falls back to «Здравствуйте!». */
    customerFirstName?: string | null;
    /** Used by the dispatcher as the SMTP `Subject:`; not rendered in the body. */
    subject: string;
    /** Optional inbox-preview line. Falls back to `subject` when absent. */
    preheader?: string | null;
    /** Admin-authored body in the constrained Markdown subset. */
    bodyMarkdown: string;
    /** Absolute URL of the unsubscribe endpoint with the recipient's HMAC token. */
    unsubscribeUrl: string;
}

export default function NewsletterCampaignEmail(props: NewsletterCampaignEmailProps) {
    const greeting = props.customerFirstName
        ? `Здравствуйте, ${props.customerFirstName}!`
        : "Здравствуйте!";
    const preview = props.preheader && props.preheader.length > 0 ? props.preheader : props.subject;

    return (
        <EmailLayout preview={preview}>
            <Text
                style={{
                    fontSize: "20px",
                    margin: "0 0 16px",
                    color: emailColors.ink,
                    fontWeight: 600,
                }}
            >
                {greeting}
            </Text>

            {renderMarkdownBody(props.bodyMarkdown)}

            <Section
                style={{
                    borderTop: `1px solid ${emailColors.rule}`,
                    marginTop: 24,
                }}
            />

            <Text
                style={{
                    fontSize: "12px",
                    color: emailColors.inkMuted,
                    margin: "16px 0 8px",
                    lineHeight: "1.55",
                }}
            >
                Вы получили это письмо, потому что подписались на новости PiercerKZN.
            </Text>

            <Text
                style={{
                    fontSize: "12px",
                    color: emailColors.inkMuted,
                    margin: 0,
                    lineHeight: "1.55",
                }}
            >
                <Link
                    href={props.unsubscribeUrl}
                    style={{
                        color: emailColors.inkMuted,
                        textDecoration: "underline",
                    }}
                >
                    Отписаться от рассылки
                </Link>
                {" · "}
                PiercerKZN — пирсинг-студия в Казани
            </Text>
        </EmailLayout>
    );
}
