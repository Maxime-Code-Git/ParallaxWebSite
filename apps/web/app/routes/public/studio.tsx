import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getSiteContent } from "../../lib/site-content.server";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { ScrollToTop } from "../../components/public/ScrollToTop";
import { ResponsiveSiteImage } from "../../components/public/ResponsiveSiteImage";
import { ENV } from "../../lib/env.server";
import {
  cleanCommonContent,
  cleanStudioContent,
  cleanTypography,
} from "../../lib/site-content.shared";
import styles from "./studio.module.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const isEn = url.pathname.startsWith("/en");
  const lang: "fr" | "en" = isEn ? "en" : "fr";

  const siteContent = getSiteContent();

  return {
    lang,
    common: cleanCommonContent(siteContent.common),
    studio: cleanStudioContent(siteContent.studio),
    media: siteContent.media || {},
    siteUrl: ENV.PUBLIC_SITE_URL,
  };
}

export function meta({ data }: { data?: Awaited<ReturnType<typeof loader>> }) {
  if (!data) {
    return [{ title: "Studio | Parallax" }];
  }
  const { studio, common, lang, siteUrl } = data;
  const base = (siteUrl || "").replace(/\/$/, "");
  const pageTitle = cleanTypography(studio.seo.title[lang]);
  const pageDesc = cleanTypography(studio.seo.description[lang]);

  const canonicalUrl = `${base}/${lang}/studio`;
  const frUrl = `${base}/fr/studio`;
  const enUrl = `${base}/en/studio`;
  const ogImageUrl = `${base}/img/studio-b4c530c5ae.jpg`;
  const brand = cleanTypography(common?.brandName) || "Parallax";

  return [
    { title: pageTitle },
    { name: "description", content: pageDesc },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
    { tagName: "link", rel: "alternate", hrefLang: "fr", href: frUrl },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: enUrl },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: frUrl },
    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: brand },
    { property: "og:title", content: pageTitle },
    { property: "og:description", content: pageDesc },
    { property: "og:url", content: canonicalUrl },
    { property: "og:image", content: ogImageUrl },
    { property: "og:locale", content: lang === "fr" ? "fr_FR" : "en_US" },
    { property: "og:locale:alternate", content: lang === "fr" ? "en_US" : "fr_FR" },
    // Twitter Card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: pageTitle },
    { name: "twitter:description", content: pageDesc },
    { name: "twitter:image", content: ogImageUrl },
  ];
}

export default function StudioPage() {
  const { lang, common, studio, media } = useLoaderData<typeof loader>();

  return (
    <div className={styles.container}>
      <Header common={common} lang={lang} currentRoute="studio" />

      {/* Hero Section */}
      <section className={styles.heroSection}>
        <div className={styles.heroContent}>
          <div className={styles.heroTextWrapper}>
            <h1 className={styles.heroTitle}>{studio.hero.title[lang]}</h1>
            <p className={styles.heroText}>{studio.hero.text[lang]}</p>
          </div>
          <img
            src="/img/logo-parallax.png"
            alt={common.brandName}
            className={styles.heroLogo}
          />
        </div>
      </section>

      {/* Team Section (Qui sommes-nous) */}
      <section className={styles.teamSection}>
        <h2 className={styles.sectionHeader}>{studio.team.title[lang]}</h2>
        <div className={styles.teamGrid}>
          {studio.team.members.map((member) => {
            const defaultFallback =
              member.id === "ludovic"
                ? "/img/studio-d0f3184629.jpg"
                : "/img/studio-b4c530c5ae.jpg";
            const location =
              member.id === "ludovic" ? "portrait_ludovic" : "portrait_maxime";

            return (
              <article key={member.id} className={styles.memberCard}>
                <div className={styles.memberImageWrapper}>
                  <ResponsiveSiteImage
                    imageId={member.imageId}
                    location={location}
                    mediaMetadata={media[member.imageId]}
                    fallbackSrc={defaultFallback}
                    alt={member.imageAlt[lang]}
                    className={styles.memberImage}
                    sizes="(max-width: 768px) 100vw, 400px"
                    loading="lazy"
                  />
                </div>
                <h3 className={styles.memberName}>{member.name}</h3>
                <div className={styles.memberRole}>{member.role[lang]}</div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Approach Section (Notre approche) */}
      <section className={styles.approachSection}>
        <h2 className={styles.sectionHeader}>{studio.approach.title[lang]}</h2>
        <p className={styles.approachHeadline}>{studio.approach.headline[lang]}</p>
        <p className={styles.approachText}>{studio.approach.text[lang]}</p>
      </section>

      {/* Footer dark theme */}
      <Footer common={common} lang={lang} theme="dark" />

      {/* Floating scroll to top button */}
      <ScrollToTop lang={lang} />
    </div>
  );
}
