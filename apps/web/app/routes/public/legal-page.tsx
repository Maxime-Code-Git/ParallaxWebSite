import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  LEGAL_PAGE_URLS,
  type LegalPageKey,
  type CommonContent,
  type CompanyContent,
  type LegalDocument,
  resolveLegalDocument,
  cleanTypography,
} from "../../lib/site-content.shared";
import {
  getSiteContent,
  getPublicLegalDocument,
  getPublicCompanyContent,
} from "../../lib/site-content.server";
import { parsePrivacyCookie } from "../../lib/privacy-preferences.server";
import { ENV } from "../../lib/env.server";
import { LegalPageView } from "../../components/public/LegalPageView";

export function normalizeLegalPathname(pathname: string): string {
  let clean = pathname.replace(/\/+$/, "");
  if (clean.endsWith(".data")) {
    clean = clean.slice(0, -".data".length).replace(/\/+$/, "");
  }
  return clean;
}

export function resolveLegalRoute(pathname: string): { pageKey: LegalPageKey; lang: "fr" | "en" } | null {
  const clean = normalizeLegalPathname(pathname);
  for (const [key, urls] of Object.entries(LEGAL_PAGE_URLS)) {
    if (urls.fr === clean) {
      return { pageKey: key as LegalPageKey, lang: "fr" };
    }
    if (urls.en === clean) {
      return { pageKey: key as LegalPageKey, lang: "en" };
    }
  }
  return null;
}

export interface LegalPageLoaderData {
  lang: "fr" | "en";
  pageKey: LegalPageKey;
  alternateUrls: { fr: string; en: string };
  siteUrl: string;
  common: CommonContent;
  company: Partial<CompanyContent>;
  document: LegalDocument | null;
  initialPreferences: { youtube: boolean; vimeo: boolean };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const match = resolveLegalRoute(url.pathname);
  if (!match) {
    throw new Response("Not Found", { status: 404 });
  }

  const { pageKey, lang } = match;
  const alternateUrls = LEGAL_PAGE_URLS[pageKey];
  const content = getSiteContent();

  const publishedDoc = getPublicLegalDocument(pageKey);
  const publicCompany = getPublicCompanyContent();
  const resolvedDoc = publishedDoc ? resolveLegalDocument(publishedDoc, publicCompany, "public") : null;

  let initialPreferences = { youtube: false, vimeo: false };
  if (pageKey === "cookies") {
    const cookieHeader = request.headers.get("Cookie");
    const parsed = parsePrivacyCookie(cookieHeader);
    if (parsed) {
      initialPreferences = { youtube: parsed.youtube, vimeo: parsed.vimeo };
    }
  }

  const headers = new Headers();
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie");

  return data<LegalPageLoaderData>(
    {
      lang,
      pageKey,
      alternateUrls,
      siteUrl: ENV.PUBLIC_SITE_URL,
      common: content.common,
      company: publicCompany,
      document: resolvedDoc,
      initialPreferences,
    },
    { headers }
  );
}

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  return loaderHeaders;
};

export function meta({ data }: { data?: {
  lang: "fr" | "en";
  pageKey: LegalPageKey;
  alternateUrls: { fr: string; en: string };
  siteUrl: string;
  document: ReturnType<typeof getPublicLegalDocument>;
} }) {
  if (!data) {
    return [
      { title: "Parallax" },
      { name: "robots", content: "noindex, nofollow" },
    ];
  }

  const { lang, alternateUrls, siteUrl, document } = data;
  const base = siteUrl.replace(/\/$/, "");

  if (!document) {
    return [
      { title: lang === "fr" ? "Document en préparation | Parallax" : "Document under preparation | Parallax" },
      { name: "robots", content: "noindex, nofollow" },
    ];
  }

  const canonicalUrl = `${base}${alternateUrls[lang]}`;
  const frUrl = `${base}${alternateUrls.fr}`;
  const enUrl = `${base}${alternateUrls.en}`;

  return [
    { title: cleanTypography(document.seoTitle[lang]) },
    { name: "description", content: cleanTypography(document.seoDescription[lang]) },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
    { tagName: "link", rel: "alternate", hrefLang: "fr", href: frUrl },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: enUrl },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: frUrl },
  ];
}

export default function LegalRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <LegalPageView
      mode="public"
      lang={data.lang}
      pageKey={data.pageKey}
      common={data.common}
      company={data.company}
      document={data.document}
      alternateUrls={data.alternateUrls}
      initialPreferences={data.initialPreferences}
    />
  );
}
