"use client";

/**
 * /auth/forgot-password — request a password reset link.
 *
 * Posts the email to `POST /api/auth/forgot-password`. The endpoint always
 * returns a generic 200 to avoid leaking which addresses are registered, so
 * we always show the same success copy on a 200 response.
 */
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import styles from "../auth.module.css";

export default function ForgotPasswordPage() {
    const emailId = useId();
    const [email, setEmail] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (pending) return;
        setError(null);
        setPending(true);

        try {
            const res = await fetch("/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim() }),
            });

            if (res.status === 429) {
                setError("Слишком много запросов. Попробуйте через минуту.");
            } else if (!res.ok && res.status >= 500) {
                setError("Сервер не отвечает. Попробуйте ещё раз.");
            } else {
                // 422 (bad email format) and 200 both surface as the generic
                // success state — we don't tell the user whether the email
                // exists. For 422 we still highlight the input.
                if (res.status === 422) {
                    setError("Проверьте правильность email.");
                } else {
                    setSubmitted(true);
                }
            }
        } catch {
            setError("Не удалось отправить запрос. Проверьте подключение.");
        }
        setPending(false);
    }

    if (submitted) {
        return (
            <>
                <h1 className={styles.heading}>Проверьте почту</h1>
                <p className={styles.lead}>
                    Если аккаунт с таким email существует, мы отправили на него инструкции по сбросу
                    пароля. Ссылка действует 30 минут.
                </p>
                <div
                    role="status"
                    className={`${styles.alert} ${styles.alertSuccess}`}
                    style={{ marginBottom: 18 }}
                >
                    Письмо отправлено: <strong>{email}</strong>
                </div>
                <Link
                    href="/auth/login"
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    style={{ display: "flex" }}
                >
                    Вернуться ко входу
                </Link>
                <div className={styles.footer}>
                    Не пришло письмо?{" "}
                    <button
                        type="button"
                        className={styles.rowLink}
                        onClick={() => setSubmitted(false)}
                        style={{ background: "none", padding: 0, cursor: "pointer" }}
                    >
                        Отправить ещё раз
                    </button>
                </div>
            </>
        );
    }

    return (
        <>
            <h1 className={styles.heading}>Сброс пароля</h1>
            <p className={styles.lead}>
                Укажите email, на который зарегистрирован аккаунт. Мы отправим ссылку для установки
                нового пароля.
            </p>

            {error ? (
                <div role="alert" className={`${styles.alert} ${styles.alertError}`}>
                    {error}
                </div>
            ) : null}

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={emailId}>
                        Email
                    </label>
                    <input
                        id={emailId}
                        type="email"
                        className={styles.input}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        autoFocus
                    />
                </div>

                <button type="submit" className={styles.btn} disabled={pending || !email}>
                    {pending ? "Отправляем…" : "Отправить ссылку"}
                </button>
            </form>

            <div className={styles.footer}>
                Вспомнили пароль? <Link href="/auth/login">Войти</Link>
            </div>
        </>
    );
}
