"use client";

import { useState, useTransition } from "react";
import { updateProfileAction } from "./update-profile-action";
import styles from "../settings.module.css";

interface SettingsFormProps {
    initialData: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        notificationEmail: boolean;
        notificationPush: boolean;
    };
}

export function SettingsForm({ initialData }: SettingsFormProps) {
    const [isPending, startTransition] = useTransition();
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
        null
    );

    const [firstName, setFirstName] = useState(initialData.firstName);
    const [lastName, setLastName] = useState(initialData.lastName);
    const [email, setEmail] = useState(initialData.email);
    const [phone, setPhone] = useState(initialData.phone);
    const [notificationEmail, setNotificationEmail] = useState(initialData.notificationEmail);
    const [notificationPush, setNotificationPush] = useState(initialData.notificationPush);

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!firstName.trim() || firstName.length < 1 || firstName.length > 50) {
            newErrors.firstName = "Имя должно быть от 1 до 50 символов";
        }

        if (lastName && lastName.length > 50) {
            newErrors.lastName = "Фамилия не более 50 символов";
        }

        if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            newErrors.email = "Введите корректный email";
        }

        // Russian phone format: +7XXXXXXXXXX or 8XXXXXXXXXX
        if (phone && !/^(\+7|8)\d{10}$/.test(phone.replace(/[\s\-()]/g, ""))) {
            newErrors.phone = "Введите телефон в формате +7XXXXXXXXXX";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        setMessage(null);
        startTransition(async () => {
            const result = await updateProfileAction({
                firstName: firstName.trim(),
                lastName: lastName.trim() || null,
                email: email.trim(),
                phone: phone.replace(/[\s\-()]/g, "") || null,
                notificationEmail,
                notificationPush,
            });

            if (result.ok) {
                setMessage({ type: "success", text: "Настройки сохранены" });
            } else {
                setMessage({ type: "error", text: result.error ?? "Ошибка сохранения" });
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className={styles.form}>
            {/* Profile section */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Профиль</h2>

                <div className={styles.fieldGroup}>
                    <div className={styles.field}>
                        <label htmlFor="firstName" className={styles.label}>
                            Имя *
                        </label>
                        <input
                            id="firstName"
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            maxLength={50}
                            className={styles.input}
                            aria-invalid={!!errors.firstName}
                        />
                        {errors.firstName && (
                            <span className={styles.fieldError}>{errors.firstName}</span>
                        )}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="lastName" className={styles.label}>
                            Фамилия
                        </label>
                        <input
                            id="lastName"
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            maxLength={50}
                            className={styles.input}
                            aria-invalid={!!errors.lastName}
                        />
                        {errors.lastName && (
                            <span className={styles.fieldError}>{errors.lastName}</span>
                        )}
                    </div>
                </div>

                <div className={styles.field}>
                    <label htmlFor="email" className={styles.label}>
                        Email *
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={styles.input}
                        aria-invalid={!!errors.email}
                    />
                    {errors.email && <span className={styles.fieldError}>{errors.email}</span>}
                </div>

                <div className={styles.field}>
                    <label htmlFor="phone" className={styles.label}>
                        Телефон
                    </label>
                    <input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+7XXXXXXXXXX"
                        className={styles.input}
                        aria-invalid={!!errors.phone}
                    />
                    {errors.phone && <span className={styles.fieldError}>{errors.phone}</span>}
                </div>
            </section>

            {/* Notification preferences */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Уведомления</h2>

                <div className={styles.toggleGroup}>
                    <label className={styles.toggle}>
                        <input
                            type="checkbox"
                            checked={notificationEmail}
                            onChange={(e) => setNotificationEmail(e.target.checked)}
                            className={styles.toggleInput}
                        />
                        <span className={styles.toggleSwitch} />
                        <span className={styles.toggleLabel}>Email-уведомления</span>
                    </label>

                    <label className={styles.toggle}>
                        <input
                            type="checkbox"
                            checked={notificationPush}
                            onChange={(e) => setNotificationPush(e.target.checked)}
                            className={styles.toggleInput}
                        />
                        <span className={styles.toggleSwitch} />
                        <span className={styles.toggleLabel}>Push-уведомления</span>
                    </label>
                </div>
            </section>

            {/* Submit */}
            <div className={styles.actions}>
                <button type="submit" disabled={isPending} className={styles.submitButton}>
                    {isPending ? "Сохранение..." : "Сохранить"}
                </button>
                {message && (
                    <span className={styles.message} data-type={message.type}>
                        {message.text}
                    </span>
                )}
            </div>
        </form>
    );
}
