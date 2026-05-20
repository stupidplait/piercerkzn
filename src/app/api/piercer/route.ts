/**
 * GET /api/piercer — singleton owner/piercer profile.
 *
 * The studio has exactly one piercer, so this returns the first row in the
 * `piercer_profile` table. Backs `/about` (1.6) and the booking flow header.
 *
 * Returns 404 if the profile hasn't been seeded yet (development setup).
 */
import { asc } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { db, piercerProfile } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [row] = await db
            .select()
            .from(piercerProfile)
            .orderBy(asc(piercerProfile.createdAt))
            .limit(1);

        if (!row) return notFound("Профиль мастера ещё не создан");

        return ok({
            piercer: {
                id: row.id,
                firstName: row.firstName,
                lastName: row.lastName,
                title: row.title,
                bio: row.bio,
                avatarUrl: row.avatarUrl,
                bannerUrl: row.bannerUrl,
                experienceYears: row.experienceYears,
                specializations: row.specializations ?? [],
                certifications: row.certifications ?? [],
                socialInstagram: row.socialInstagram,
                socialTiktok: row.socialTiktok,
                socialTelegram: row.socialTelegram,
                ratingAverage: row.ratingAverage ? Number(row.ratingAverage) : 0,
                ratingCount: row.ratingCount ?? 0,
            },
        });
    } catch (error) {
        console.error("[/api/piercer] failed", error);
        return internal();
    }
}
