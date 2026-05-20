"use client";

/**
 * /auth/reset-password?token=… — set a new password using a single-use token.
 *
 * The token comes from the email sent by `/api/auth/forgot-password`. We
 * never expose the token to the user verbatim; the form submits it back to
 * `/api/auth/reset-password` along with the new password.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useMemo, useState, type FormEvent } from "react";

import styles from "../auth.module.css";

function scorePassword(pw: string): number {
    if (!pw) return 0;
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(s, 4);
}

const STRENGTH_LABEL = ["Слабый", "Слабый", "Средний", "Хороший", "Сильный"] as const;

export default function ResetPasswordPage() {
    return (
        <Suspense
            fallback={
                <>
                    <h1 className={styles.heading}>Новый пароль</h1>
                    <p className={styles.lead}>Загружаем форму…</p>
                </>
            }
        >
            <ResetForm />
        </Suspense>
    );
}

function ResetForm() {
    const router = useRouter();
    const params = useSearchParams();
    const token = params.get("token") ?? "";

    const passwordId = useId();
    const confirmId = useId();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [pending, setPending] = useState(false);

    const score = useMemo(() => scorePassword(password), [password]);

    if (!token) {
        return (
            <>
                <h1 className={styles.heading}>Ссылка повреждена</h1>
                <p className={styles.lead}>
                    Эта страница открывается по ссылке из письма. Запросите сброс пароля ещё раз —
                    мы пришлём свежую ссылку.
                </p>
                <Link href="/auth/forgot-password" className={styles.btn}>
                    Запросить новую ссылку
                </Link>
            </>
        );
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (pending) return;

        if (password.length < 8) {
            setError("Пароль не короче 8 символов");
            return;
        }
        if (password !== confirmPassword) {
            setError("Пароли не совпадают");
            return;
        }

        setError(null);
        setPending(true);

        try {
            const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password, confirmPassword }),
            });
            const body = (await res.json().catch(() => null)) as {
                message?: string;
                error?: { code: string; message: string };
            } | null;

            if (res.ok) {
                setDone(true);
                setTimeout(() => router.push("/auth/login"), 1800);
            } else if (res.status === 429) {
                setError("Слишком много попыток. Попробуйте через минуту.");
            } else {
                setError(body?.error?.message ?? "Не удалось обновить пароль.");
            }
        } catch {
            setError("Сервер недоступен. Попробуйте ещё раз.");
        }
        setPending(false);
    }

    if (done) {
        return (
            <>
                <h1 className={styles.heading}>Пароль обновлён</h1>
                <div
                    role="status"
                    className={`${styles.alert} ${styles.alertSuccess}`}
                    style={{ marginBottom: 18 }}
                >
                    Готово. Сейчас перенаправим вас на страницу входа…
                </div>
                <Link href="/auth/login" className={styles.btn}>
                    Перейти к входу
                </Link>
            </>
        );
    }

    return (
        <>
            <h1 className={styles.heading}>Новый пароль</h1>
            <p className={styles.lead}>
                Задайте новый пароль для вашего аккаунта. После сохранения мы попросим войти заново.
            </p>

            {error ? (
                <div role="alert" className={`${styles.alert} ${styles.alertError}`}>
                    {error}
                </div>
            ) : null}

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={passwordId}>
                        Новый пароль
                    </label>
                    <input
                        id={passwordId}
                        type="password"
                        className={styles.input}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Не короче 8 символов"
                        autoComplete="new-password"
                        minLength={8}
                        required
                        autoFocus
                    />
                    {password ? (
                        <div className={styles.strength} aria-hidden>
                            <div className={styles.strengthBar}>
                                {[0, 1, 2, 3].map((i) => {
                                    const on = i < score;
                                    const lvl = Math.max(0, Math.min(3, score - 1));
                                    const cls = on
                                        ? styles[`strengthBarSegOn${lvl}` as keyof typeof styles]
                                        : "";
                                    return (
                                        <span
                                            key={i}
                                            className={`${styles.strengthBarSeg} ${cls}`}
                                        />
                                    );
                                })}
                            </div>
                            <span className={styles.strengthLabel}>{STRENGTH_LABEL[score]}</span>
                        </div>
                    ) : null}
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor={confirmId}>
                        Повторите пароль
                    </label>
                    <input
                        id={confirmId}
                        type="password"
                        className={styles.input}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        required
                    />
                </div>

                <button type="submit" className={styles.btn} disabled={pending}>
                    {pending ? "Сохраняем…" : "Сохранить пароль"}
                </button>
            </form>

            <div className={styles.footer}>
                <Link href="/auth/login">Вернуться ко входу</Link>
            </div>
        </>
    );
}
