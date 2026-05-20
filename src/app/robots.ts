import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            disallow: ["/account", "/admin", "/auth", "/api", "/unsubscribe"],
        },
        sitemap: "https://piercerkzn.ru/sitemap.xml",
    };
}
