import type { LoaderFunctionArgs } from "react-router";
import { ENV } from "../../lib/env.server";
import { getSiteContent, getPublicLegalDocument } from "../../lib/site-content.server";
import { getPublicPortfolioContent } from "../../lib/portfolio-content.server";
import { LEGAL_PAGE_KEYS, LEGAL_PAGE_URLS } from "../../lib/site-content.shared";

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatW3cDate(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

interface SitemapUrlEntry {
  loc: string;
  alternates: {
    fr: string;
    en: string;
  };
  lastmod?: string | null;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: string;
}

export async function loader(_args?: LoaderFunctionArgs) {
  const base = ENV.PUBLIC_SITE_URL.replace(/\/$/, "");

  const siteContent = getSiteContent();
  const { content: portfolioContent, publicCategories, publicProjects } = getPublicPortfolioContent();

  const siteLastmod = formatW3cDate(siteContent?.updatedAt);
  const portfolioLastmod = formatW3cDate(portfolioContent?.updatedAt);

  const entries: SitemapUrlEntry[] = [];

  function addBilingualPair(
    pathFr: string,
    pathEn: string,
    lastmod?: string | null,
    priority = "0.8",
    changefreq: "daily" | "weekly" | "monthly" | "yearly" = "weekly"
  ) {
    const fullFr = `${base}${pathFr}`;
    const fullEn = `${base}${pathEn}`;

    entries.push({
      loc: fullFr,
      alternates: { fr: fullFr, en: fullEn },
      lastmod,
      priority,
      changefreq,
    });

    entries.push({
      loc: fullEn,
      alternates: { fr: fullFr, en: fullEn },
      lastmod,
      priority,
      changefreq,
    });
  }

  // 1. Vitrine Pages
  addBilingualPair("/fr", "/en", siteLastmod, "1.0", "weekly");
  addBilingualPair("/fr/studio", "/en/studio", siteLastmod, "0.8", "monthly");
  addBilingualPair("/fr/contact", "/en/contact", siteLastmod, "0.8", "monthly");

  // 2. Portfolio Overview
  addBilingualPair("/fr/projets", "/en/projects", portfolioLastmod, "0.9", "weekly");

  // 3. Published Portfolio Categories
  for (const cat of publicCategories) {
    const slugFr = encodeURIComponent(cat.slugFr);
    const slugEn = encodeURIComponent(cat.slugEn);
    addBilingualPair(
      `/fr/projets/${slugFr}`,
      `/en/projects/${slugEn}`,
      portfolioLastmod,
      "0.8",
      "weekly"
    );
  }

  // 4. Published Portfolio Projects in Published Categories
  const categoryMap = new Map(publicCategories.map((c) => [c.id, c]));
  for (const project of publicProjects) {
    const cat = categoryMap.get(project.category);
    if (!cat) continue;
    const catSlugFr = encodeURIComponent(cat.slugFr);
    const catSlugEn = encodeURIComponent(cat.slugEn);
    const projSlugFr = encodeURIComponent(project.slugFr);
    const projSlugEn = encodeURIComponent(project.slugEn);

    addBilingualPair(
      `/fr/projets/${catSlugFr}/${projSlugFr}`,
      `/en/projects/${catSlugEn}/${projSlugEn}`,
      portfolioLastmod,
      "0.7",
      "monthly"
    );
  }

  // 5. Legal Pages (strictly only published ones)
  for (const key of LEGAL_PAGE_KEYS) {
    const publishedDoc = getPublicLegalDocument(key);
    if (!publishedDoc) continue;

    const urls = LEGAL_PAGE_URLS[key];
    const pageRecord = siteContent.legalPages?.[key];
    const legalLastmod = formatW3cDate(pageRecord?.lastUpdated || publishedDoc.effectiveDate) || siteLastmod;

    addBilingualPair(urls.fr, urls.en, legalLastmod, "0.5", "yearly");
  }

  // Build XML lines
  const xmlLines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];

  for (const entry of entries) {
    xmlLines.push("  <url>");
    xmlLines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    xmlLines.push(`    <xhtml:link rel="alternate" hreflang="fr" href="${escapeXml(entry.alternates.fr)}"/>`);
    xmlLines.push(`    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(entry.alternates.en)}"/>`);
    xmlLines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(entry.alternates.fr)}"/>`);
    if (entry.lastmod) {
      xmlLines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      xmlLines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    }
    if (entry.priority) {
      xmlLines.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
    }
    xmlLines.push("  </url>");
  }

  xmlLines.push("</urlset>");
  const xml = xmlLines.join("\n") + "\n";

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
