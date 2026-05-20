/**
 * Aftercare drip email — fired across the 7-step cadence
 * (Day 1 / Day 3 / Day 7 / Day 14 / Day 30 / Day 60 / Day 90) after an
 * appointment is marked completed. Copy diverges per `step`; the layout
 * matches the rest of the studio's transactional mail.
 */
import { Heading, Link, Section, Text } from "@react-email/components";

import { EmailLayout, emailColors } from "./layout";

export type { AftercareStep } from "@/lib/aftercare/time";
import type { AftercareStep } from "@/lib/aftercare/time";

export interface AftercareStepEmailProps {
    /** Customer's first name (or appointment snapshot fallback). */
    customerFirstName: string;
    /** Studio-local ISO date `YYYY-MM-DD` of the piercing. */
    piercingDate: string;
    /** Display label, e.g. "Прокол хеликса". */
    piercingTypeLabel?: string | null;
    /** Optional handle of the matching `aftercare_guide` to deep-link to. */
    guideHandle?: string | null;
    /** Absolute URL to the guide on the storefront. */
    guideUrl?: string | null;
    step: AftercareStep;
}

interface Copy {
    heading: string;
    preview: string;
    lead: string;
    /** Body paragraphs rendered as separate <Text> blocks. */
    paragraphs: string[];
    cta: string;
}

const COPY: Record<AftercareStep, Copy> = {
    day1: {
        heading: "День 1 — самое важное начало",
        preview: "День 1 после прокола — что делать сегодня",
        lead: "Прошёл первый день после прокола. Сейчас важна гигиена и спокойствие — не трогайте украшение лишний раз.",
        paragraphs: [
            "Промывайте место прокола 2 раза в день стерильным физраствором (0,9% NaCl) или морской водой без отдушек.",
            "Не снимайте украшение. Не крутите его и не давите. Сухие корочки трогать нельзя — они отойдут сами.",
            "Спите так, чтобы не лежать на проколе. Полотенце меняйте на одноразовые бумажные на 2–3 недели.",
        ],
        cta: "Открыть полный гайд",
    },
    day3: {
        heading: "День 3 — отёк должен пойти на спад",
        preview: "3 дня после прокола — следим за реакцией",
        lead: "Прошло три дня. Отёк и краснота уже не должны нарастать — это нормальная реакция тела, и сейчас она постепенно затихает.",
        paragraphs: [
            "Продолжайте 2 промывания в день стерильным физраствором. Никаких спиртов, перекиси водорода или мирамистина — они только травмируют ткани и тормозят заживление.",
            "Спите на стороне без прокола. Полотенце для лица — только одноразовые бумажные, чтобы не заносить бактерии с ткани.",
            "Если боль усиливается, появилось отделяемое жёлтого или зелёного цвета или поднялась температура — пишите нам сразу, не ждите.",
        ],
        cta: "Открыть полный гайд",
    },
    day7: {
        heading: "Неделя 1 — как идёт заживление",
        preview: "Неделя после прокола — следим за реакцией кожи",
        lead: "Если в первые дни был отёк, покраснение, пульсация — это нормально. К концу первой недели они должны уменьшаться, а не нарастать.",
        paragraphs: [
            "Продолжайте 2 промывания в день. Не подменяйте физраствор спиртом, перекисью или мирамистином — они травмируют ткани.",
            "Душ — да, но без мыла и шампуня на проколе. Бассейн, баня, открытые водоёмы — нет ещё минимум 3 месяца.",
            "Сильное усиление боли, гной, повышение температуры — повод написать нам, не ждите.",
        ],
        cta: "Памятка по уходу",
    },
    day14: {
        heading: "Неделя 2 — переходим в спокойный режим",
        preview: "2 недели после прокола — что меняется",
        lead: "Поверхностное заживление обычно к этому времени уже видно: кожа вокруг украшения становится спокойнее.",
        paragraphs: [
            "Можно сократить промывания до 1 раза в день, если нет выделений и отёка.",
            "Глубокое заживление продолжается ещё долго — 3–6 месяцев в среднем. Менять украшение пока рано.",
            "Если периодически появляется припухлость, шишечка, гипергрануляция — напишите нам, разберёмся.",
        ],
        cta: "Полный гайд по заживлению",
    },
    day30: {
        heading: "Месяц 1 — пора подумать о замене",
        preview: "Месяц после прокола — следующий шаг",
        lead: "Прошёл месяц. Если заживление идёт ровно, можно начинать планировать замену стартового украшения на постоянное (downsize).",
        paragraphs: [
            "Downsize — это укорачивание штанги или замена украшения на более короткое. Без этого заживший канал может «обрасти» лишней тканью.",
            "Не меняйте украшение сами. Запишитесь в студию — посмотрим, готов ли прокол, и подберём вариант.",
            "Если что-то беспокоит даже через месяц, не откладывайте — лучше один лишний визит, чем долгое лечение.",
        ],
        cta: "Записаться на замену украшения",
    },
    day60: {
        heading: "2 месяца — глубокое заживление продолжается",
        preview: "2 месяца после прокола — что ждать",
        lead: "Внешне всё уже выглядит спокойно, но канал ещё формируется внутри. Не торопимся менять украшение самостоятельно — это до сих пор риск.",
        paragraphs: [
            "Промывания можно прекратить, если нет выделений и припухлости. Если что-то ещё периодически беспокоит — продолжайте 1 раз в день.",
            "Бассейн, баня, открытые водоёмы — всё ещё нет, минимум до 3-го месяца. Ванна дома — короткая и чистая, без длительного отмокания.",
            "Если давно не были на downsize — самое время записаться. Длинная штанга цепляется и травмирует канал, заживление откатывается назад.",
        ],
        cta: "Записаться на замену украшения",
    },
    day90: {
        heading: "3 месяца — финиш базового заживления",
        preview: "3 месяца после прокола — итоги",
        lead: "Поздравляем — основной этап позади. Расскажем, что значит «зажил» и как теперь обращаться с проколом без лишней тревоги.",
        paragraphs: [
            "Зажившим прокол считается, когда нет боли, отделяемого, шишечек, а кожа вокруг спокойная и не реагирует на касание. Если хоть один пункт не сходится — заживление ещё идёт.",
            "Менять украшения уже можно, но только в студии или со стерильным инструментом дома — не голыми руками и не на ходу. Любой неаккуратный заход откатывает прокол на старт.",
            "Если что-то всё ещё беспокоит — это не «само пройдёт». Запишитесь на консультацию, разберём вместе и поправим, пока всё свежо.",
        ],
        cta: "Подобрать новое украшение в каталоге",
    },
};

export default function AftercareStepEmail(props: AftercareStepEmailProps) {
    const copy = COPY[props.step];
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
            <Text
                style={{
                    fontSize: "14px",
                    color: emailColors.inkMuted,
                    margin: "0 0 24px",
                }}
            >
                {props.customerFirstName}, {copy.lead}
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
                    {props.piercingDate}
                    {props.piercingTypeLabel ? (
                        <>
                            {" "}
                            <span style={{ color: emailColors.inkMuted }}>
                                · {props.piercingTypeLabel}
                            </span>
                        </>
                    ) : null}
                </Text>
            </Section>

            {copy.paragraphs.map((p, idx) => (
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

            {props.guideUrl && (
                <Section style={{ marginTop: "16px" }}>
                    <Link
                        href={props.guideUrl}
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
                        {copy.cta} →
                    </Link>
                </Section>
            )}
        </EmailLayout>
    );
}
