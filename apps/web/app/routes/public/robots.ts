import type { LoaderFunctionArgs } from "react-router";
import { ENV } from "../../lib/env.server";

export async function loader(_args?: LoaderFunctionArgs) {
  const publicSiteUrl = ENV.PUBLIC_SITE_URL.replace(/\/$/, "");

  const lines = [
    "Disallow: /admin",
    "Disallow: /admin/",
    "Disallow: /api/",
    "Disallow: /fr/galerie/",
    "Disallow: /en/gallery/",
    "Disallow: /fr/espace-client",
    "Disallow: /en/client-area",
    "",
    `Sitemap: ${publicSiteUrl}/sitemap.xml`,
    "",
  ];

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
