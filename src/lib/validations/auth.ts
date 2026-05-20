/**
 * Auth-related Zod schemas. Used by:
 *   - Auth.js Credentials providers (`src/lib/auth.ts`)
 *   - Server Actions (`src/actions/auth.ts` — Phase 7)
 *   - Login / register forms (Phase 6 UI)
 */
import { z } from "zod";
import { emailSchema, nameSchema, phoneSchema } from "./common";

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, "Введите пароль").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Admin login adds an optional TOTP `code`. The credential provider treats
 * empty / missing code as "not enrolled or first-step submission" and only
 * fails the auth when `totp_enabled` is true on the admin row.
 */
export const adminLoginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/u, "Код должен содержать 6 цифр")
        .optional()
        .or(z.literal("")),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/**
 * Body for POST /api/admin/auth/2fa/verify — supplied during enrollment to
 * confirm the freshly-issued secret, OR during step-up confirmation.
 */
export const totpCodeSchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/u, "Код должен содержать 6 цифр"),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

/**
 * Body for POST /api/admin/auth/2fa/disable — both factors required so that
 * neither a forgotten unlocked browser nor a leaked authenticator alone can
 * silently turn off 2FA on the owner's account.
 */
export const totpDisableSchema = z.object({
    password: z.string().min(1, "Введите пароль").max(128),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/u, "Код должен содержать 6 цифр"),
});
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;

// ---------------------------------------------------------------------------
// Register — client-facing customer signup
// ---------------------------------------------------------------------------
export const registerSchema = z
    .object({
        email: emailSchema,
        password: z.string().min(8, "Пароль не короче 8 символов").max(128),
        confirmPassword: z.string(),
        firstName: nameSchema,
        lastName: nameSchema.optional(),
        phone: phoneSchema.optional(),
    })
    .refine((d) => d.password === d.confirmPassword, {
        path: ["confirmPassword"],
        message: "Пароли не совпадают",
    });
export type RegisterInput = z.infer<typeof registerSchema>;

// ---------------------------------------------------------------------------
// Magic link request
// ---------------------------------------------------------------------------
export const magicLinkSchema = z.object({ email: emailSchema });
export type MagicLinkInput = z.infer<typeof magicLinkSchema>;

// ---------------------------------------------------------------------------
// Telegram Login Widget payload (verified via HMAC in `auth-utils.ts`)
// ---------------------------------------------------------------------------
export const telegramLoginSchema = z.object({
    id: z.union([z.string(), z.number()]),
    first_name: nameSchema,
    last_name: nameSchema.optional(),
    username: z.string().max(64).optional(),
    photo_url: z.string().url().max(512).optional(),
    auth_date: z.union([z.string(), z.number()]),
    hash: z.string().regex(/^[a-f0-9]{64}$/iu, "Некорректная подпись"),
});
export type TelegramLoginInput = z.infer<typeof telegramLoginSchema>;

// ---------------------------------------------------------------------------
// Forgot / reset password (Phase 6.x — auth pages)
// ---------------------------------------------------------------------------
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
    .object({
        token: z.string().min(20).max(200),
        password: z.string().min(8).max(128),
        confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
        path: ["confirmPassword"],
        message: "Пароли не совпадают",
    });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------------------
// Change password (authenticated user)
// ---------------------------------------------------------------------------
export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(8).max(128),
        confirmPassword: z.string(),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
        path: ["confirmPassword"],
        message: "Пароли не совпадают",
    });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Update profile (customer self-service)
// ---------------------------------------------------------------------------
export const updateProfileSchema = z
    .object({
        firstName: nameSchema.optional(),
        // Allow clearing the optional fields by sending null.
        lastName: nameSchema.nullish(),
        phone: phoneSchema.nullish(),
        // ISO date (YYYY-MM-DD); accept null to clear.
        dateOfBirth: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/u, "Дата должна быть в формате YYYY-MM-DD")
            .nullish(),
        avatarUrl: z.string().url().max(512).nullish(),
        notificationEmail: z.boolean().optional(),
        notificationSms: z.boolean().optional(),
        notificationPush: z.boolean().optional(),
        notificationMarketing: z.boolean().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: "Нет полей для обновления" });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------------------
// Delete account (customer self-service)
// Customers with a password must re-confirm it. OAuth-only accounts may omit.
// ---------------------------------------------------------------------------
export const deleteAccountSchema = z.object({
    password: z.string().min(1).max(128).optional(),
    reason: z.string().max(500).optional(),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
