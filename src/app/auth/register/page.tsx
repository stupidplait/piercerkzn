"use client";

/**
 * /auth/register — customer signup.
 *
 * Calls the `registerAction` server action which creates the customer +
 * starts a session in one step. Field-level errors come back via the
 * action's `details` payload.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useMemo, useState, useTransition, type FormEvent } from "react";

import { registerAction } from "@/actions/auth";
import { usePostHogClient } from "@/components/posthog-provider";

import styles from "../auth.module.css";

interface FieldErrors {
    email?: string;
    password?: string;
    confirmPassword?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    terms?: string;
}

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

export default function RegisterPage() {
    return (
        <Suspense
            fallback={
                <>
                    <h1 className={styles.heading}>Регистрация</h1>
                    <p className={styles.lead}>Загружаем форму…</p>
                </>
            }
        >
            <RegisterForm />
        </Suspense>
    );
}

function RegisterForm() {
    const router = useRouter();
    const params = useSearchParams();
    const callbackUrl = params.get("callbackUrl") ?? "/account";
    const posthog = usePostHogClient();

    const ids = {
        firstName: useId(),
        lastName: useId(),
        email: useId(),
        phone: useId(),
        password: useId(),
        confirm: useId(),
        terms: useId(),
    };

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [terms, setTerms] = useState(false);
    const [errors, setErrors] = useState<FieldErrors>({});
    const [topError, setTopError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const score = useMemo(() => scorePassword(password), [password]);

    function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (pending) return;

        const next: FieldErrors = {};
        if (!terms) next.terms = "Подтвердите согласие, чтобы продолжить";
        setErrors(next);
        if (Object.keys(next).length > 0) return;

        setTopError(null);

        startTransition(async () => {
            const payload = {
                firstName: firstName.trim(),
                lastName: lastName.trim() || undefined,
                email: email.trim(),
                phone: phone.trim() || undefined,
                password,
                confirmPassword,
            };

            const result = await registerAction(payload);
            if (result.ok) {
                // Tie the anonymous PostHog identity to the new customer id so
                // pre-signup events stay attributed to the same person.
                try {
                    posthog.alias(result.data.customerId);
                    posthog.identify(result.data.customerId);
                } catch {
                    /* analytics is best-effort */
                }
                router.push(callbackUrl);
                router.refresh();
                return;
            }

            if (result.error.code === "validation_error" && Array.isArray(result.error.details)) {
                const fieldErrors: FieldErrors = {};
                for (const issue of result.error.details as { path: string; message: string }[]) {
                    (fieldErrors as Record<string, string>)[issue.path] = issue.message;
                }
                setErrors(fieldErrors);
                setTopError(result.error.message);
            } else {
                setTopError(result.error.message);
            }
        });
    }

    return (
        <>
            <h1 className={styles.heading}>Регистрация</h1>
            <p className={styles.lead}>
                Создайте аккаунт, чтобы бронировать украшения и записываться на пирсинг.
            </p>

            {topError ? (
                <div role="alert" className={`${styles.alert} ${styles.alertError}`}>
                    {topError}
                </div>
            ) : null}

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                    }}
                >
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={ids.firstName}>
                            Имя
                        </label>
                        <input
                            id={ids.firstName}
                            className={styles.input}
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="Анна"
                            autoComplete="given-name"
                            aria-invalid={errors.firstName ? "true" : undefined}
                            required
                        />
                        {errors.firstName ? (
                            <span className={styles.fieldError}>{errors.firstName}</span>
                        ) : null}
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={ids.lastName}>
                            Фамилия
                        </label>
                        <input
                            id={ids.lastName}
                            className={styles.input}
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="—"
                            autoComplete="family-name"
                            aria-invalid={errors.lastName ? "true" : undefined}
                        />
                        {errors.lastName ? (
                            <span className={styles.fieldError}>{errors.lastName}</span>
                        ) : null}
                    </div>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor={ids.email}>
                        Email
                    </label>
                    <input
                        id={ids.email}
                        type="email"
                        className={styles.input}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        aria-invalid={errors.email ? "true" : undefined}
                        required
                    />
                    {errors.email ? (
                        <span className={styles.fieldError}>{errors.email}</span>
                    ) : null}
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor={ids.phone}>
                        Телефон <span style={{ opacity: 0.6 }}>(необязательно)</span>
                    </label>
                    <input
                        id={ids.phone}
                        type="tel"
                        className={styles.input}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+7 999 000-00-00"
                        autoComplete="tel"
                        aria-invalid={errors.phone ? "true" : undefined}
                    />
                    {errors.phone ? (
                        <span className={styles.fieldError}>{errors.phone}</span>
                    ) : null}
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor={ids.password}>
                        Пароль
                    </label>
                    <input
                        id={ids.password}
                        type="password"
                        className={styles.input}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Не короче 8 символов"
                        autoComplete="new-password"
                        aria-invalid={errors.password ? "true" : undefined}
                        minLength={8}
                        required
                    />
                    {password ? (
                        <div className={styles.strength} aria-hidden>
                            <div className={styles.strengthBar}>
                                {[0, 1, 2, 3].map((i) => {
                                    const on = i < score;
                                    const lvl = Math.max(0, Math.min(3, score - 1));
                                    const onClass =
                                        i === lvl
                                            ? styles[
                                                  `strengthBarSegOn${lvl}` as keyof typeof styles
                                              ]
                                            : on
                                              ? styles[
                                                    `strengthBarSegOn${lvl}` as keyof typeof styles
                                                ]
                                              : "";
                                    return (
                                        <span
                                            key={i}
                                            className={`${styles.strengthBarSeg} ${
                                                on ? onClass : ""
                                            }`}
                                        />
                                    );
                                })}
                            </div>
                            <span className={styles.strengthLabel}>{STRENGTH_LABEL[score]}</span>
                        </div>
                    ) : null}
                    {errors.password ? (
                        <span className={styles.fieldError}>{errors.password}</span>
                    ) : null}
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor={ids.confirm}>
                        Повторите пароль
                    </label>
                    <input
                        id={ids.confirm}
                        type="password"
                        className={styles.input}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        aria-invalid={errors.confirmPassword ? "true" : undefined}
                        required
                    />
                    {errors.confirmPassword ? (
                        <span className={styles.fieldError}>{errors.confirmPassword}</span>
                    ) : null}
                </div>

                <label
                    className={styles.checkbox}
                    htmlFor={ids.terms}
                    style={{ alignItems: "flex-start", lineHeight: 1.5 }}
                >
                    <input
                        id={ids.terms}
                        type="checkbox"
                        checked={terms}
                        onChange={(e) => setTerms(e.target.checked)}
                        aria-invalid={errors.terms ? "true" : undefined}
                        style={{ marginTop: 3 }}
                    />
                    <span>
                        Согласен(а) с{" "}
                        <Link href="/legal/terms" className={styles.rowLink}>
                            условиями
                        </Link>{" "}
                        и{" "}
                        <Link href="/legal/privacy" className={styles.rowLink}>
                            политикой конфиденциальности
                        </Link>
                    </span>
                </label>
                {errors.terms ? <span className={styles.fieldError}>{errors.terms}</span> : null}

                <button type="submit" className={styles.btn} disabled={pending}>
                    {pending ? "Создаём аккаунт…" : "Зарегистрироваться"}
                </button>
            </form>

            <div className={styles.footer}>
                Уже есть аккаунт?{" "}
                <Link
                    href={`/auth/login${
                        callbackUrl !== "/account"
                            ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                            : ""
                    }`}
                >
                    Войти
                </Link>
            </div>
        </>
    );
}
