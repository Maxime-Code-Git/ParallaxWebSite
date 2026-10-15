import type { LoaderFunctionArgs, HeadersArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { getRawSiteContent } from "../../lib/site-content.server";
import {
  LEGAL_PAGE_KEYS,
  LEGAL_PAGE_URLS,
  type LegalPageKey,
  type CommonContent,
  type CompanyContent,
  type LegalDocument,
} from "../../lib/site-content.shared";
import { LegalPageView } from "../../components/public/LegalPageView";

export function meta() {
  return [
    { title: "Aperçu privé | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  const h = composeAdminHeaders(args);
  h.set("Cache-Control", "no-store, no-cache, must-revalidate");
  h.set("X-Robots-Tag", "noindex, nofollow");
  return h;
}

export interface LegalPreviewLoaderData {
  lang: "fr" | "en";
  pageKey: LegalPageKey;
  alternateUrls: { fr: string; en: string };
  common: CommonContent;
  company: CompanyContent;
  draft: LegalDocument;
  initialPreferences: { youtube: boolean; vimeo: boolean };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);
  const pageKey = params.pageKey as LegalPageKey;

  if (!LEGAL_PAGE_KEYS.includes(pageKey)) {
    throw new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  const lang: "fr" | "en" = langParam === "en" ? "en" : "fr";

  const { content } = getRawSiteContent();
  const pageRecord = content.legalPages[pageKey];
  const alternateUrls = LEGAL_PAGE_URLS[pageKey];

  const headers = createAdminHeaders();
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return data<LegalPreviewLoaderData>(
    {
      lang,
      pageKey,
      alternateUrls,
      common: content.common,
      company: content.company,
      draft: pageRecord.draft,
      initialPreferences: { youtube: false, vimeo: false },
    },
    { headers }
  );
}

export default function AdminLegalPreviewPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <LegalPageView
      mode="preview"
      lang={data.lang}
      pageKey={data.pageKey}
      common={data.common}
      company={data.company}
      document={data.draft}
      alternateUrls={data.alternateUrls}
      initialPreferences={data.initialPreferences}
    />
  );
}
