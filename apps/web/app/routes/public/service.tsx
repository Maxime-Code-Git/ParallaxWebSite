import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { Route } from "./+types/service";
import { Footer } from "../../components/public/Footer";
import { Header } from "../../components/public/Header";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import { ScrollToTop } from "../../components/public/ScrollToTop";
import { ENV } from "../../lib/env.server";
import { getHomePortfolioDestinations } from "../../lib/home-activity-links.server";
import { getPortfolioOverviewUrl, getPortfolioProjectUrl } from "../../lib/localized-urls";
import { getProjectVideos, resolveProjectPresentationMode } from "../../lib/portfolio-content.shared";
import { getServicesContent, services } from "../../lib/service-content";
import { getSiteContent } from "../../lib/site-content.server";
import { cleanCommonContent } from "../../lib/site-content.shared";
import { getParallaxSocialProfiles } from "../../lib/social-profiles";
import styles from "./service.module.css";

const labels = {
  fr: { offers: "Prestations", projects: "Réalisations", portfolio: "Voir le portfolio" },
  en: { offers: "Services", projects: "Selected work", portfolio: "View the portfolio" },
};

export function loader({ url }: LoaderFunctionArgs) {
  const path = url.pathname.toLowerCase().replace(/\/$/, "");
  const lang: "fr" | "en" = path.startsWith("/en/") ? "en" : "fr";
  const serviceKey = (["photo", "video"] as const).find((key) => services[key].paths[lang] === path);
  if (!serviceKey) throw new Response("Not Found", { status: 404 });

  const site = getSiteContent();
  const content = getServicesContent(site);
  const { categories, projects, media } = getHomePortfolioDestinations();
  const preferredCategories = new Set(
    categories.filter(({ slugFr }) => services[serviceKey].categorySlugs.includes(slugFr)).map(({ id }) => id)
  );
  const matchingProjects = projects.filter((project) => serviceKey === "video"
    ? getProjectVideos(project).length > 0
    : resolveProjectPresentationMode(project) === "photo" || project.galleryImageIds.length > 0
  );
  const selectedProjects = [
    ...matchingProjects.filter(({ category }) => preferredCategories.has(category)),
    ...matchingProjects.filter(({ category }) => !preferredCategories.has(category)),
  ].slice(0, 3).map((project) => {
    const videoCover = serviceKey === "video" ? getProjectVideos(project).find((video) => video.coverImageId)?.coverImageId : null;
    const imageId = videoCover || project.coverImageId;
    return {
      id: project.id,
      title: project.title[lang],
      href: getPortfolioProjectUrl(project, lang, categories),
      imageId,
      mediaSlot: videoCover ? "video_cover" as const : "cover" as const,
      image: imageId ? media[imageId] : undefined,
    };
  });

  return {
    lang,
    serviceKey,
    page: content[serviceKey],
    area: content.area,
    otherLinkLabel: content[serviceKey === "photo" ? "video" : "photo"].linkLabel[lang],
    siteUrl: ENV.PUBLIC_SITE_URL,
    common: cleanCommonContent(site.common),
    socials: getParallaxSocialProfiles(site.home.contact),
    projects: selectedProjects,
    contactType: site.contactPage.form.projectTypes.some(({ id, enabled }) => id === serviceKey && enabled)
      ? serviceKey
      : undefined,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Parallax" }];

  const { lang, serviceKey, siteUrl, common, page } = loaderData;
  const service = services[serviceKey];
  const base = siteUrl.replace(/\/$/, "");
  const canonical = base + service.paths[lang];
  const title = `${page.seoTitle[lang]} | ${common.brandName}`;
  const description = page.description[lang];

  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    { tagName: "link", rel: "alternate", hrefLang: "fr", href: base + service.paths.fr },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: base + service.paths.en },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: base + service.paths.fr },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: common.brandName },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: `${base}/img/index-0ff090a6e4.jpg` },
  ];
}

export default function ServicePage() {
  const { lang, serviceKey, common, projects, socials, contactType, page, area, otherLinkLabel } = useLoaderData<typeof loader>();
  const service = services[serviceKey];
  const other = services[serviceKey === "photo" ? "video" : "photo"];
  const contactUrl = `/${lang}/contact${contactType ? `?type=${contactType}` : ""}`;

  return (
    <div className={styles.page}>
      <Header common={common} lang={lang} currentRoute="service" alternateUrls={service.paths} />
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1>{page.title[lang]}</h1>
          <p>{page.intro[lang]}</p>
          <p>{area[lang]}</p>
          <Link className={styles.quote} to={contactUrl}>{page.quoteLabel[lang]}</Link>
        </section>

        <section className={styles.section}>
          <h2>{labels[lang].offers}</h2>
          <ul className={styles.grid}>
            {page.offerings.map(({ title, text }, index) => (
              <li key={index}>
                <h3>{title[lang]}</h3>
                <p>{text[lang]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2>{labels[lang].projects}</h2>
          {projects.length > 0 && (
            <ul className={styles.grid}>
              {projects.map((project) => (
                <li key={project.id}>
                  <Link className={styles.project} to={project.href}>
                    <ResponsivePortfolioImage
                      imageId={project.imageId}
                      ownerType="project"
                      ownerId={project.id}
                      mediaSlot={project.mediaSlot}
                      mediaMetadata={project.image}
                      alt=""
                      sizes="(max-width: 640px) 100vw, (max-width: 920px) 50vw, 400px"
                    />
                    <span>{project.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.links}>
            <Link to={getPortfolioOverviewUrl(lang)}>{labels[lang].portfolio}</Link>
            <Link to={other.paths[lang]}>{otherLinkLabel}</Link>
          </div>
        </section>
      </main>
      <Footer common={common} lang={lang} theme="dark" socials={socials} />
      <ScrollToTop lang={lang} />
    </div>
  );
}
