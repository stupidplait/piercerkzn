/**
 * Zod schemas shared between client forms (React Hook Form resolvers) and
 * server-side route handlers / Server Actions. Splitting the schemas out of
 * the route files lets the client tree-shake imports without bringing in
 * server-only modules.
 *
 * Convention: each schema exports both the schema and the inferred type.
 */
export * from "./admin";
export * from "./booking-admin";
export * from "./auth";
export * from "./contact";
export * from "./content";
export * from "./newsletters";
export * from "./portfolio";
export * from "./product";
export * from "./reservation";
export * from "./appointment";
export * from "./common";
export * from "./review";
// Re-export only the non-colliding telegram-broadcast schemas. `testSendSchema`,
// `previewQuerySchema`, and their inferred types share names with newsletter
// equivalents; consumers that need the telegram-broadcast versions import them
// directly from "@/lib/validations/tg-broadcasts".
export {
    createBroadcastSchema,
    type CreateBroadcastInput,
    updateBroadcastSchema,
    type UpdateBroadcastInput,
    scheduleBroadcastSchema,
    type ScheduleBroadcastInput,
} from "./tg-broadcasts";
export * from "./uploads";
export * from "./waiver-templates";
export * from "./wishlist";
