"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createAppointmentAction } from "@/actions/booking";

import type { ServicesByCategory, WaiverData } from "./page";
import styles from "./booking.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SERVICES = 5;

const CATEGORY_LABELS: Record<string, string> = {
    new_piercing: "Новый прокол",
    jewelry_change: "Замена украшения",
    consultation: "Консультация",
    checkup: "Осмотр",
    downsize: "Даунсайз",
};

const STEP_LABELS = ["Услуги", "Дата и время", "Контакты", "Подтверждение"];

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

interface ContactData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    notes: string;
}

interface WizardState {
    step: number; // 0-3
    selectedServices: string[];
    selectedDate: string | null;
    selectedTime: string | null;
    contact: ContactData;
    signatureData: string | null;
    submitting: boolean;
    error: string | null;
    confirmation: {
        referenceNumber: string;
        date: string;
        timeStart: string;
        timeEnd: string;
        services: string[];
    } | null;
}

type WizardAction =
    | { type: "SET_STEP"; step: number }
    | { type: "TOGGLE_SERVICE"; serviceId: string }
    | { type: "SET_DATE"; date: string }
    | { type: "SET_TIME"; time: string }
    | { type: "SET_CONTACT"; contact: ContactData }
    | { type: "SET_SIGNATURE"; data: string | null }
    | { type: "SET_SUBMITTING"; submitting: boolean }
    | { type: "SET_ERROR"; error: string | null }
    | { type: "SLOT_CONFLICT" }
    | { type: "SET_CONFIRMATION"; confirmation: WizardState["confirmation"] };

const initialState: WizardState = {
    step: 0,
    selectedServices: [],
    selectedDate: null,
    selectedTime: null,
    contact: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        notes: "",
    },
    signatureData: null,
    submitting: false,
    error: null,
    confirmation: null,
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
    switch (action.type) {
        case "SET_STEP":
            return { ...state, step: action.step, error: null };
        case "TOGGLE_SERVICE": {
            const exists = state.selectedServices.includes(action.serviceId);
            if (exists) {
                return {
                    ...state,
                    selectedServices: state.selectedServices.filter(
                        (id) => id !== action.serviceId
                    ),
                };
            }
            if (state.selectedServices.length >= MAX_SERVICES) return state;
            return {
                ...state,
                selectedServices: [...state.selectedServices, action.serviceId],
            };
        }
        case "SET_DATE":
            return { ...state, selectedDate: action.date, selectedTime: null };
        case "SET_TIME":
            return { ...state, selectedTime: action.time };
        case "SET_CONTACT":
            return { ...state, contact: action.contact };
        case "SET_SIGNATURE":
            return { ...state, signatureData: action.data };
        case "SET_SUBMITTING":
            return { ...state, submitting: action.submitting };
        case "SET_ERROR":
            return { ...state, error: action.error };
        case "SLOT_CONFLICT":
            return {
                ...state,
                step: 1,
                selectedDate: null,
                selectedTime: null,
                error: "Выбранное время больше недоступно. Пожалуйста, выберите другое.",
            };
        case "SET_CONFIRMATION":
            return { ...state, confirmation: action.confirmation, step: 4 };
        default:
            return state;
    }
}

// ---------------------------------------------------------------------------
// Contact form schema
// ---------------------------------------------------------------------------

const contactSchema = z.object({
    firstName: z.string().trim().min(1, "Обязательное поле").max(100, "Максимум 100 символов"),
    lastName: z.string().trim().max(100, "Максимум 100 символов").optional().or(z.literal("")),
    email: z
        .string()
        .trim()
        .min(1, "Обязательное поле")
        .email("Введите корректный email")
        .max(255, "Максимум 255 символов"),
    phone: z
        .string()
        .trim()
        .min(1, "Обязательное поле")
        .regex(/^(\+7|8)\d{10}$/u, "Формат: +7XXXXXXXXXX")
        .max(20, "Максимум 20 символов"),
    dateOfBirth: z.string().optional().or(z.literal("")),
    notes: z.string().trim().max(2000, "Максимум 2000 символов").optional().or(z.literal("")),
});

type ContactFormValues = z.infer<typeof contactSchema>;

// ---------------------------------------------------------------------------
// BookingWizard component
// ---------------------------------------------------------------------------

interface BookingWizardProps {
    servicesByCategory: ServicesByCategory;
    waiver: WaiverData;
}

export function BookingWizard({ servicesByCategory, waiver }: BookingWizardProps) {
    const [state, dispatch] = useReducer(wizardReducer, initialState);

    const canGoToStep2 = state.selectedServices.length > 0;
    const canGoToStep3 = state.selectedDate !== null && state.selectedTime !== null;

    // If we have a confirmation, show it
    if (state.confirmation) {
        return (
            <div className={styles.stepContainer}>
                <div className={styles.confirmation}>
                    <div className={styles.confirmationIcon}>✓</div>
                    <h2 className={styles.confirmationTitle}>Запись подтверждена</h2>
                    <p className={styles.confirmationRef}>{state.confirmation.referenceNumber}</p>
                    <div className={styles.confirmationDetails}>
                        <p>Дата: {formatDateRu(state.confirmation.date)}</p>
                        <p>
                            Время: {state.confirmation.timeStart} – {state.confirmation.timeEnd}
                        </p>
                        <p>Услуги: {state.confirmation.services.join(", ")}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Progress indicator */}
            <div
                className={styles.progressBar}
                role="progressbar"
                aria-valuenow={state.step + 1}
                aria-valuemin={1}
                aria-valuemax={4}
            >
                {STEP_LABELS.map((label, i) => (
                    <div
                        key={label}
                        className={styles.progressStep}
                        data-active={i <= state.step ? "true" : undefined}
                    >
                        <span
                            className={styles.progressDot}
                            data-active={i === state.step ? "true" : undefined}
                            data-completed={i < state.step ? "true" : undefined}
                        >
                            {i < state.step ? "✓" : i + 1}
                        </span>
                        <span
                            className={styles.progressLabel}
                            data-active={i === state.step ? "true" : undefined}
                        >
                            {label}
                        </span>
                    </div>
                ))}
            </div>

            {/* Error message */}
            {state.error && (
                <div className={styles.errorMessage} role="alert">
                    {state.error}
                </div>
            )}

            {/* Steps */}
            {state.step === 0 && (
                <ServiceSelection
                    servicesByCategory={servicesByCategory}
                    selectedServices={state.selectedServices}
                    onToggle={(id) => dispatch({ type: "TOGGLE_SERVICE", serviceId: id })}
                    onNext={() => dispatch({ type: "SET_STEP", step: 1 })}
                    canNext={canGoToStep2}
                />
            )}

            {state.step === 1 && (
                <DateTimePicker
                    selectedServices={state.selectedServices}
                    selectedDate={state.selectedDate}
                    selectedTime={state.selectedTime}
                    onSelectDate={(d) => dispatch({ type: "SET_DATE", date: d })}
                    onSelectTime={(t) => dispatch({ type: "SET_TIME", time: t })}
                    onNext={() => dispatch({ type: "SET_STEP", step: 2 })}
                    onBack={() => dispatch({ type: "SET_STEP", step: 0 })}
                    canNext={canGoToStep3}
                />
            )}

            {state.step === 2 && (
                <ContactForm
                    initialValues={state.contact}
                    onSubmit={(data) => {
                        dispatch({ type: "SET_CONTACT", contact: data });
                        dispatch({ type: "SET_STEP", step: 3 });
                    }}
                    onBack={() => dispatch({ type: "SET_STEP", step: 1 })}
                />
            )}

            {state.step === 3 && (
                <WaiverConfirm
                    waiver={waiver}
                    signatureData={state.signatureData}
                    onSign={(data) => dispatch({ type: "SET_SIGNATURE", data })}
                    onClearSignature={() => dispatch({ type: "SET_SIGNATURE", data: null })}
                    submitting={state.submitting}
                    onSubmit={async () => {
                        dispatch({ type: "SET_SUBMITTING", submitting: true });
                        dispatch({ type: "SET_ERROR", error: null });

                        const result = await createAppointmentAction({
                            serviceIds: state.selectedServices,
                            date: state.selectedDate,
                            time: state.selectedTime,
                            customer: {
                                firstName: state.contact.firstName,
                                lastName: state.contact.lastName || undefined,
                                email: state.contact.email,
                                phone: state.contact.phone,
                                dateOfBirth: state.contact.dateOfBirth || undefined,
                            },
                            notes: state.contact.notes || undefined,
                            waiverSigned: true,
                            waiverSignatureData: state.signatureData!,
                        });

                        dispatch({ type: "SET_SUBMITTING", submitting: false });

                        if (result.ok) {
                            dispatch({
                                type: "SET_CONFIRMATION",
                                confirmation: {
                                    referenceNumber: result.data.referenceNumber,
                                    date: result.data.date,
                                    timeStart: result.data.timeStart,
                                    timeEnd: result.data.timeEnd,
                                    services: result.data.services,
                                },
                            });
                        } else {
                            const code = result.error.code;
                            if (code === "slot_unavailable" || code === "slot_conflict") {
                                dispatch({ type: "SLOT_CONFLICT" });
                            } else {
                                dispatch({
                                    type: "SET_ERROR",
                                    error: result.error.message,
                                });
                            }
                        }
                    }}
                    onBack={() => dispatch({ type: "SET_STEP", step: 2 })}
                />
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Step 1: Service Selection
// ---------------------------------------------------------------------------

interface ServiceSelectionProps {
    servicesByCategory: ServicesByCategory;
    selectedServices: string[];
    onToggle: (serviceId: string) => void;
    onNext: () => void;
    canNext: boolean;
}

function ServiceSelection({
    servicesByCategory,
    selectedServices,
    onToggle,
    onNext,
    canNext,
}: ServiceSelectionProps) {
    const categories = Object.keys(servicesByCategory);

    return (
        <div className={styles.stepContainer}>
            <h2 className={styles.stepTitle}>Выберите услуги</h2>
            <p className={styles.selectionCount}>
                Выбрано: {selectedServices.length} / {MAX_SERVICES}
            </p>

            {categories.map((category) => (
                <div key={category} className={styles.categoryGroup}>
                    <h3 className={styles.categoryTitle}>
                        {CATEGORY_LABELS[category] ?? category}
                    </h3>
                    <div className={styles.serviceGrid}>
                        {servicesByCategory[category].map((service) => {
                            const isSelected = selectedServices.includes(service.id);
                            const isDisabled =
                                !isSelected && selectedServices.length >= MAX_SERVICES;

                            return (
                                <button
                                    key={service.id}
                                    type="button"
                                    className={styles.serviceCard}
                                    data-selected={isSelected ? "true" : undefined}
                                    disabled={isDisabled}
                                    onClick={() => onToggle(service.id)}
                                    aria-pressed={isSelected}
                                >
                                    <p className={styles.serviceName}>{service.name}</p>
                                    {service.description && (
                                        <p className={styles.serviceDescription}>
                                            {service.description}
                                        </p>
                                    )}
                                    <div className={styles.serviceMeta}>
                                        <span className={styles.servicePrice}>
                                            {formatPrice(service.priceFrom)}
                                            {service.priceTo
                                                ? ` – ${formatPrice(service.priceTo)}`
                                                : ""}
                                        </span>
                                        <span className={styles.serviceDuration}>
                                            {service.durationMinutes} мин
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            <div className={styles.stepNav}>
                <div />
                <button
                    type="button"
                    className={styles.nextBtn}
                    disabled={!canNext}
                    onClick={onNext}
                >
                    Далее
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 2: Date & Time Picker
// ---------------------------------------------------------------------------

interface AvailabilityDay {
    date: string;
    isWorkingDay: boolean;
    slots: string[];
}

interface AvailabilityResponse {
    days: AvailabilityDay[];
}

interface DateTimePickerProps {
    selectedServices: string[];
    selectedDate: string | null;
    selectedTime: string | null;
    onSelectDate: (date: string) => void;
    onSelectTime: (time: string) => void;
    onNext: () => void;
    onBack: () => void;
    canNext: boolean;
}

function DateTimePicker({
    selectedServices,
    selectedDate,
    selectedTime,
    onSelectDate,
    onSelectTime,
    onNext,
    onBack,
    canNext,
}: DateTimePickerProps) {
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    });
    const [slots, setSlots] = useState<string[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [slotsError, setSlotsError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const fetchSlots = useCallback(
        (date: string) => {
            // Abort previous request
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            setLoadingSlots(true);
            setSlotsError(null);
            setSlots([]);

            const params = new URLSearchParams({
                startDate: date,
                endDate: date,
            });
            if (selectedServices.length > 0) {
                params.set("serviceIds", selectedServices.join(","));
            }

            fetch(`/api/booking/availability?${params.toString()}`, {
                signal: controller.signal,
            })
                .then((res) => {
                    if (!res.ok) throw new Error("Ошибка загрузки");
                    return res.json() as Promise<AvailabilityResponse>;
                })
                .then((data) => {
                    const day = data.days.find((d) => d.date === date);
                    setSlots(day?.slots ?? []);
                    setLoadingSlots(false);
                })
                .catch((err) => {
                    if (err instanceof DOMException && err.name === "AbortError") return;
                    setSlotsError(err instanceof Error ? err.message : "Ошибка загрузки");
                    setSlots([]);
                    setLoadingSlots(false);
                });
        },
        [selectedServices]
    );

    const handleSelectDate = useCallback(
        (date: string) => {
            onSelectDate(date);
            fetchSlots(date);
        },
        [onSelectDate, fetchSlots]
    );

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // Calendar generation
    const daysInMonth = new Date(currentMonth.year, currentMonth.month + 1, 0).getDate();
    const firstDayOfWeek = (new Date(currentMonth.year, currentMonth.month, 1).getDay() + 6) % 7; // Mon=0
    const today = new Date().toISOString().slice(0, 10);

    const monthLabel = new Date(currentMonth.year, currentMonth.month).toLocaleDateString("ru-RU", {
        month: "long",
        year: "numeric",
    });

    const prevMonth = () => {
        setCurrentMonth((prev) => {
            if (prev.month === 0) return { year: prev.year - 1, month: 11 };
            return { year: prev.year, month: prev.month - 1 };
        });
    };

    const nextMonth = () => {
        setCurrentMonth((prev) => {
            if (prev.month === 11) return { year: prev.year + 1, month: 0 };
            return { year: prev.year, month: prev.month + 1 };
        });
    };

    const isPrevDisabled = (() => {
        const now = new Date();
        return (
            currentMonth.year < now.getFullYear() ||
            (currentMonth.year === now.getFullYear() && currentMonth.month <= now.getMonth())
        );
    })();

    const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

    return (
        <div className={styles.stepContainer}>
            <h2 className={styles.stepTitle}>Выберите дату и время</h2>

            <div className={styles.dateTimeContainer}>
                {/* Calendar */}
                <div>
                    <div className={styles.calendarHeader}>
                        <button
                            type="button"
                            className={styles.calendarNavBtn}
                            onClick={prevMonth}
                            disabled={isPrevDisabled}
                            aria-label="Предыдущий месяц"
                        >
                            ←
                        </button>
                        <span className={styles.calendarMonth}>{monthLabel}</span>
                        <button
                            type="button"
                            className={styles.calendarNavBtn}
                            onClick={nextMonth}
                            aria-label="Следующий месяц"
                        >
                            →
                        </button>
                    </div>

                    <div className={styles.calendarGrid}>
                        {DAY_LABELS.map((d) => (
                            <span key={d} className={styles.calendarDayLabel}>
                                {d}
                            </span>
                        ))}
                        {/* Empty cells for offset */}
                        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                            <span
                                key={`empty-${i}`}
                                className={styles.calendarDay}
                                data-empty="true"
                            />
                        ))}
                        {/* Day cells */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const dateStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                            const isPast = dateStr < today;

                            return (
                                <button
                                    key={dateStr}
                                    type="button"
                                    className={styles.calendarDay}
                                    data-selected={dateStr === selectedDate ? "true" : undefined}
                                    data-today={dateStr === today ? "true" : undefined}
                                    disabled={isPast}
                                    onClick={() => handleSelectDate(dateStr)}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Time slots */}
                {selectedDate && (
                    <div className={styles.timeSlotsSection}>
                        <h3 className={styles.timeSlotsTitle}>
                            Доступное время на {formatDateRu(selectedDate)}
                        </h3>

                        {loadingSlots && <p className={styles.timeSlotsLoading}>Загрузка...</p>}

                        {slotsError && <p className={styles.timeSlotsEmpty}>{slotsError}</p>}

                        {!loadingSlots && !slotsError && slots.length === 0 && (
                            <p className={styles.timeSlotsEmpty}>
                                Нет доступных слотов на эту дату
                            </p>
                        )}

                        {!loadingSlots && !slotsError && slots.length > 0 && (
                            <div className={styles.timeSlotsGrid}>
                                {slots.map((slot) => (
                                    <button
                                        key={slot}
                                        type="button"
                                        className={styles.timeSlot}
                                        data-selected={slot === selectedTime ? "true" : undefined}
                                        onClick={() => onSelectTime(slot)}
                                    >
                                        {slot}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className={styles.stepNav}>
                <button type="button" className={styles.backBtn} onClick={onBack}>
                    Назад
                </button>
                <button
                    type="button"
                    className={styles.nextBtn}
                    disabled={!canNext}
                    onClick={onNext}
                >
                    Далее
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 3: Contact Form
// ---------------------------------------------------------------------------

interface ContactFormProps {
    initialValues: ContactData;
    onSubmit: (data: ContactData) => void;
    onBack: () => void;
}

function ContactForm({ initialValues, onSubmit, onBack }: ContactFormProps) {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<ContactFormValues>({
        resolver: zodResolver(contactSchema),
        defaultValues: {
            firstName: initialValues.firstName,
            lastName: initialValues.lastName,
            email: initialValues.email,
            phone: initialValues.phone,
            dateOfBirth: initialValues.dateOfBirth,
            notes: initialValues.notes,
        },
        mode: "onBlur",
    });

    const onFormSubmit = (data: ContactFormValues) => {
        onSubmit({
            firstName: data.firstName,
            lastName: data.lastName ?? "",
            email: data.email,
            phone: data.phone,
            dateOfBirth: data.dateOfBirth ?? "",
            notes: data.notes ?? "",
        });
    };

    return (
        <div className={styles.stepContainer}>
            <h2 className={styles.stepTitle}>Контактная информация</h2>

            <form className={styles.contactForm} onSubmit={handleSubmit(onFormSubmit)} noValidate>
                <div className={styles.formRow}>
                    <div className={styles.formField}>
                        <label className={styles.formLabel} htmlFor="firstName">
                            Имя *
                        </label>
                        <input
                            id="firstName"
                            type="text"
                            className={styles.formInput}
                            data-error={errors.firstName ? "true" : undefined}
                            placeholder="Имя"
                            {...register("firstName")}
                        />
                        {errors.firstName && (
                            <p className={styles.formError}>{errors.firstName.message}</p>
                        )}
                    </div>

                    <div className={styles.formField}>
                        <label className={styles.formLabel} htmlFor="lastName">
                            Фамилия
                        </label>
                        <input
                            id="lastName"
                            type="text"
                            className={styles.formInput}
                            placeholder="Фамилия"
                            {...register("lastName")}
                        />
                        {errors.lastName && (
                            <p className={styles.formError}>{errors.lastName.message}</p>
                        )}
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formField}>
                        <label className={styles.formLabel} htmlFor="email">
                            Email *
                        </label>
                        <input
                            id="email"
                            type="email"
                            className={styles.formInput}
                            data-error={errors.email ? "true" : undefined}
                            placeholder="email@example.com"
                            {...register("email")}
                        />
                        {errors.email && <p className={styles.formError}>{errors.email.message}</p>}
                    </div>

                    <div className={styles.formField}>
                        <label className={styles.formLabel} htmlFor="phone">
                            Телефон *
                        </label>
                        <input
                            id="phone"
                            type="tel"
                            className={styles.formInput}
                            data-error={errors.phone ? "true" : undefined}
                            placeholder="+79001234567"
                            {...register("phone")}
                        />
                        {errors.phone && <p className={styles.formError}>{errors.phone.message}</p>}
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formField}>
                        <label className={styles.formLabel} htmlFor="dateOfBirth">
                            Дата рождения
                        </label>
                        <input
                            id="dateOfBirth"
                            type="date"
                            className={styles.formInput}
                            {...register("dateOfBirth")}
                        />
                    </div>
                    <div className={styles.formField} />
                </div>

                <div className={styles.formFieldFull}>
                    <label className={styles.formLabel} htmlFor="notes">
                        Примечания
                    </label>
                    <textarea
                        id="notes"
                        className={styles.formTextarea}
                        placeholder="Пожелания, вопросы, аллергии..."
                        rows={3}
                        {...register("notes")}
                    />
                    {errors.notes && <p className={styles.formError}>{errors.notes.message}</p>}
                </div>

                <div className={styles.stepNav}>
                    <button type="button" className={styles.backBtn} onClick={onBack}>
                        Назад
                    </button>
                    <button type="submit" className={styles.nextBtn}>
                        Далее
                    </button>
                </div>
            </form>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 4: Waiver & Signature
// ---------------------------------------------------------------------------

interface WaiverConfirmProps {
    waiver: WaiverData;
    signatureData: string | null;
    onSign: (data: string) => void;
    onClearSignature: () => void;
    submitting: boolean;
    onSubmit: () => void;
    onBack: () => void;
}

function WaiverConfirm({
    waiver,
    signatureData,
    onSign,
    onClearSignature,
    submitting,
    onSubmit,
    onBack,
}: WaiverConfirmProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const hasDrawnRef = useRef(signatureData !== null);
    const initialSignatureRef = useRef(signatureData);

    // Restore signature if returning to this step
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Set canvas resolution
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        ctx.scale(2, 2);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#f0f0f0";
        ctx.lineWidth = 2;

        // Restore existing signature
        const savedSignature = initialSignatureRef.current;
        if (savedSignature) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, rect.width, rect.height);
            };
            img.src = savedSignature;
            hasDrawnRef.current = true;
        }
    }, []);

    const getPos = useCallback(
        (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();

            if ("touches" in e) {
                const touch = e.touches[0];
                if (!touch) return null;
                return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
            }
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        },
        []
    );

    const startDrawing = useCallback(
        (e: React.MouseEvent | React.TouchEvent) => {
            e.preventDefault();
            isDrawingRef.current = true;
            const pos = getPos(e);
            if (!pos) return;
            const ctx = canvasRef.current?.getContext("2d");
            if (!ctx) return;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
        },
        [getPos]
    );

    const draw = useCallback(
        (e: React.MouseEvent | React.TouchEvent) => {
            if (!isDrawingRef.current) return;
            e.preventDefault();
            const pos = getPos(e);
            if (!pos) return;
            const ctx = canvasRef.current?.getContext("2d");
            if (!ctx) return;
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            hasDrawnRef.current = true;
        },
        [getPos]
    );

    const stopDrawing = useCallback(() => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;
        // Save signature data
        const canvas = canvasRef.current;
        if (canvas && hasDrawnRef.current) {
            onSign(canvas.toDataURL("image/png"));
        }
    }, [onSign]);

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawnRef.current = false;
        onClearSignature();
    }, [onClearSignature]);

    const isSigned = signatureData !== null;

    return (
        <div className={styles.stepContainer}>
            <h2 className={styles.stepTitle}>Соглашение и подпись</h2>

            <div className={styles.waiverSection}>
                <div className={styles.waiverText}>{waiver.content}</div>

                <div className={styles.signatureSection}>
                    <span className={styles.signatureLabel}>Ваша подпись (нарисуйте ниже)</span>
                    <canvas
                        ref={canvasRef}
                        className={styles.signatureCanvas}
                        data-signed={isSigned ? "true" : undefined}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                    />
                    <div className={styles.signatureActions}>
                        <button
                            type="button"
                            className={styles.clearSignatureBtn}
                            onClick={clearCanvas}
                        >
                            Очистить
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.stepNav}>
                <button type="button" className={styles.backBtn} onClick={onBack}>
                    Назад
                </button>
                <button
                    type="button"
                    className={styles.submitBtn}
                    disabled={!isSigned || submitting}
                    onClick={onSubmit}
                >
                    {submitting ? "Отправка..." : "Записаться"}
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks / 100);
    return `${rub.toLocaleString("ru-RU")} ₽`;
}

function formatDateRu(dateStr: string): string {
    const [year, month, day] = dateStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
    });
}
