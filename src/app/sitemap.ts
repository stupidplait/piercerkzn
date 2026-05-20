import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema/products";
import { curatedLooks } from "@/db/schema/looks";
import { blogPosts } from "@/db/schema/content";
import { aftercareGuides } from "@/db/schema/content";

const BASE_URL = "https://piercerkzn.ru";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const [publishedProducts, publishedLooks, publishedPosts, publishedGuides] = await Promise.all([
        db
            .select({ handle: products.handle })
            .from(products)
            .where(eq(products.status, "published")),
        db
            .select({ handle: curatedLooks.handle })
            .from(curatedLooks)
            .where(eq(curatedLooks.isPublished, true)),
        db
            .select({ slug: blogPosts.slug, publishedAt: blogPosts.publishedAt })
            .from(blogPosts)
            .where(eq(blogPosts.status, "published")),
        db
            .select({ handle: aftercareGuides.handle })
            .from(aftercareGuides)
            .where(eq(aftercareGuides.isPublished, true)),
    ]);

    const staticRoutes: MetadataRoute.Sitemap = [
        {
            url: BASE_URL,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "weekly",
            priority: 1,
        },
        {
            url: `${BASE_URL}/catalog`,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "daily",
            priority: 0.9,
        },
        {
            url: `${BASE_URL}/looks`,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "weekly",
            priority: 0.8,
        },
        {
            url: `${BASE_URL}/about`,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "monthly",
            priority: 0.7,
        },
        {
            url: `${BASE_URL}/contact`,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "monthly",
            priority: 0.5,
        },
        {
            url: `${BASE_URL}/aftercare`,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "weekly",
            priority: 0.7,
        },
        {
            url: `${BASE_URL}/blog`,
            lastModified: new Date("2025-01-01"),
            changeFrequency: "daily",
            priority: 0.8,
        },
    ];

    const productEntries: MetadataRoute.Sitemap = publishedProducts.map((p) => ({
        url: `${BASE_URL}/catalog/${p.handle}`,
        changeFrequency: "weekly",
        priority: 0.8,
    }));

    const lookEntries: MetadataRoute.Sitemap = publishedLooks.map((l) => ({
        url: `${BASE_URL}/looks/${l.handle}`,
        changeFrequency: "weekly",
        priority: 0.7,
    }));

    const blogEntries: MetadataRoute.Sitemap = publishedPosts.map((post) => ({
        url: `${BASE_URL}/blog/${post.slug}`,
        lastModified: post.publishedAt ?? undefined,
        changeFrequency: "monthly",
        priority: 0.6,
    }));

    const aftercareEntries: MetadataRoute.Sitemap = publishedGuides.map((g) => ({
        url: `${BASE_URL}/aftercare/${g.handle}`,
        changeFrequency: "monthly",
        priority: 0.6,
    }));

    return [
        ...staticRoutes,
        ...productEntries,
        ...lookEntries,
        ...blogEntries,
        ...aftercareEntries,
    ];
}
