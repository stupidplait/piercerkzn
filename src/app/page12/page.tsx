import Link from "next/link";
import styles from "./page.module.css";
import { ScrollJewelClient } from "./ScrollJewelClient";
import { BalenciagaPortfolio } from "./BalenciagaPortfolio";
import { ChromeHeader } from "@/components/ChromeHeader";
import { Reveal } from "./Reveal";
import { HeroSpotlight } from "./HeroSpotlight";
import { PageMotion } from "./PageMotion";
import { MagneticCta } from "./MagneticCta";

const stats = [
    { k: "5 000+", v: "клиентов" },
    { k: "300+", v: "украшений" },
    { k: "10", v: "лет в ремесле" },
];

const chapters = [
    {
        num: "01",
        title: "Выбор.",
        body: "Покрутите украшение в 3D, примерьте на своей анатомии, сравните металлы и камни — до прокола, до брони, до разговора с мастером.",
        meta: "ТОЧНОСТЬ 0.1 ММ",
    },
    {
        num: "02",
        title: "Металл.",
        body: "Титан G23 по ASTM F136, золото 585/750, ниобий. Никакой хирургической стали. Сертификат на каждую партию — в архиве студии.",
        meta: "ASTM F136",
    },
    {
        num: "03",
        title: "Слот.",
        body: "Украшение уходит из каталога, когда вы бронируете, и возвращается, если не пришли. Оплата — в студии, наличными или переводом.",
        meta: "БЕЗ ОНЛАЙН-ОПЛАТ",
    },
];

const services = [
    { n: "A01", zone: "Ухо", title: "Мочка", time: "15 мин", price: "1 500" },
    { n: "A02", zone: "Ухо", title: "Helix", time: "20 мин", price: "2 500" },
    { n: "A03", zone: "Ухо", title: "Tragus", time: "20 мин", price: "2 800" },
    { n: "A04", zone: "Ухо", title: "Daith", time: "25 мин", price: "3 200" },
    { n: "A05", zone: "Ухо", title: "Conch", time: "25 мин", price: "3 000" },
    { n: "A06", zone: "Ухо", title: "Rook", time: "25 мин", price: "3 200" },
    { n: "B01", zone: "Нос", title: "Ноздря", time: "15 мин", price: "2 200" },
    { n: "B02", zone: "Нос", title: "Septum", time: "25 мин", price: "3 200" },
    { n: "C01", zone: "Лицо", title: "Бровь", time: "20 мин", price: "2 800" },
    { n: "C02", zone: "Лицо", title: "Labret", time: "25 мин", price: "3 000" },
    { n: "C03", zone: "Лицо", title: "Medusa", time: "25 мин", price: "3 200" },
    { n: "D01", zone: "Тело", title: "Пупок", time: "25 мин", price: "3 000" },
];

const heroWords1 = ["ПРИМЕРЬ"];
const heroWords2 = ["ДО", "ПРОКОЛА."];

export default function Page12() {
    return (
        <main className={styles.page}>
            {/* floating 3D jewel — fixed viewport overlay */}
            <ScrollJewelClient />
            <PageMotion />

            <ChromeHeader className={styles.nav}>
                <Link href="/" className={styles.navBrand}>
                    <span>PIERCER</span>
                    <span className={styles.navBrandDot} aria-hidden />
                    <span>KZN</span>
                </Link>
                <ul className={styles.navLinks}>
                    <li>
                        <a href="#visualizer">Визуализатор</a>
                    </li>
                    <li>
                        <a href="#services">Каталог</a>
                    </li>
                    <li>
                        <a href="#how">Мастер</a>
                    </li>
                    <li>
                        <a href="#features">Уход</a>
                    </li>
                </ul>
                <div className={styles.navActions}>
                    <button className={styles.navGhost}>RU</button>
                    <a className={styles.navCta} href="#book">
                        <span className={styles.navCtaDot} aria-hidden />
                        Записаться
                    </a>
                </div>
            </ChromeHeader>

            <HeroSection />

            {/* ── HOW · chapters · full-bleed ───────────────────── */}
            <section className={styles.how} id="how">
                {chapters.map((c, i) => (
                    <Reveal key={c.num} className={styles.revealPlain} delay={i * 60}>
                        <article className={styles.chapter} data-jewel-chapter={i}>
                            <div className={styles.chapterLeft}>
                                <span className={styles.chapterNum}>{c.num}</span>
                            </div>
                            <div className={styles.chapterRight}>
                                <h2 className={styles.chapterTitle}>{c.title}</h2>
                                <p className={styles.chapterBody}>{c.body}</p>
                                <span className={styles.chapterMeta}>{c.meta}</span>
                            </div>
                        </article>
                    </Reveal>
                ))}
            </section>

            {/* ── SERVICES · table ──────────────────────────────── */}
            <Reveal className={styles.revealPlain}>
                <section className={styles.services} id="services">
                    <header className={styles.sectionHead}>
                        <h2>Все зоны — на одном экране.</h2>
                        <p>
                            Цены — от. Финальная сумма зависит от выбранного украшения. Нажмите на
                            строку, чтобы открыть слот.
                        </p>
                    </header>

                    <table className={styles.servicesTable}>
                        <colgroup>
                            <col style={{ width: "10%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "auto" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "7%" }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colN}>
                                    №
                                </th>
                                <th scope="col" className={styles.colZone}>
                                    Зона
                                </th>
                                <th scope="col" className={styles.colName}>
                                    Услуга
                                </th>
                                <th scope="col" className={styles.colTime}>
                                    Время
                                </th>
                                <th scope="col" className={styles.colPrice}>
                                    Цена · от
                                </th>
                                <th
                                    scope="col"
                                    className={styles.colCta}
                                    aria-label="Записаться"
                                ></th>
                            </tr>
                        </thead>
                        <tbody>
                            {services.map((s) => (
                                <tr key={s.n} className={styles.serviceRow}>
                                    <td className={styles.colN}>{s.n}</td>
                                    <td className={styles.colZone}>
                                        <span className={styles.zoneChip}>{s.zone}</span>
                                    </td>
                                    <td className={styles.colName}>{s.title}</td>
                                    <td className={styles.colTime}>{s.time}</td>
                                    <td className={styles.colPrice}>{s.price} ₽</td>
                                    <td className={styles.colCta}>
                                        <span className={styles.rowArrow} aria-hidden>
                                            ↗
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            </Reveal>

            <BalenciagaPortfolio />

            {/* ── FEATURES · 8-col bento ────────────────────────── */}
            <Reveal className={styles.revealPlain}>
                <section className={styles.features} id="features">
                    <header className={styles.sectionHead}>
                        <h2>Студия, собранная как продукт.</h2>
                        <p>
                            Что вы получаете помимо самой услуги прокола — инфраструктура, за
                            которой мы следим как за софтом.
                        </p>
                    </header>

                    <div className={styles.bento}>
                        <article className={`${styles.cell} ${styles.cellHero} ${styles.span5}`}>
                            <div className={styles.cellHeroViz} aria-hidden>
                                <div className={styles.vizRing} />
                                <div className={styles.vizRing2} />
                                <div className={styles.vizCore} />
                            </div>
                            <div className={styles.cellCopy}>
                                <span className={styles.cellKicker}>3D-примерка</span>
                                <h3>Увидеть украшение до прокола.</h3>
                                <p>
                                    Анатомически точные модели для 6 зон тела. 300+ украшений с
                                    PBR-материалами, честное освещение, никаких фильтров.
                                </p>
                                <a className={styles.cellLink}>Открыть визуализатор →</a>
                            </div>
                        </article>

                        <article className={`${styles.cell} ${styles.cellTall} ${styles.span3}`}>
                            <div className={styles.cellVizSmall}>
                                <div className={styles.ticketRow}>
                                    <span>Helix · ухо</span>
                                    <span className={styles.ticketBadge}>В брони</span>
                                </div>
                                <div className={styles.ticketRow}>
                                    <span>Septum · нос</span>
                                    <span className={styles.ticketBadge}>В брони</span>
                                </div>
                                <div className={styles.ticketRow}>
                                    <span>Мочка</span>
                                    <span className={styles.ticketBadgeMuted}>72 ч</span>
                                </div>
                            </div>
                            <span className={styles.cellKicker}>Бронирование</span>
                            <h3>Забронируйте — платите в студии.</h3>
                            <p>
                                Никаких онлайн-оплат. Украшение держится 72 часа, потом
                                автоматически возвращается в каталог.
                            </p>
                        </article>

                        <article className={`${styles.cell} ${styles.span2}`}>
                            <div className={styles.matRow}>
                                <span className={styles.matChip}>
                                    <span /> Титан G23
                                </span>
                                <span className={styles.matChip}>
                                    <span /> Золото 585
                                </span>
                                <span className={styles.matChip}>
                                    <span /> Ниобий
                                </span>
                                <span className={styles.matChip}>
                                    <span /> Золото 750
                                </span>
                            </div>
                            <span className={styles.cellKicker}>Материалы</span>
                            <h3>Только имплантационные сплавы.</h3>
                        </article>

                        <article className={`${styles.cell} ${styles.span3}`}>
                            <div className={styles.tgChat}>
                                <div className={styles.tgMsg}>Чек-лист на сегодня:</div>
                                <div className={styles.tgMsg}>· физ. раствор 2×</div>
                                <div className={styles.tgMsg}>· без прикосновений</div>
                                <div className={styles.tgMsgAlt}>Понятно, спасибо!</div>
                            </div>
                            <span className={styles.cellKicker}>Telegram-бот</span>
                            <h3>Поддержка до полного заживления.</h3>
                        </article>

                        <article className={`${styles.cell} ${styles.span3}`}>
                            <div className={styles.timeline}>
                                <div className={styles.tlRow}>
                                    <span>Д+0</span>
                                    <div className={styles.tlBar} />
                                </div>
                                <div className={styles.tlRow}>
                                    <span>Д+7</span>
                                    <div className={styles.tlBar} data-mid />
                                </div>
                                <div className={styles.tlRow}>
                                    <span>Д+14</span>
                                    <div className={styles.tlBar} data-mid />
                                </div>
                                <div className={styles.tlRow}>
                                    <span>Д+30</span>
                                    <div className={styles.tlBar} data-full />
                                </div>
                            </div>
                            <span className={styles.cellKicker}>Уход</span>
                            <h3>План на 4 недели после прокола.</h3>
                        </article>
                    </div>
                </section>
            </Reveal>

            {/* ── CTA ───────────────────────────────────────────── */}
            <Reveal className={styles.revealPlain}>
                <section className={styles.cta} id="book">
                    <div className={styles.ctaGlow} aria-hidden />
                    <h2 className={styles.ctaTitle}>
                        Готовы?
                        <br />
                        <span className={styles.ctaAccent}>Забронируйте слот</span> за 30 секунд.
                    </h2>
                    <p className={styles.ctaLede}>
                        Ответим в Telegram в течение 10 минут · Баумана&nbsp;38 · Казань
                    </p>
                    <div className={styles.ctaCtas}>
                        <MagneticCta className={styles.btnPrimary}>
                            Записаться на приём <span aria-hidden>→</span>
                        </MagneticCta>
                        <a className={styles.btnGhost}>Написать в Telegram</a>
                    </div>
                </section>
            </Reveal>

            {/* ── FOOTER ────────────────────────────────────────── */}
            <Reveal className={styles.revealPlain}>
                <footer className={styles.footer}>
                    <div className={styles.footerCols}>
                        <p className={styles.footerDesc}>
                            Частная пирсинг-студия в&nbsp;Казани с&nbsp;2016 года. Один мастер, одно
                            кресло, полная концентрация на&nbsp;вас.
                        </p>
                        <div className={styles.footerPark} data-jewel-park aria-hidden />
                        <div className={styles.footerLinks}>
                            <div>
                                <span className={styles.footerH}>Продукт</span>
                                <a>3D-визуализатор</a>
                                <a>Каталог украшений</a>
                                <a>Бронирование</a>
                                <a>Telegram-бот</a>
                            </div>
                            <div>
                                <span className={styles.footerH}>Студия</span>
                                <a>Мастер</a>
                                <a>Портфолио</a>
                                <a>Отзывы</a>
                                <a>Журнал</a>
                            </div>
                            <div>
                                <span className={styles.footerH}>Связь</span>
                                <a>Telegram · @piercerkzn</a>
                                <a>Instagram · @piercer.kzn</a>
                                <a>hello@piercerkzn.ru</a>
                                <a>+7 (843) 000-00-00</a>
                            </div>
                        </div>
                    </div>

                    <div className={styles.footerWordmark} aria-hidden data-footer-wordmark>
                        PIERCER<span>/</span>KZN
                    </div>

                    <div className={styles.footerBase}>
                        <span>© 2016 — 2026 piercer.kzn</span>
                        <span>НАПРАВЛЕНИЕ 12 · ПРЕМИУМ-ИЗДАНИЕ</span>
                        <span>СДЕЛАНО В КАЗАНИ</span>
                    </div>
                </footer>
            </Reveal>
        </main>
    );
}

function HeroSection() {
    return (
        <section className={styles.hero} id="visualizer" data-hero-root>
            <HeroSpotlight />
            <div className={styles.heroGrid}>
                <div className={styles.heroContent}>
                    <span className={styles.heroBadge}>
                        <span className={styles.heroBadgeDot} aria-hidden />
                        3D В РЕАЛЬНОМ ВРЕМЕНИ · WEBGL 2.0
                    </span>

                    <h1 className={styles.heroTitle}>
                        <span className={styles.heroLine1}>
                            {heroWords1.map((w, i) => (
                                <span
                                    key={i}
                                    style={
                                        {
                                            ["--i" as string]: i,
                                        } as React.CSSProperties
                                    }
                                >
                                    {w}
                                </span>
                            ))}
                        </span>
                        <span className={styles.heroLine2}>
                            {heroWords2.map((w, i) => (
                                <span
                                    key={i}
                                    style={
                                        {
                                            ["--i" as string]: i + 1,
                                        } as React.CSSProperties
                                    }
                                >
                                    {w}
                                    {i < heroWords2.length - 1 ? "\u00A0" : ""}
                                </span>
                            ))}
                        </span>
                    </h1>

                    <p className={styles.heroLede}>
                        Единственная в&nbsp;Казани студия пирсинга с&nbsp;настоящей 3D-примеркой
                        украшений. Покрутите кольцо в&nbsp;окне справа, выберите металл
                        и&nbsp;камень, забронируйте слот&nbsp;— платите в&nbsp;студии.
                    </p>

                    <div className={styles.heroCtas}>
                        <MagneticCta className={styles.btnPrimary} href="#book">
                            Записаться на приём
                            <span aria-hidden>↗</span>
                        </MagneticCta>
                        <a className={styles.btnGhost} href="#how">
                            Как это работает
                        </a>
                    </div>

                    <div className={styles.heroStats}>
                        {stats.map((s) => (
                            <div key={s.v} className={styles.heroStat}>
                                <span className={styles.heroStatK}>{s.k}</span>
                                <span className={styles.heroStatV}>{s.v}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <aside className={styles.heroWindow} aria-label="Визуализатор" data-hero-window>
                    <div className={styles.winBar}>
                        <span />
                        <span />
                        <span />
                        <div className={styles.winUrl}>piercer.kzn/visualizer?item=ring-14g</div>
                    </div>
                    <div className={styles.winBody}>
                        <div className={styles.winStage} data-jewel-target>
                            <div className={styles.winStageGrid} aria-hidden />
                            <div className={styles.winStagePlaceholder}>RING · 14G · TITANIUM</div>
                        </div>
                    </div>
                </aside>
            </div>

            <div className={styles.marquee} aria-hidden>
                <div className={styles.marqueeTrack}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <span key={i} className={styles.marqueeSpan}>
                            HELIX
                            <span className={styles.dot} />
                            TRAGUS
                            <span className={styles.dot} />
                            CONCH
                            <span className={styles.dot} />
                            ROOK
                            <span className={styles.dot} />
                            DAITH
                            <span className={styles.dot} />
                            SEPTUM
                            <span className={styles.dot} />
                            NOSTRIL
                            <span className={styles.dot} />
                            LABRET
                            <span className={styles.dot} />
                            MEDUSA
                            <span className={styles.dot} />
                            EYEBROW
                            <span className={styles.dot} />
                            NAVEL
                            <span className={styles.dot} />
                            INDUSTRIAL
                            <span className={styles.dot} />
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}
