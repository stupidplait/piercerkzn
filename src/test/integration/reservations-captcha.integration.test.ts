import { describe, it, expect, vi, beforeEach } from "vitest";
import { readResponse } from "@/test/integration/helpers";

// Mock captcha verifier
const mockVerifyCaptcha = vi.fn();
vi.mock("@/lib/captcha/verify", () => ({
    verifyCaptcha: (...args: unknown[]) => mockVerifyCaptcha(...args),
}));

// Mock env
vi.mock("@/lib/env", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/env")>();
    return {
        ...orig,
        env: {
            ...orig.env,
            NODE_ENV: "test",
            CAPTCHA_PROVIDER: "turnstile",
            CAPTCHA_SECRET_KEY: "test-key",
            CAPTCHA_DEV_BYPASS: "0",
            CAPTCHA_EXPECTED_HOSTNAME: undefined,
            CORS_ALLOWED_ORIGINS: "",
        },
    };
});

// Mock rate-limit to always admit
vi.mock("@/lib/rate-limit", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/rate-limit")>();
    return {
        ...orig,
        check: vi.fn().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 }),
        isBypassPath: () => false,
    };
});

// Mock auth (unauthenticated)
vi.mock("@/lib/auth", () => ({
    auth: vi.fn().mockResolvedValue(null),
}));

// Mock createReservation
const mockCreateReservation = vi.fn();
vi.mock("@/lib/reservations", () => ({
    createReservation: (...args: unknown[]) => mockCreateReservation(...args),
    ReservationError: class ReservationError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

// Mock side effects
const mockCapture = vi.fn();
vi.mock("@/lib/posthog", () => ({
    capture: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("@/lib/queue", () => ({
    enqueueReservationExpiry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/telegram/notifications", () => ({
    notifyReservationCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/emails/dispatch", () => ({
    sendReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock log
const mockLogSecurityEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/log", () => ({
    logSecurityEvent: (...args: unknown[]) => mockLogSecurityEvent(...args),
}));

import { POST } from "@/app/api/reservations/route";
import { env } from "@/lib/env";
import { randomUUID } from "crypto";

const MOCK_RESERVATION_RESULT = {
    reservation: {
        id: randomUUID(),
        referenceNumber: "RES-001",
        status: "pending",
        total: 5000,
        currencyCode: "RUB",
        expiresAt: new Date(Date.now() + 86400000),
        customerNotes: null,
        createdAt: new Date(),
        customerId: randomUUID(),
        customerEmail: "test@test.local",
        customerFirstName: "Test",
        metadata: null,
    },
    items: [
        {
            id: randomUUID(),
            title: "Test Item",
            variantTitle: "Silver",
            sku: "TST-001",
            thumbnailUrl: null,
            unitPrice: 5000,
            quantity: 1,
            total: 5000,
            metadata: null,
        },
    ],
    customer: { id: randomUUID(), email: "test@test.local", firstName: "Test", lastName: null },
    customerCreated: false,
};

function buildReservationRequest(overrides: Record<string, unknown> = {}): Request {
    return new Request("http://test.local/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({
            items: [{ variantId: randomUUID(), quantity: 1 }],
            customer: {
                firstName: "Test",
                email: "test@test.local",
                phone: "+79001234567",
            },
            captchaToken: "a".repeat(30),
            ...overrides,
        }),
    });
}

describe("POST /api/reservations - captcha gate", () => {
    beforeEach(() => {
        mockVerifyCaptcha.mockReset();
        mockCreateReservation.mockReset();
        mockCapture.mockReset();
        mockLogSecurityEvent.mockReset();
        (env as any).CAPTCHA_EXPECTED_HOSTNAME = undefined;
        mockCreateReservation.mockResolvedValue(MOCK_RESERVATION_RESULT);
    });

    // Property 6: Persistence fires iff verifier returns ok:true
    it("P6: creates reservation and fires capture when captcha ok", async () => {
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "piercer.kzn",
        });

        const res = await POST(buildReservationRequest());
        const { status } = await readResponse(res);

        expect(status).toBe(201);
        expect(mockCreateReservation).toHaveBeenCalledTimes(1);
        expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    it("P6: does NOT create reservation when captcha fails", async () => {
        mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "invalid_token" });

        const res = await POST(buildReservationRequest());
        const { status } = await readResponse(res);

        expect(status).toBe(422);
        expect(mockCreateReservation).not.toHaveBeenCalled();
        expect(mockCapture).not.toHaveBeenCalled();
    });

    // Property 7: Captcha rejection produces stable wire format
    it("P7: rejection returns canonical 422 envelope", async () => {
        mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "expired_token" });

        const res = await POST(buildReservationRequest());
        const { status, json } = await readResponse<any>(res);

        expect(status).toBe(422);
        expect(json.error).toBe("validation_error");
        expect(json.fields.captchaToken).toBe(
            "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u0430, \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430."
        );
    });

    it("P7: rejection logs captcha_rejected with prefix only", async () => {
        const token = "12345678" + "x".repeat(22);
        mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "duplicate_token" });

        await POST(buildReservationRequest({ captchaToken: token }));

        expect(mockLogSecurityEvent).toHaveBeenCalledWith(
            "captcha_rejected",
            expect.objectContaining({
                route: "/api/reservations",
                reason: "duplicate_token",
                captchaTokenPrefix: "12345678",
            })
        );
    });

    // Property 8: Hostname check
    it("P8: admits when CAPTCHA_EXPECTED_HOSTNAME is unset", async () => {
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "anything.com",
        });

        const res = await POST(buildReservationRequest());
        expect(res.status).toBe(201);
    });

    it("P8: admits when hostname matches expected", async () => {
        (env as any).CAPTCHA_EXPECTED_HOSTNAME = "piercer.kzn";
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "piercer.kzn",
        });

        const res = await POST(buildReservationRequest());
        expect(res.status).toBe(201);
    });

    it("P8: rejects when hostname does not match expected", async () => {
        (env as any).CAPTCHA_EXPECTED_HOSTNAME = "piercer.kzn";
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "evil.com",
        });

        const res = await POST(buildReservationRequest());
        const { status } = await readResponse(res);
        expect(status).toBe(422);

        expect(mockLogSecurityEvent).toHaveBeenCalledWith(
            "captcha_rejected",
            expect.objectContaining({ reason: "hostname_mismatch" })
        );
    });
});
