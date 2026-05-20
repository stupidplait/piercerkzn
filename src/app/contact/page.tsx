"use client";

/**
 * /contact — public contact form.
 *
 * Renders the studio inquiry form with a Cloudflare Turnstile captcha
 * widget. The widget reads `NEXT_PUBLIC_CAPTCHA_PROVIDER` and
 * `NEXT_PUBLIC_CAPTCHA_SITE_KEY` to decide whether to mount the live
 * widget or a hidden dev-bypass placeholder (length ≥ 20) so local
 * development does not require a real site key — the server-side
 * `CAPTCHA_DEV_BYPASS` flag still gates whether the placeholder is
 * accepted.
 *
 * Submission flow:
 *   1. Validate locally (empty / too-short fields are caught client-side
 *      so the user sees inline errors before a network round-trip).
 *   2. POST `/api/contact` with the form payload + the Turnstile token
 *      under `captchaToken`.
 *   3. On 422 with `fields.captchaToken` set, surface the localized
 *      rejection string verbatim (Requirement 9.5).
 *   4. On 422 with other field issues, surface the field-level messages
 *      from `error.details`.
 *   5. On 429, ask the user to retry shortly.
 *   6. On success, swap the form for a confirmation card carrying the
 *      reference number returned by the server.
 */
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type FormEvent } from "react";

import { TurnstileWidget } from "../../components/captcha/TurnstileWidget";
import styles from "./contact.module.css";

interface FieldErrors {
    name?: string;
    email?: string;
    phone?: string;
    subject?: string;
    message?: string;
    captchaToken?: string;
}

interface ContactSuccessResponse {
    inquiry: {
        id: string;
        referenceNumber: string;
        status: string;
        createdAt: string;
    };
    message: string;
}

interface ApiError {
    error?: { code?: string; message?: string; details?: unknown };
    /**
     * Captcha-rejection envelope shape from the route's 422 response
     * (Requirement 2.3): top-level `fields.captchaToken` carries the
     * localized rejection message that the client surfaces verbatim.
     */
    fields?: { captchaToken?: string };
    message?: string;
}

const FALLBACK_ERROR =
    "Не удалось отправить сообщение. Проверьте подключение и попробуйте ещё раз.";

export default function ContactPage(): React.ReactElement {
    const ids = {
        name: useId(),
        email: useId(),
        phone: useId(),
        subject: useId(),
        message: useId(),
    };

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [captchaToken, setCaptchaToken] = useState("");

    const [errors, setErrors] = useState<FieldErrors>({});
    const [topError, setTopError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState<ContactSuccessResponse | null>(null);

    // The captcha widget calls back with an empty string on error / expiry;
    // the submit button disables until a fresh token is available.
    const onTurnstileToken = useCallback((token: string) => {
        setCaptchaToken(token);
    }, []);

    const canSubmit = useMemo(() => {
        if (submitting) return false;
        if (!captchaToken || captchaToken.length < 20) return false;
        return true;
    }, [submitting, captchaToken]);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting) return;

        // Lightweight client-side checks. The server schema is the source
        // of truth — anything we miss here surfaces as an inline error
        // from `error.details`.
        const next: FieldErrors = {};
        if (!name.trim()) next.name = "Поле обязательно";
        if (!email.trim()) next.email = "Введите корректный email";
        if (message.trim().length < 10) next.message = "Сообщение слишком короткое";
        if (!captchaToken || captchaToken.length < 20) {
            next.captchaToken = "Подтвердите, что вы не робот, и попробуйте отправить снова.";
        }
        setErrors(next);
        if (Object.keys(next).length > 0) return;

        setTopError(null);
        setSubmitting(true);

        try {
            const payload = {
                name: name.trim(),
                email: email.trim(),
                phone: phone.trim() ? phone.trim() : undefined,
                subject: subject.trim() ? subject.trim() : undefined,
                message: message.trim(),
                captchaToken,
            };

            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.status === 201) {
                const data = (await res.json()) as ContactSuccessResponse;
                setSuccess(data);
                return;
            }

            const body = (await res.json().catch(() => null)) as ApiError | null;

            // Captcha-specific 422 envelope (Requirement 2.3 + 9.5):
            // surface the localized message from `fields.captchaToken`
            // verbatim and clear the token so the widget re-issues a
            // fresh challenge on the next attempt.
            if (res.status === 422 && body?.fields?.captchaToken) {
                setErrors({ captchaToken: body.fields.captchaToken });
                setTopError(body.message ?? null);
                setCaptchaToken("");
                return;
            }

            // Generic Zod validation envelope from `validationFailed`
            // (`error.details` is an array of `{ path, message }`).
            if (res.status === 422 && Array.isArray(body?.error?.details)) {
                const fieldErrors: FieldErrors = {};
                for (const issue of body!.error!.details as Array<{
                    path: string;
                    message: string;
                }>) {
                    (fieldErrors as Record<string, string>)[issue.path] = issue.message;
                }
                setErrors(fieldErrors);
                setTopError(body?.error?.message ?? null);
                return;
            }

            if (res.status === 429) {
                setTopError("Слишком много попыток. Подождите немного и попробуйте снова.");
                return;
            }

            setTopError(body?.error?.message ?? FALLBACK_ERROR);
        } catch {
            setTopError(FALLBACK_ERROR);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className={styles.shell}>
            <div className={styles.gridBackdrop} aria-hidden />
            <div className={styles.frame}>
                <Link href="/" className={styles.brand} aria-label="PiercerKZN — на главную">
                    <span className={styles.brandMark}>P/KZN</span>
                    <span className={styles.brandLine} />
                    <span className={styles.brandSub}>Студия пирсинга · Казань</span>
                </Link>

                <section className={styles.card}>
                    {success ? (
                        <SuccessView data={success} />
                    ) : (
                        <>
                            <h1 className={styles.heading}>Связаться со студией</h1>
                            <p className={styles.lead}>
                                Опишите вопрос — пирсер, запись или подбор украшений. Мы ответим в
                                течение рабочего дня.
                            </p>

                            {topError ? (
                                <div
                                    role="alert"
                                    className={`${styles.alert} ${styles.alertError}`}
                                >
                                    {topError}
                                </div>
                            ) : null}

                            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                                <div className={styles.field}>
                                    <label className={styles.label} htmlFor={ids.name}>
                                        Имя
                                    </label>
                                    <input
                                        id={ids.name}
                                        className={styles.input}
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Анна"
                                        autoComplete="name"
                                        aria-invalid={errors.name ? "true" : undefined}
                                        required
                                    />
                                    {errors.name ? (
                                        <span className={styles.fieldError}>{errors.name}</span>
                                    ) : null}
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
                                        Телефон{" "}
                                        <span style={{ opacity: 0.6 }}>(необязательно)</span>
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
                                    <label className={styles.label} htmlFor={ids.subject}>
                                        Тема <span style={{ opacity: 0.6 }}>(необязательно)</span>
                                    </label>
                                    <input
                                        id={ids.subject}
                                        className={styles.input}
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        placeholder="Запись · подбор украшений · вопрос"
                                        aria-invalid={errors.subject ? "true" : undefined}
                                    />
                                    {errors.subject ? (
                                        <span className={styles.fieldError}>{errors.subject}</span>
                                    ) : null}
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label} htmlFor={ids.message}>
                                        Сообщение
                                    </label>
                                    <textarea
                                        id={ids.message}
                                        className={styles.textarea}
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder="Подробности, желаемая дата, ссылки на референсы…"
                                        aria-invalid={errors.message ? "true" : undefined}
                                        minLength={10}
                                        maxLength={5000}
                                        required
                                    />
                                    {errors.message ? (
                                        <span className={styles.fieldError}>{errors.message}</span>
                                    ) : null}
                                </div>

                                <div className={styles.field}>
                                    <span className={styles.label}>Проверка</span>
                                    <div className={styles.captchaSlot}>
                                        <TurnstileWidget
                                            action="contact"
                                            onToken={onTurnstileToken}
                                        />
                                    </div>
                                    {errors.captchaToken ? (
                                        <span
                                            className={styles.fieldError}
                                            role="alert"
                                            data-testid="captcha-error"
                                        >
                                            {errors.captchaToken}
                                        </span>
                                    ) : null}
                                </div>

                                <button type="submit" className={styles.btn} disabled={!canSubmit}>
                                    {submitting ? "Отправляем…" : "Отправить"}
                                </button>
                            </form>
                        </>
                    )}
                </section>

                <footer className={styles.footnote}>
                    <span>© {new Date().getFullYear()} PiercerKZN</span>
                    <span aria-hidden>·</span>
                    <Link href="/" className={styles.footLink}>
                        На главную
                    </Link>
                </footer>
            </div>
        </main>
    );
}

function SuccessView({ data }: { data: ContactSuccessResponse }): React.ReactElement {
    return (
        <>
            <h1 className={styles.heading}>Сообщение отправлено</h1>
            <p className={styles.lead}>{data.message}</p>
            <div
                role="status"
                className={`${styles.alert} ${styles.alertSuccess}`}
                style={{ marginBottom: 12 }}
            >
                Номер обращения: <strong>{data.inquiry.referenceNumber}</strong>
            </div>
            <Link href="/" className={`${styles.btn}`}>
                Вернуться на главную
            </Link>
        </>
    );
}
