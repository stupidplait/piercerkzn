"use server";

/**
 * Server action for the contact form. Mirrors `/api/contact` but is callable
 * directly from a `<form action={contactAction}>` without client JS.
 */
import { db, inquiries, type Inquiry } from "@/db";
import { capture } from "@/lib/posthog";
import { allocateAndInsert } from "@/lib/reference-numbers";
import { contactInquirySchema } from "@/lib/validations";

import type { ActionResult } from "./auth";

export async function contactAction(
    raw: unknown
): Promise<ActionResult<{ referenceNumber: string }>> {
    const parsed = contactInquirySchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: {
                code: "validation_error",
                message: "Проверьте корректность введённых данных",
                details: parsed.error.issues.map((i) => ({
                    path: i.path.join("."),
                    message: i.message,
                })),
            },
        };
    }

    const { row: created } = await allocateAndInsert<Inquiry>(
        "INQ",
        {
            table: inquiries,
            referenceColumn: inquiries.referenceNumber,
            createdAtColumn: inquiries.createdAt,
            uniqueConstraintName: "inquiry_reference_number_unique",
        },
        db,
        (referenceNumber) => ({
            referenceNumber,
            name: parsed.data.name,
            email: parsed.data.email,
            phone: parsed.data.phone ?? null,
            subject: parsed.data.subject ?? "general",
            message: parsed.data.message,
            status: "new",
        })
    );

    capture({
        event: "contact_submitted",
        distinctId: `email:${parsed.data.email}`,
        properties: { reference_number: created.referenceNumber, via: "server_action" },
    });

    return { ok: true, data: { referenceNumber: created.referenceNumber } };
}
