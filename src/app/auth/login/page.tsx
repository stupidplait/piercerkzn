"use client";

/**
 * /auth/login — customer login.
 *
 * Posts to Auth.js's `signIn('credentials', ...)` endpoint via fetch (no
 * `next-auth/react` SessionProvider needed in this RSC tree). Social
 * providers (VK, Telegram via magic-link) are exposed as separate buttons.
 *
 * Errors are surfaced inline; success redirects to `callbackUrl` (or
 * `/account` by default).
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState, type FormEvent } from "react";

import styles from "../auth.module.css";

const errorMessages: Record<string, string> = {
    CredentialsSignin: "Неверный email или пароль",
    OAuthSignin: "Не удалось начать вход через провайдера. Попробуйте ещё раз.",
    OAuthCallback: "Провайдер вернул ошибку. Попробуйте ещё раз.",
    AccessDenied: "Доступ запрещён",
    Verification: "Ссылка для входа недействительна или устарела",
    Default: "Не удалось войти. Попробуйте ещё раз.",
};

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginFallback />}>
            <LoginForm />
        </Suspense>
    );
}

function LoginFallback() {
    return (
        <>
            <h1 className={styles.heading}>Вход</h1>
            <p className={styles.lead}>Загружаем форму…</p>
        </>
    );
}

function LoginForm() {
    const router = useRouter();
    const params = useSearchParams();
    const callbackUrl = params.get("callbackUrl") ?? "/account";
    const initialErrorKey = params.get("error");

    const emailId = useId();
    const passwordId = useId();
    const rememberId = useId();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(
        initialErrorKey ? (errorMessages[initialErrorKey] ?? errorMessages.Default) : null
    );
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError(null);

        try {
            const csrfRes = await fetch("/api/auth/csrf", { credentials: "include" });
            const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

            const body = new URLSearchParams({
                email,
                password,
                csrfToken,
                callbackUrl,
                redirect: "false",
                json: "true",
            });

            const res = await fetch("/api/auth/callback/credentials", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                credentials: "include",
                body: body.toString(),
            });

            // Auth.js v5 returns JSON `{ url }` on success when `json=true`,
            // otherwise sets the session cookie + 200. A failure typically
            // sends the user to the signin page — we detect that.
            if (!res.ok) {
                setError(errorMessages.CredentialsSignin);
                setSubmitting(false);
                return;
            }
            const data = (await res.json().catch(() => null)) as { url?: string } | null;
            if (data?.url && data.url.includes("error=")) {
                const u = new URL(data.url, window.location.origin);
                const errKey = u.searchParams.get("error") ?? "Default";
                setError(errorMessages[errKey] ?? errorMessages.Default);
                setSubmitting(false);
                return;
            }

            router.push(data?.url ?? callbackUrl);
            router.refresh();
        } catch {
            setError(errorMessages.Default);
            setSubmitting(false);
        }
    }

    function handleVk() {
        const url = `/api/auth/signin/vk?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        window.location.href = url;
    }

    return (
        <>
            <h1 className={styles.heading}>Вход</h1>
            <p className={styles.lead}>
                Войдите, чтобы видеть свои брони, записи и сохранённые подборки.
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

                <div className={styles.field}>
                    <label className={styles.label} htmlFor={passwordId}>
                        Пароль
                    </label>
                    <input
                        id={passwordId}
                        type="password"
                        className={styles.input}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                        minLength={1}
                    />
                </div>

                <div className={styles.row}>
                    <label className={styles.checkbox} htmlFor={rememberId}>
                        <input id={rememberId} type="checkbox" name="remember" defaultChecked />
                        Запомнить меня
                    </label>
                    <Link href="/auth/forgot-password" className={styles.rowLink}>
                        Забыли пароль?
                    </Link>
                </div>

                <button type="submit" className={styles.btn} disabled={submitting}>
                    {submitting ? "Входим…" : "Войти"}
                </button>
            </form>

            <div className={styles.divider}>или</div>

            <div className={styles.socials}>
                <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={handleVk}
                >
                    Войти через VK
                </button>
                <Link
                    href={`/auth/forgot-password?mode=magic&callbackUrl=${encodeURIComponent(callbackUrl)}`}
                    className={`${styles.btn} ${styles.btnSecondary}`}
                >
                    Войти по ссылке на email
                </Link>
            </div>

            <div className={styles.footer}>
                Нет аккаунта?{" "}
                <Link
                    href={`/auth/register${
                        callbackUrl !== "/account"
                            ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                            : ""
                    }`}
                >
                    Зарегистрироваться
                </Link>
            </div>
        </>
    );
}
