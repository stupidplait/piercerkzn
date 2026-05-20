import { SITE } from "@/lib/site";

interface SiteFooterProps {
    classes: {
        siteFooter: string;
        footerCols: string;
        footerDesc: string;
        footerLinks: string;
        footerH: string;
        footerWordmark: string;
        footerBase: string;
    };
}

const NBSP = " ";
const FOOTER_DESC =
    `Частная пирсинг-студия в${NBSP}Казани с${NBSP}${SITE.foundedYear}${NBSP}года. ` +
    `Один мастер, одно кресло, полная концентрация на${NBSP}вас.`;

export function SiteFooter({ classes }: SiteFooterProps) {
    const currentYear = new Date().getFullYear();
    return (
        <footer className={classes.siteFooter}>
            <div className={classes.footerCols}>
                <p className={classes.footerDesc}>{FOOTER_DESC}</p>
                <div className={classes.footerLinks}>
                    <div>
                        <span className={classes.footerH}>Продукт</span>
                        <a href="#showcase">3D-визуализатор</a>
                        <a href="#try-on">Каталог украшений</a>
                        <a href="#reserve">Бронирование</a>
                        <a href={SITE.telegram} target="_blank" rel="noreferrer noopener">
                            Telegram-бот
                        </a>
                    </div>
                    <div>
                        <span className={classes.footerH}>Студия</span>
                        <span>Мастер</span>
                        <span>{SITE.address}</span>
                        <span>Каждый день · 11:00—21:00</span>
                    </div>
                    <div>
                        <span className={classes.footerH}>Связь</span>
                        <a href={SITE.telegram} target="_blank" rel="noreferrer noopener">
                            Telegram · @piercerkzn
                        </a>
                        <a href={SITE.instagram} target="_blank" rel="noreferrer noopener">
                            Instagram · @piercer.kzn
                        </a>
                        <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
                        <a href={`tel:${SITE.phone.replace(/[^+\d]/g, "")}`}>{SITE.phone}</a>
                    </div>
                </div>
            </div>

            <div className={classes.footerWordmark} aria-hidden="true">
                PIERCER<span>/</span>KZN
            </div>

            <div className={classes.footerBase}>
                <span>
                    © {SITE.foundedYear} — {currentYear} piercer.kzn
                </span>
                <span>Steel Atelier · v1.0</span>
                <span>Сделано в Казани</span>
            </div>
        </footer>
    );
}
