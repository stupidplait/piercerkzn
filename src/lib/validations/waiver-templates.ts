/**
 * Admin waiver template mutation validation.
 *
 * `version` is the unique audit identifier of a waiver revision and is
 * immutable after creation — bumping the legal text is done by inserting a
 * new template at version+1, not by editing an existing row. The update
 * schema therefore exposes only `content` and `isActive`.
 */
import { z } from "zod";

export const createWaiverTemplateSchema = z.object({
    version: z.coerce.number().int().min(1),
    content: z.string().min(1).max(50_000),
    /** Defaults to `true` at the DB layer. */
    isActive: z.boolean().optional(),
});
export type CreateWaiverTemplateInput = z.infer<typeof createWaiverTemplateSchema>;

export const updateWaiverTemplateSchema = z.object({
    content: z.string().min(1).max(50_000).optional(),
    isActive: z.boolean().optional(),
});
export type UpdateWaiverTemplateInput = z.infer<typeof updateWaiverTemplateSchema>;
