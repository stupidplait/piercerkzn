import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// All collaborators of the booking actions are mocked so the tests focus on
// validation + side-effect orchestration (no DB / Redis / Resend / PostHog).
// ---------------------------------------------------------------------------
const {
    captureMock,
    enqueueRemindersMock,
    cancelRemindersMock,
    sendEmailMock,
    createApptMock,
    cancelApptMock,
    rescheduleApptMock,
    authMock,
    AppointmentError,
} = vi.hoisted(() => {
    class AppointmentError extends Error {
        readonly code: string;
        constructor(message: string, code: string) {
            super(message);
            this.code = code;
            this.name = "AppointmentError";
        }
    }
    return {
        captureMock: vi.fn(),
        enqueueRemindersMock: vi.fn(async () => ({ scheduled: [], skipped: [] })),
        cancelRemindersMock: vi.fn(async () => undefined),
        sendEmailMock: vi.fn(async () => "msg_123"),
        createApptMock: vi.fn(),
        cancelApptMock: vi.fn(),
        rescheduleApptMock: vi.fn(),
        authMock: vi.fn(),
        AppointmentError,
    };
});

vi.mock("next/headers", () => ({
    headers: async () =>
        new Headers({
            "x-real-ip": "203.0.113.7",
            "user-agent": "vitest",
        }),
}));

// `@/lib/rate-limit` eagerly constructs the ioredis client at import time;
// stub it so the action's `ipFromHeaders` call doesn't pull in Redis.
vi.mock("@/lib/rate-limit", () => ({
    ipFromHeaders: (h: Headers) => h.get("x-real-ip") ?? "unknown",
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/posthog", () => ({
    capture: captureMock,
    getPostHogSessionId: () => null,
}));
vi.mock("@/emails/dispatch", () => ({
    sendAppointmentConfirmationEmail: sendEmailMock,
}));
vi.mock("@/lib/booking/reminders", () => ({
    enqueueAppointmentReminders: enqueueRemindersMock,
    cancelAppointmentReminders: cancelRemindersMock,
}));
vi.mock("@/lib/booking/appointments", () => ({
    AppointmentError,
    createAppointment: createApptMock,
    cancelAppointment: cancelApptMock,
    rescheduleAppointment: rescheduleApptMock,
}));

import {
    cancelAppointmentAction,
    createAppointmentAction,
    rescheduleAppointmentAction,
} from "./booking";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VALID_BOOK_INPUT = {
    serviceIds: ["11111111-1111-4111-8111-111111111111"],
    date: "2099-05-14",
    time: "12:30",
    customer: {
        firstName: "Иван",
        lastName: "Иванов",
        email: "ivan@example.com",
        phone: "+79001234567",
    },
    waiverSigned: true as const,
    waiverSignatureData: "base64-png-stub",
};

const APPT_FIXTURE = {
    id: "appt-id",
    referenceNumber: "PK-APT-2026-0001",
    status: "pending",
    date: "2099-05-14",
    timeStart: "12:30",
    timeEnd: "13:00",
    totalDurationMin: 30,
    estimatedTotal: 250000,
    customerId: "cust-id",
    customerEmail: "ivan@example.com",
    customerFirstName: "Иван",
    cancelledAt: null,
    updatedAt: new Date("2099-05-01T00:00:00Z"),
};

beforeEach(() => {
    captureMock.mockReset();
    enqueueRemindersMock.mockReset().mockResolvedValue({ scheduled: [], skipped: [] });
    cancelRemindersMock.mockReset().mockResolvedValue(undefined);
    sendEmailMock.mockReset().mockResolvedValue("msg_123");
    createApptMock.mockReset();
    cancelApptMock.mockReset();
    rescheduleApptMock.mockReset();
    authMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// createAppointmentAction
// ---------------------------------------------------------------------------
describe("createAppointmentAction", () => {
    it("returns validation_error for malformed input", async () => {
        const out = await createAppointmentAction({});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("validation_error");
    });

    it("succeeds, fires PostHog + email + reminders, and returns the appointment", async () => {
        authMock.mockResolvedValue({ user: { customerId: "cust-id" } });
        createApptMock.mockResolvedValue({
            appointment: APPT_FIXTURE,
            customer: {
                id: "cust-id",
                email: "ivan@example.com",
                firstName: "Иван",
                lastName: "Иванов",
                phone: "+79001234567",
            },
            customerCreated: false,
            temporaryPassword: null,
            serviceTitles: ["Pinna helix"],
        });

        const out = await createAppointmentAction(VALID_BOOK_INPUT);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.data.appointmentId).toBe("appt-id");
        expect(out.data.referenceNumber).toBe("PK-APT-2026-0001");
        expect(out.data.services).toEqual(["Pinna helix"]);

        expect(createApptMock).toHaveBeenCalledWith(
            expect.objectContaining({ date: "2099-05-14", time: "12:30" }),
            expect.objectContaining({
                sessionCustomerId: "cust-id",
                ipAddress: "203.0.113.7",
                userAgent: "vitest",
            })
        );

        // Side effects fired
        expect(captureMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: "appointment_booked",
                properties: expect.objectContaining({ via: "server_action" }),
            })
        );

        // Email + reminders are fire-and-forget — let microtasks settle.
        await new Promise((r) => setImmediate(r));
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        expect(enqueueRemindersMock).toHaveBeenCalledTimes(1);
    });

    it("maps AppointmentError to a typed failure", async () => {
        authMock.mockResolvedValue({ user: {} });
        createApptMock.mockRejectedValue(new AppointmentError("Слот занят", "slot_unavailable"));

        const out = await createAppointmentAction(VALID_BOOK_INPUT);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("slot_unavailable");
        expect(captureMock).not.toHaveBeenCalled();
        expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("returns internal_error for unexpected throws", async () => {
        authMock.mockResolvedValue({ user: {} });
        createApptMock.mockRejectedValue(new Error("boom"));

        const out = await createAppointmentAction(VALID_BOOK_INPUT);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("internal_error");
    });
});

// ---------------------------------------------------------------------------
// cancelAppointmentAction
// ---------------------------------------------------------------------------
describe("cancelAppointmentAction", () => {
    it("returns unauthorized when there is no session", async () => {
        authMock.mockResolvedValue(null);
        const out = await cancelAppointmentAction("appt-id", {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("unauthorized");
    });

    it("passes actor=customer for a customer session", async () => {
        authMock.mockResolvedValue({
            user: { id: "u-1", customerId: "cust-id", role: "customer" },
        });
        cancelApptMock.mockResolvedValue({
            ...APPT_FIXTURE,
            status: "cancelled",
            cancelledAt: new Date("2099-05-12T10:00:00Z"),
        });

        const out = await cancelAppointmentAction("appt-id", { reason: "no" });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.data.status).toBe("cancelled");
        expect(cancelApptMock).toHaveBeenCalledWith(
            "appt-id",
            expect.objectContaining({ actor: "customer", customerId: "cust-id", reason: "no" })
        );
        expect(captureMock).toHaveBeenCalledWith(
            expect.objectContaining({
                event: "appointment_cancelled",
                properties: expect.objectContaining({ actor: "customer" }),
            })
        );

        await new Promise((r) => setImmediate(r));
        expect(cancelRemindersMock).toHaveBeenCalledWith("appt-id");
    });

    it("passes actor=studio for an admin session", async () => {
        authMock.mockResolvedValue({
            user: { id: "u-1", customerId: null, role: "admin" },
        });
        cancelApptMock.mockResolvedValue({ ...APPT_FIXTURE, status: "cancelled" });

        await cancelAppointmentAction("appt-id", {});
        expect(cancelApptMock).toHaveBeenCalledWith(
            "appt-id",
            expect.objectContaining({ actor: "studio" })
        );
    });

    it("maps AppointmentError (invalid_state)", async () => {
        authMock.mockResolvedValue({ user: { id: "u-1", role: "customer" } });
        cancelApptMock.mockRejectedValue(new AppointmentError("Уже завершена", "invalid_state"));

        const out = await cancelAppointmentAction("appt-id", {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("invalid_state");
    });
});

// ---------------------------------------------------------------------------
// rescheduleAppointmentAction
// ---------------------------------------------------------------------------
describe("rescheduleAppointmentAction", () => {
    const VALID_INPUT = { date: "2099-06-01", time: "11:00" };

    it("returns validation_error for malformed input", async () => {
        const out = await rescheduleAppointmentAction("appt-id", {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("validation_error");
    });

    it("returns unauthorized when no customerId is in the session", async () => {
        authMock.mockResolvedValue({ user: { id: "u-1", customerId: null } });
        const out = await rescheduleAppointmentAction("appt-id", VALID_INPUT);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("unauthorized");
    });

    it("cancels stale reminders + re-enqueues on success", async () => {
        authMock.mockResolvedValue({ user: { id: "u-1", customerId: "cust-id" } });
        rescheduleApptMock.mockResolvedValue({
            ...APPT_FIXTURE,
            date: "2099-06-01",
            timeStart: "11:00",
            timeEnd: "11:30",
        });

        const out = await rescheduleAppointmentAction("appt-id", VALID_INPUT);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.data.date).toBe("2099-06-01");
        expect(out.data.timeStart).toBe("11:00");
        expect(captureMock).toHaveBeenCalledWith(
            expect.objectContaining({ event: "appointment_rescheduled" })
        );

        await new Promise((r) => setImmediate(r));
        expect(cancelRemindersMock).toHaveBeenCalledWith("appt-id");
        expect(enqueueRemindersMock).toHaveBeenCalledTimes(1);
    });

    it("maps AppointmentError (forbidden)", async () => {
        authMock.mockResolvedValue({ user: { id: "u-1", customerId: "cust-id" } });
        rescheduleApptMock.mockRejectedValue(new AppointmentError("Не ваша запись", "forbidden"));

        const out = await rescheduleAppointmentAction("appt-id", VALID_INPUT);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error.code).toBe("forbidden");
    });
});
