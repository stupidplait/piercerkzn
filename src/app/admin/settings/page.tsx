"use client";

import { useState } from "react";
import styles from "../admin.module.css";

const SECTIONS = [
    "Студия",
    "Профиль мастера",
    "Политика записей",
    "Политика броней",
    "Уведомления",
    "Telegram-бот",
    "SEO",
];

type Toggles = {
    emailConfirmation: boolean;
    emailReminder: boolean;
    emailAftercare: boolean;
    smsConfirmation: boolean;
    smsReminder: boolean;
    telegramBot: boolean;
    telegramReservations: boolean;
    telegramBookings: boolean;
};

export default function SettingsPage() {
    const [section, setSection] = useState(0);
    const [saved, setSaved] = useState(false);
    const [toggles, setToggles] = useState<Toggles>({
        emailConfirmation: true,
        emailReminder: true,
        emailAftercare: false,
        smsConfirmation: false,
        smsReminder: false,
        telegramBot: true,
        telegramReservations: true,
        telegramBookings: true,
    });

    const toggle = (key: keyof Toggles) => {
        setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Настройки</h1>
                    <span className={styles.pageDesc}>Конфигурация студии</span>
                </div>
                <div className={styles.headerActions}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
                        {saved ? "✓ Сохранено" : "Сохранить изменения"}
                    </button>
                </div>
            </div>

            <div className={styles.settingsLayout}>
                {/* Sidebar nav */}
                <div className={styles.settingsSidebar}>
                    {SECTIONS.map((s, i) => (
                        <button
                            key={s}
                            className={`${styles.settingsNavItem} ${section === i ? styles.settingsNavItemActive : ""}`}
                            onClick={() => setSection(i)}
                        >
                            {s}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className={styles.settingsContent}>
                    {/* ── Студия ── */}
                    {section === 0 && (
                        <div className={styles.card}>
                            <h3 className={styles.settingGroupTitle}>Информация о студии</h3>
                            <div className={styles.cardBody}>
                                <div className={styles.formGrid}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Название студии</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="PiercerKZN"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Телефон</label>
                                        <input
                                            type="tel"
                                            className={styles.formInput}
                                            defaultValue="+7 (843) 000-00-00"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Email</label>
                                        <input
                                            type="email"
                                            className={styles.formInput}
                                            defaultValue="hello@piercerkzn.ru"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Telegram</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="@piercerkzn"
                                        />
                                    </div>
                                    <div
                                        className={`${styles.formGroup}`}
                                        style={{ gridColumn: "1 / -1" }}
                                    >
                                        <label className={styles.formLabel}>Адрес</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="Баумана 38 · Казань"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Instagram</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="@piercer.kzn"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Год основания</label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="2016"
                                        />
                                    </div>
                                </div>

                                <hr className={styles.divider} />
                                <span className={styles.formSectionTitle}>Рабочие часы</span>
                                <div className={styles.formGrid}>
                                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, i) => (
                                        <div
                                            key={day}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontFamily: "var(--font-mono)",
                                                    fontSize: "0.7rem",
                                                    width: 24,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {day}
                                            </span>
                                            <input
                                                type="time"
                                                className={styles.formInput}
                                                defaultValue={i < 6 ? "11:00" : "00:00"}
                                                style={{ flex: 1 }}
                                            />
                                            <span
                                                className={styles.tdMono}
                                                style={{ fontSize: "0.65rem" }}
                                            >
                                                —
                                            </span>
                                            <input
                                                type="time"
                                                className={styles.formInput}
                                                defaultValue={i < 6 ? "21:00" : "00:00"}
                                                style={{ flex: 1 }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Профиль мастера ── */}
                    {section === 1 && (
                        <div className={styles.card}>
                            <h3 className={styles.settingGroupTitle}>Публичный профиль мастера</h3>
                            <div className={styles.cardBody}>
                                <div className={styles.formGrid}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Имя</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="Рустам"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Фамилия</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="Нуриев"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Должность</label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="Мастер пирсинга"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Опыт (лет)</label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            defaultValue="9"
                                        />
                                    </div>
                                    <div
                                        className={`${styles.formGroup}`}
                                        style={{ gridColumn: "1 / -1" }}
                                    >
                                        <label className={styles.formLabel}>Биография</label>
                                        <textarea
                                            className={styles.formTextarea}
                                            defaultValue="Мастер пирсинга с 9-летним опытом. Специализация: хрящ уха, лицевой пирсинг, работа с украшениями премиум-класса из Европы и США."
                                            style={{ minHeight: 100 }}
                                        />
                                    </div>
                                    <div
                                        className={`${styles.formGroup}`}
                                        style={{ gridColumn: "1 / -1" }}
                                    >
                                        <label className={styles.formLabel}>
                                            Специализации (через запятую)
                                        </label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="Хрящ уха, Перегородка, Лицевой пирсинг, Замена украшений"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Политика записей ── */}
                    {section === 2 && (
                        <div className={styles.card}>
                            <h3 className={styles.settingGroupTitle}>Политика онлайн-записи</h3>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Минимальный срок записи (часов)
                                    </span>
                                    <span className={styles.settingDesc}>
                                        За сколько часов клиент может записаться онлайн
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    defaultValue="2"
                                    style={{ width: 80 }}
                                />
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Максимальный срок записи (дней)
                                    </span>
                                    <span className={styles.settingDesc}>
                                        На сколько дней вперёд клиент может записаться
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    defaultValue="30"
                                    style={{ width: 80 }}
                                />
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Длительность слота (минут)
                                    </span>
                                    <span className={styles.settingDesc}>Шаг сетки расписания</span>
                                </div>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    defaultValue="30"
                                    style={{ width: 80 }}
                                />
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Буфер между записями (минут)
                                    </span>
                                    <span className={styles.settingDesc}>
                                        Время между завершением одной записи и началом следующей
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    defaultValue="15"
                                    style={{ width: 80 }}
                                />
                            </div>
                        </div>
                    )}

                    {/* ── Политика броней ── */}
                    {section === 3 && (
                        <div className={styles.card}>
                            <h3 className={styles.settingGroupTitle}>
                                Политика резервирования украшений
                            </h3>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Время резерва (часов)
                                    </span>
                                    <span className={styles.settingDesc}>
                                        Как долго удерживается украшение после бронирования
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    defaultValue="72"
                                    style={{ width: 80 }}
                                />
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Максимум позиций в брони
                                    </span>
                                    <span className={styles.settingDesc}>
                                        Сколько украшений клиент может забронировать за раз
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    className={styles.formInput}
                                    defaultValue="5"
                                    style={{ width: 80 }}
                                />
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Автоматическое истечение
                                    </span>
                                    <span className={styles.settingDesc}>
                                        Автоматически отменять броню по истечении срока
                                    </span>
                                </div>
                                <label className={styles.toggleLabel}>
                                    <input type="checkbox" defaultChecked onChange={() => {}} />
                                    <span className={styles.toggleTrack} />
                                </label>
                            </div>
                        </div>
                    )}

                    {/* ── Уведомления ── */}
                    {section === 4 && (
                        <>
                            <div className={styles.card}>
                                <h3 className={styles.settingGroupTitle}>Email-уведомления</h3>
                                <div className={styles.settingRow}>
                                    <div className={styles.settingInfo}>
                                        <span className={styles.settingLabel}>
                                            Подтверждение брони
                                        </span>
                                        <span className={styles.settingDesc}>
                                            Отправлять письмо при создании брони
                                        </span>
                                    </div>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={toggles.emailConfirmation}
                                            onChange={() => toggle("emailConfirmation")}
                                        />
                                        <span className={styles.toggleTrack} />
                                    </label>
                                </div>
                                <div className={styles.settingRow}>
                                    <div className={styles.settingInfo}>
                                        <span className={styles.settingLabel}>
                                            Напоминание о записи
                                        </span>
                                        <span className={styles.settingDesc}>
                                            За 24 часа до визита
                                        </span>
                                    </div>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={toggles.emailReminder}
                                            onChange={() => toggle("emailReminder")}
                                        />
                                        <span className={styles.toggleTrack} />
                                    </label>
                                </div>
                                <div className={styles.settingRow}>
                                    <div className={styles.settingInfo}>
                                        <span className={styles.settingLabel}>
                                            Инструкции по уходу
                                        </span>
                                        <span className={styles.settingDesc}>
                                            После завершения записи
                                        </span>
                                    </div>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={toggles.emailAftercare}
                                            onChange={() => toggle("emailAftercare")}
                                        />
                                        <span className={styles.toggleTrack} />
                                    </label>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <h3 className={styles.settingGroupTitle}>SMS-уведомления</h3>
                                <div className={styles.settingRow}>
                                    <div className={styles.settingInfo}>
                                        <span className={styles.settingLabel}>Подтверждение</span>
                                        <span className={styles.settingDesc}>
                                            SMS при создании записи или брони
                                        </span>
                                    </div>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={toggles.smsConfirmation}
                                            onChange={() => toggle("smsConfirmation")}
                                        />
                                        <span className={styles.toggleTrack} />
                                    </label>
                                </div>
                                <div className={styles.settingRow}>
                                    <div className={styles.settingInfo}>
                                        <span className={styles.settingLabel}>Напоминание</span>
                                        <span className={styles.settingDesc}>
                                            SMS за 2 часа до визита
                                        </span>
                                    </div>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={toggles.smsReminder}
                                            onChange={() => toggle("smsReminder")}
                                        />
                                        <span className={styles.toggleTrack} />
                                    </label>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── Telegram ── */}
                    {section === 5 && (
                        <div className={styles.card}>
                            <h3 className={styles.settingGroupTitle}>Telegram-бот</h3>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>Бот активен</span>
                                    <span className={styles.settingDesc}>
                                        Включить или отключить Telegram-бота
                                    </span>
                                </div>
                                <label className={styles.toggleLabel}>
                                    <input
                                        type="checkbox"
                                        checked={toggles.telegramBot}
                                        onChange={() => toggle("telegramBot")}
                                    />
                                    <span className={styles.toggleTrack} />
                                </label>
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Брони через Telegram
                                    </span>
                                    <span className={styles.settingDesc}>
                                        Разрешить бронирование украшений через бота
                                    </span>
                                </div>
                                <label className={styles.toggleLabel}>
                                    <input
                                        type="checkbox"
                                        checked={toggles.telegramReservations}
                                        onChange={() => toggle("telegramReservations")}
                                    />
                                    <span className={styles.toggleTrack} />
                                </label>
                            </div>
                            <div className={styles.settingRow}>
                                <div className={styles.settingInfo}>
                                    <span className={styles.settingLabel}>
                                        Записи через Telegram
                                    </span>
                                    <span className={styles.settingDesc}>
                                        Разрешить запись на пирсинг через бота
                                    </span>
                                </div>
                                <label className={styles.toggleLabel}>
                                    <input
                                        type="checkbox"
                                        checked={toggles.telegramBookings}
                                        onChange={() => toggle("telegramBookings")}
                                    />
                                    <span className={styles.toggleTrack} />
                                </label>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>
                                        Приветственное сообщение бота
                                    </label>
                                    <textarea
                                        className={styles.formTextarea}
                                        defaultValue="Привет! Это PiercerKZN — студия пирсинга в Казани. Я помогу вам забронировать украшение или записаться на процедуру. Напишите /start, чтобы начать."
                                        style={{ minHeight: 100 }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── SEO ── */}
                    {section === 6 && (
                        <div className={styles.card}>
                            <h3 className={styles.settingGroupTitle}>SEO-настройки</h3>
                            <div className={styles.cardBody}>
                                <div className={styles.formSection}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            Шаблон заголовка страницы
                                        </label>
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            defaultValue="%s — PiercerKZN"
                                        />
                                        <span className={styles.formHint}>
                                            %s заменяется заголовком конкретной страницы
                                        </span>
                                    </div>
                                </div>
                                <div className={styles.formSection}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>
                                            Мета-описание по умолчанию
                                        </label>
                                        <textarea
                                            className={styles.formTextarea}
                                            defaultValue="Частная пирсинг-студия в Казани с 2016 года. 3D-примерка украшений онлайн, бронирование без оплаты. Один мастер, полная концентрация на вас."
                                        />
                                    </div>
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Google Analytics ID</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        placeholder="G-XXXXXXXXXX"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
