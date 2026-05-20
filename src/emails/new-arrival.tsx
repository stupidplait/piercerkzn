/**
 * New-arrival email — fanout sent when a product first crosses
 * `status='published'`. Targets wishlist owners and marketing opt-ins.
 *
 * The subject + preview line differentiates wishlisted vs marketing
 * recipients so we can A/B-test copy if needed.
 */
import { Button, Heading, Img, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export type NewArrivalAudience = "wishlist" | "marketing";

export interface NewArrivalProps {
    /** Display name for greeting; falls back to "Привет!" when null. */
    customerFirstName?: string | null;
    audience: NewArrivalAudience;
    productHandle: string;
    productTitle: string;
    productMaterialLabel?: string | null;
    productJewelryTypeLabel?: string | null;
    /** Cheapest variant price in **kopecks** (RUB minor unit). */
    fromPriceKopecks?: number | null;
    /** Public CDN URL of the product hero/thumbnail. */
    thumbnailUrl?: string | null;
    /** Absolute URL — `${siteOrigin}/jewelry/${handle}`. */
    productUrl: string;
}

const COPY: Record<
    NewArrivalAudience,
    { heading: string; lead: string; preview: string; cta: string }
> = {
    wishlist: {
        heading: "Украшение из вашего вишлиста — теперь в наличии",
        lead: "Помним: вы добавили это украшение в вишлист. Сейчас оно опубликовано и доступно к брони.",
        preview: "Из вашего вишлиста — теперь доступно",
        cta: "Забронировать",
    },
    marketing: {
        heading: "Новинка в каталоге PiercerKZN",
        lead: "Свежее поступление — посмотрите, пока есть выбор гейджей и материалов.",
        preview: "Новинка в каталоге PiercerKZN",
        cta: "Посмотреть украшение",
    },
};

function formatRub(kopecks: number): string {
    return `${(kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}\u00A0₽`;
}

export default function NewArrival(props: NewArrivalProps) {
    const copy = COPY[props.audience];
    const greeting = props.customerFirstName ?? "Привет";
    const specs = [props.productMaterialLabel, props.productJewelryTypeLabel]
        .filter(Boolean)
        .join(" · ");

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
                {greeting}, {copy.lead}
            </Text>

            <Section
                style={{
                    border: `1px solid ${emailColors.rule}`,
                    padding: "16px",
                    marginBottom: "20px",
                }}
            >
                {props.thumbnailUrl && (
                    <Img
                        src={props.thumbnailUrl}
                        alt={props.productTitle}
                        width="520"
                        style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                            marginBottom: "12px",
                        }}
                    />
                )}
                <Text
                    style={{
                        fontSize: "18px",
                        margin: "0 0 4px",
                        color: emailColors.ink,
                        fontWeight: 600,
                    }}
                >
                    {props.productTitle}
                </Text>
                {specs && (
                    <Text
                        style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "12px",
                            letterSpacing: "0.05em",
                            color: emailColors.inkMuted,
                            margin: "0 0 8px",
                        }}
                    >
                        {specs}
                    </Text>
                )}
                {typeof props.fromPriceKopecks === "number" && (
                    <Text
                        style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: "16px",
                            color: emailColors.accent,
                            margin: 0,
                        }}
                    >
                        от {formatRub(props.fromPriceKopecks)}
                    </Text>
                )}
            </Section>

            <Section style={{ textAlign: "center", marginBottom: "20px" }}>
                <Button
                    href={props.productUrl}
                    style={{
                        backgroundColor: emailColors.accent,
                        color: emailColors.bg,
                        padding: "12px 24px",
                        fontSize: "14px",
                        textDecoration: "none",
                        display: "inline-block",
                        fontFamily: '"JetBrains Mono", monospace',
                        letterSpacing: "0.05em",
                    }}
                >
                    {copy.cta}
                </Button>
            </Section>

            {props.audience === "marketing" && (
                <Section style={{ borderTop: `1px solid ${emailColors.rule}`, paddingTop: "12px" }}>
                    <Text style={{ fontSize: "12px", margin: 0, color: emailColors.inkMuted }}>
                        Вы получили это письмо, потому что согласились на новости и подборки от
                        PiercerKZN. Отписаться можно в личном кабинете в настройках уведомлений.
                    </Text>
                </Section>
            )}
        </EmailLayout>
    );
}
