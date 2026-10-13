import { useState, useEffect, useRef } from "react";
import {
  type LoaderFunctionArgs,
  Link,
  useLoaderData,
  useLocation,
  useNavigate,
} from "react-router";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { VideoModal } from "../../components/public/VideoModal";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import {
  type PortfolioContent,
  type PortfolioProject,
  type PortfolioCategory,
  calculateEffectiveSide,
} from "../../lib/portfolio-content.shared";
import { getPublicPortfolioContent } from "../../lib/portfolio-content.server";
import { getSiteContent, type CommonContent } from "../../lib/site-content.server";
import { ENV } from "../../lib/env.server";
import {
  getPortfolioOverviewUrl,
  getPortfolioSectionUrl,
  getPortfolioProjectUrl,
  getPortfolioAlternateUrls,
} from "../../lib/localized-urls";
import styles from "./portfolio.module.css";

interface LoaderData {
  lang: "fr" | "en";
  common: CommonContent;
  content: PortfolioContent;
  showcaseProjects: PortfolioProject[];
  panelState: {
    isOpen: boolean;
    activeCategory: PortfolioCategory | null;
    activeProject: PortfolioProject | null;
    direction: "left" | "right";
  };
  alternateUrls: {
    fr: string;
    en: string;
  };
  siteUrl: string;
}

export function meta({ data }: { data?: LoaderData }) {
  if (!data) return [{ title: "Portfolio | Parallax" }];
  const { lang, content, panelState, siteUrl, alternateUrls } = data;

  let pageTitle = `${content.overview.title[lang]} — Parallax`;
  let pageDesc = content.overview.seo.description[lang];

  if (panelState.activeProject) {
    pageTitle = `${panelState.activeProject.title[lang]} — Parallax`;
    pageDesc = panelState.activeProject.summary[lang];
  } else if (panelState.activeCategory) {
    const sec = content.sections[panelState.activeCategory];
    pageTitle = `${sec.title[lang]} — Parallax`;
    pageDesc = sec.intro[lang];
  }

  const base = siteUrl.replace(/\/$/, "");
  const canonicalUrl = `${base}${lang === "fr" ? alternateUrls.fr : alternateUrls.en}`;
  const frUrl = `${base}${alternateUrls.fr}`;
  const enUrl = `${base}${alternateUrls.en}`;

  return [
    { title: pageTitle },
    { name: "description", content: pageDesc },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
    { tagName: "link", rel: "alternate", hrefLang: "fr", href: frUrl },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: enUrl },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: frUrl },
    { name: "robots", content: "index, follow" },
  ];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const lang: "fr" | "en" = pathname.startsWith("/en") ? "en" : "fr";

  const { content, publicProjects } = getPublicPortfolioContent();
  const common = getSiteContent().common;

  // Determine section or project route from URL params & pathname
  let activeCategory: PortfolioCategory | null = null;
  let activeProject: PortfolioProject | null = null;

  const isDocuSection =
    pathname === "/fr/projets/documentaire" || pathname === "/en/projects/documentary";
  const isPubSection =
    pathname === "/fr/projets/publicite" || pathname === "/en/projects/advertising";

  if (isDocuSection) {
    activeCategory = "documentary";
  } else if (isPubSection) {
    activeCategory = "advertising";
  } else if (params.rubrique || params.category) {
    // Project detail requested
    const rawCat = (params.rubrique || params.category || "").toLowerCase();
    const cat: PortfolioCategory =
      rawCat === "documentaire" || rawCat === "documentary" ? "documentary" : "advertising";
    const slug = params.slugFr || params.slugEn;

    if (slug) {
      const found = publicProjects.find(
        (p) => (lang === "fr" ? p.slugFr === slug : p.slugEn === slug) && p.category === cat
      );
      if (!found) {
        throw new Response("Projet introuvable", { status: 404 });
      }
      activeProject = found;
      activeCategory = cat;
    }
  }

  // Direction: read query parameter 'dir' or infer from category default
  let direction: "left" | "right" = "right";
  const queryDir = url.searchParams.get("dir");
  if (queryDir === "left" || queryDir === "right") {
    direction = queryDir;
  } else if (activeCategory === "advertising") {
    direction = "left"; // Row 2 advertising opens from left by default
  }

  const isOpen = activeCategory !== null;

  // Build showcase projects (featured or top 3)
  const showcaseProjects = publicProjects.filter((p) => p.showcase);

  const alternateUrls = getPortfolioAlternateUrls(activeProject, activeCategory);

  return Response.json(
    {
      lang,
      common,
      content,
      showcaseProjects,
      panelState: {
        isOpen,
        activeCategory,
        activeProject,
        direction,
      },
      alternateUrls,
      siteUrl: ENV.PUBLIC_SITE_URL,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}

export default function PortfolioPage() {
  const { lang, common, content, showcaseProjects, panelState, alternateUrls } =
    useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const location = useLocation();

  const [panelOpen, setPanelOpen] = useState(panelState.isOpen);
  const [panelDirection, setPanelDirection] = useState<"left" | "right">(panelState.direction);
  const [showGallery, setShowGallery] = useState(false);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPanelOpen(panelState.isOpen);
    if (panelState.isOpen) {
      setPanelDirection(panelState.direction);
      setShowGallery(false);
      // Lock scroll on background
      document.body.style.overflow = "hidden";
      if (panelRef.current) {
        panelRef.current.scrollTop = 0;
      }
    } else {
      document.body.style.overflow = "";
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [panelState.isOpen, panelState.direction, location.pathname]);

  // Handle ESC key to close panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && panelOpen) {
        handleClosePanel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen]);

  function handleClosePanel() {
    setPanelOpen(false);
    navigate(getPortfolioOverviewUrl(lang), { replace: false });
  }

  // Fallback showcase items matching prototype if no custom projects exist
  const defaultShowcaseRows = [
    {
      category: "documentary" as const,
      categoryTitle: content.sections.documentary.title[lang],
      summary: content.projects[0]?.summary[lang] || "Un court documentaire sur une boulangerie artisanale, du fournil à la vitrine.",
      fallbackImg: "/img/img-fe32ce05c3.png",
      alt: "Documentaire boulangerie",
      side: "left" as const,
      openDirection: "right" as const,
      sectionUrl: getPortfolioSectionUrl("documentary", lang),
    },
    {
      category: "advertising" as const,
      categoryTitle: content.sections.advertising.title[lang],
      summary: content.projects[1]?.summary[lang] || "Film publicitaire pour une marque de vélo, entre studio et grand air.",
      fallbackImg: "/img/img-b431c99fa2.png",
      alt: "Publicité vélo",
      side: "right" as const,
      openDirection: "left" as const,
      sectionUrl: getPortfolioSectionUrl("advertising", lang),
    },
    {
      category: "advertising" as const,
      categoryTitle: content.sections.advertising.title[lang],
      summary: content.projects[2]?.summary[lang] || "Nature morte en mouvement pour le lancement d'un produit.",
      fallbackImg: "/img/img-5abab13d55.png",
      alt: "Publicité produit",
      side: "left" as const,
      openDirection: "right" as const,
      sectionUrl: getPortfolioSectionUrl("advertising", lang),
    },
  ];

  // If user has published projects in showcase, map them
  const rowsToRender =
    showcaseProjects.length > 0
      ? showcaseProjects.map((p, idx) => {
          const effectiveSide = calculateEffectiveSide(p.side, idx);
          // Direction formula: imageSide === "left" ? "right" : "left"
          const openDirection = effectiveSide === "left" ? ("right" as const) : ("left" as const);
          return {
            category: p.category,
            categoryTitle: content.sections[p.category].title[lang],
            summary: p.summary[lang],
            project: p,
            fallbackImg: idx === 0 ? "/img/img-fe32ce05c3.png" : idx === 1 ? "/img/img-b431c99fa2.png" : "/img/img-5abab13d55.png",
            alt: p.coverAlt[lang] || p.title[lang],
            side: effectiveSide,
            openDirection,
            sectionUrl: `${getPortfolioSectionUrl(p.category, lang)}?dir=${openDirection}`,
          };
        })
      : defaultShowcaseRows;

  // Active section data for panel
  const activeSec = panelState.activeCategory
    ? content.sections[panelState.activeCategory]
    : null;

  // Filter projects for the active category
  const categoryProjects = panelState.activeCategory
    ? content.projects.filter(
        (p) => p.category === panelState.activeCategory && p.status === "published" && !p.archived
      )
    : [];

  // Collect all gallery images in this category for the "Voir plus de photos" masonry view
  const categoryGalleryImages: { imageId: string; alt: string; projectId: string }[] = [];
  if (categoryProjects.length > 0) {
    for (const p of categoryProjects) {
      for (const gid of p.galleryImageIds) {
        categoryGalleryImages.push({
          imageId: gid,
          alt: p.title[lang],
          projectId: p.id,
        });
      }
    }
  }

  // Static prototype fallback gallery photos if category has no uploaded gallery images
  const defaultDocuGalleryThumbs = [
    "/img/projets-e47f65d0c6.jpg",
    "/img/projets-a9bf38c02a.jpg",
    "/img/projets-f5fdea0b4c.jpg",
    "/img/projets-4317a9aef7.jpg",
    "/img/projets-51bd361c0c.jpg",
    "/img/projets-d85c1edc7d.jpg",
  ];

  return (
    <div className={styles.pageRoot}>
      <Header
        common={common}
        lang={lang}
        currentRoute="portfolio"
        alternateUrls={alternateUrls}
      />

      <main>
        <section className={styles.heroSection}>
          <h1 className={styles.heroTitle}>{content.overview.title[lang]}</h1>
        </section>

        <section className={styles.showcaseSection}>
          {rowsToRender.map((row, index) => {
            const isImageLeft = row.side === "left";
            const rowClass = `${styles.showcaseRow} ${
              isImageLeft ? styles.rowLayoutLeft : styles.rowLayoutRight
            } ${index > 0 ? styles.rowOverlap : ""}`;

            const imageComponent = (
              <div className={styles.imageCol} key="img">
                {"project" in row && row.project && row.project.coverImageId ? (
                  <ResponsivePortfolioImage
                    imageId={row.project.coverImageId}
                    ownerType="project"
                    ownerId={row.project.id}
                    mediaSlot="cover"
                    mediaMetadata={content.media[row.project.coverImageId]}
                    fallbackSrc={row.fallbackImg}
                    alt={row.alt}
                    className={styles.showcaseImg}
                  />
                ) : (
                  <img
                    src={row.fallbackImg}
                    alt={row.alt}
                    className={styles.showcaseImg}
                  />
                )}
              </div>
            );

            const textComponent = (
              <div
                className={isImageLeft ? styles.textColLeft : styles.textColRight}
                key="text"
              >
                <div className={styles.textCard}>
                  <div className={styles.categoryTag}>{row.categoryTitle}</div>
                  <p className={styles.projectSummary}>{row.summary}</p>
                  <Link
                    to={row.sectionUrl}
                    className={`${styles.seeMoreBtn} ${
                      isImageLeft ? styles.seeMoreBtnLeft : styles.seeMoreBtnRight
                    }`}
                    onClick={(e) => {
                      triggerRef.current = e.currentTarget;
                    }}
                  >
                    {!isImageLeft && (
                      <span className={styles.circleIcon} aria-hidden="true">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#F5F6F7"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M19 12 H5" />
                          <path d="M11 6 L5 12 L11 18" />
                        </svg>
                      </span>
                    )}
                    <span>{content.overview.seeMoreButton[lang]}</span>
                    {isImageLeft && (
                      <span className={styles.circleIcon} aria-hidden="true">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#F5F6F7"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12 H19" />
                          <path d="M13 6 L19 12 L13 18" />
                        </svg>
                      </span>
                    )}
                  </Link>
                </div>
              </div>
            );

            return (
              <div className={rowClass} key={index}>
                {isImageLeft ? [imageComponent, textComponent] : [textComponent, imageComponent]}
              </div>
            );
          })}
        </section>
      </main>

      <Footer common={common} lang={lang} />

      {/* -------------------------------------------------------------
       * Directional Panel Overlay
       * ------------------------------------------------------------- */}
      <div
        ref={panelRef}
        className={styles.panelOverlay}
        data-direction={panelDirection}
        data-state={panelOpen ? "open" : "closed"}
        role="dialog"
        aria-modal={panelOpen}
        aria-label={
          panelState.activeProject
            ? panelState.activeProject.title[lang]
            : activeSec
            ? activeSec.title[lang]
            : "Portfolio"
        }
      >
        <div className={styles.panelContent}>
          {/* Top navigation buttons */}
          <div className={styles.panelNavButtons}>
            {panelState.activeProject ? (
              <Link
                to={getPortfolioSectionUrl(panelState.activeProject.category, lang)}
                className={styles.backBtn}
              >
                <span className={styles.circleIcon} style={{ width: 34, height: 34 }}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F5F6F7"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 12 H5" />
                    <path d="M11 6 L5 12 L11 18" />
                  </svg>
                </span>
                <span>
                  {lang === "fr"
                    ? `Retour à ${content.sections[panelState.activeProject.category].title[lang]}`
                    : `Back to ${content.sections[panelState.activeProject.category].title[lang]}`}
                </span>
              </Link>
            ) : (
              <Link to={getPortfolioOverviewUrl(lang)} className={styles.backBtn}>
                <span className={styles.circleIcon} style={{ width: 34, height: 34 }}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F5F6F7"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 12 H5" />
                    <path d="M11 6 L5 12 L11 18" />
                  </svg>
                </span>
                <span>{activeSec?.backButton[lang] || "Retour aux projets"}</span>
              </Link>
            )}

            <Link
              to={getPortfolioOverviewUrl(lang)}
              className={styles.closeBtn}
              aria-label="Fermer le panneau"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 L6 18" />
                <path d="M6 6 L18 18" />
              </svg>
            </Link>
          </div>

          {/* VIEW 1: Project Detail (if activeProject is set) */}
          {panelState.activeProject ? (
            <div className={styles.detailContainer}>
              <div className={styles.detailCategory}>
                {content.sections[panelState.activeProject.category].title[lang]}
              </div>
              <h2 className={styles.detailTitle}>
                {panelState.activeProject.title[lang]}
              </h2>
              <p className={styles.detailSummary}>
                {panelState.activeProject.summary[lang]}
              </p>

              {panelState.activeProject.coverImageId && (
                <div className={styles.detailCoverWrap}>
                  <ResponsivePortfolioImage
                    imageId={panelState.activeProject.coverImageId}
                    ownerType="project"
                    ownerId={panelState.activeProject.id}
                    mediaSlot="cover"
                    mediaMetadata={content.media[panelState.activeProject.coverImageId]}
                    alt={panelState.activeProject.coverAlt[lang] || panelState.activeProject.title[lang]}
                  />
                </div>
              )}

              {/* Video with play button if configured */}
              {panelState.activeProject.video && (
                <div className={styles.showreelCard} style={{ marginBottom: 48 }}>
                  {panelState.activeProject.video.coverImageId ? (
                    <ResponsivePortfolioImage
                      imageId={panelState.activeProject.video.coverImageId}
                      ownerType="project"
                      ownerId={panelState.activeProject.id}
                      mediaSlot="video_cover"
                      mediaMetadata={content.media[panelState.activeProject.video.coverImageId]}
                      alt="Vidéo du projet"
                    />
                  ) : null}
                  <button
                    type="button"
                    className={styles.playBtn}
                    onClick={() => setActiveVideoUrl(panelState.activeProject!.video!.url)}
                    aria-label="Lire la vidéo"
                  >
                    <svg width="24" height="26" viewBox="0 0 26 28" fill="none">
                      <path d="M4 3 L23 14 L4 25 Z" fill="#F5F6F7" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Typed Description Paragraphs */}
              {panelState.activeProject.description.length > 0 && (
                <div className={styles.detailBody}>
                  {panelState.activeProject.description.map((block, bIdx) =>
                    block.type === "heading" ? (
                      <h3 key={bIdx}>{block.text[lang]}</h3>
                    ) : (
                      <p key={bIdx}>{block.text[lang]}</p>
                    )
                  )}
                </div>
              )}

              {/* Project Photo Gallery */}
              {panelState.activeProject.galleryImageIds.length > 0 && (
                <div>
                  <h3 className={styles.detailGalleryTitle}>
                    {lang === "fr" ? "Galerie photos" : "Photo gallery"}
                  </h3>
                  <div className={styles.detailGalleryGrid}>
                    {panelState.activeProject.galleryImageIds.map((gid) => (
                      <div key={gid} className={styles.detailGalleryItem}>
                        <ResponsivePortfolioImage
                          imageId={gid}
                          ownerType="project"
                          ownerId={panelState.activeProject!.id}
                          mediaSlot="gallery"
                          mediaMetadata={content.media[gid]}
                          alt={panelState.activeProject!.title[lang]}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeSec ? (
            /* VIEW 2: Section Category Overview (Documentaire / Publicité) */
            <div>
              {/* Category Header Hero */}
              <div
                className={styles.sectionHero}
                style={{
                  backgroundImage: activeSec.coverImageId
                    ? undefined
                    : activeSec.category === "documentary"
                    ? "url(/img/projets-141c16b0a2.jpg)"
                    : undefined,
                }}
              >
                {activeSec.coverImageId && (
                  <ResponsivePortfolioImage
                    imageId={activeSec.coverImageId}
                    ownerType="section"
                    ownerId={activeSec.category}
                    mediaSlot="cover"
                    mediaMetadata={content.media[activeSec.coverImageId]}
                    alt={activeSec.coverAlt[lang]}
                    className={styles.showcaseImg}
                  />
                )}
                <div className={styles.sectionGradient} />
                <div className={styles.sectionTitleWrap}>
                  <h2 className={styles.sectionTitle}>{activeSec.title[lang]}</h2>
                </div>
              </div>

              {/* Category Intro */}
              <div className={styles.sectionIntroWrap}>
                <p className={styles.sectionIntro}>{activeSec.intro[lang]}</p>
              </div>

              {/* Category switch tabs */}
              <div className={styles.filterTabs}>
                <Link
                  to={getPortfolioSectionUrl("documentary", lang)}
                  className={`${styles.filterTab} ${
                    activeSec.category === "documentary" ? styles.filterTabActive : ""
                  }`}
                >
                  {content.sections.documentary.title[lang]}
                </Link>
                <Link
                  to={getPortfolioSectionUrl("advertising", lang)}
                  className={`${styles.filterTab} ${
                    activeSec.category === "advertising" ? styles.filterTabActive : ""
                  }`}
                >
                  {content.sections.advertising.title[lang]}
                </Link>
              </div>

              {/* Projects in this section */}
              <div className={styles.projectsList}>
                {categoryProjects.length > 0 ? (
                  categoryProjects.map((p, pIdx) => {
                    const isEven = pIdx % 2 === 0;
                    return (
                      <Link
                        to={getPortfolioProjectUrl(p, lang)}
                        key={p.id}
                        className={styles.projectCardLink}
                      >
                        <div
                          className={styles.projectRow}
                          style={{
                            flexDirection: isEven ? "row" : "row-reverse",
                          }}
                        >
                          <div
                            style={{
                              flex: "none",
                              width: isEven ? 560 : 480,
                              maxWidth: "100%",
                            }}
                          >
                            <div
                              className={`${styles.imageBox} ${
                                isEven ? styles.aspect32 : styles.aspect45
                              }`}
                            >
                              {p.coverImageId ? (
                                <ResponsivePortfolioImage
                                  imageId={p.coverImageId}
                                  ownerType="project"
                                  ownerId={p.id}
                                  mediaSlot="cover"
                                  mediaMetadata={content.media[p.coverImageId]}
                                  alt={p.coverAlt[lang] || p.title[lang]}
                                />
                              ) : (
                                <img
                                  src={
                                    defaultDocuGalleryThumbs[
                                      pIdx % defaultDocuGalleryThumbs.length
                                    ]
                                  }
                                  alt={p.title[lang]}
                                />
                              )}
                            </div>
                          </div>

                          <div
                            style={{
                              flex: 1,
                              textAlign: isEven ? "left" : "right",
                            }}
                          >
                            <div className={styles.projectInfoTitle}>
                              {p.title[lang]}
                            </div>
                            <p
                              className={styles.projectInfoDesc}
                              style={{
                                marginLeft: isEven ? 0 : "auto",
                                marginRight: isEven ? "auto" : 0,
                              }}
                            >
                              {p.summary[lang]}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <p className={styles.emptyState}>
                    {lang === "fr"
                      ? "Aucun projet publié dans cette rubrique pour le moment."
                      : "No published projects in this category yet."}
                  </p>
                )}
              </div>

              {/* "Voir plus de photos" Masonry Gallery */}
              <div className={styles.galleryToggleWrap}>
                <button
                  type="button"
                  className={styles.togglePhotosBtn}
                  onClick={() => setShowGallery(!showGallery)}
                >
                  <span>
                    {showGallery
                      ? activeSec.lessPhotosButton[lang]
                      : activeSec.morePhotosButton[lang]}
                  </span>
                  <span
                    className={styles.chevronIcon}
                    style={{
                      transform: showGallery ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                    aria-hidden="true"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#F5F6F7"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 9 L12 15 L18 9" />
                    </svg>
                  </span>
                </button>
              </div>

              {showGallery && (
                <div className={styles.masonryGrid}>
                  {categoryGalleryImages.length > 0
                    ? categoryGalleryImages.map((item, gIdx) => (
                        <div key={gIdx} className={styles.masonryItem}>
                          <div className={styles.masonryThumb}>
                            <ResponsivePortfolioImage
                              imageId={item.imageId}
                              ownerType="project"
                              ownerId={item.projectId}
                              mediaSlot="gallery"
                              mediaMetadata={content.media[item.imageId]}
                              alt={item.alt}
                            />
                          </div>
                        </div>
                      ))
                    : defaultDocuGalleryThumbs.map((src, sIdx) => (
                        <div key={sIdx} className={styles.masonryItem}>
                          <div className={styles.masonryThumb}>
                            <img src={src} alt="Galerie exemple" />
                          </div>
                        </div>
                      ))}
                </div>
              )}

              {/* Showreel Section */}
              <div className={styles.showreelSection}>
                <div className={styles.showreelDivider}>
                  <h3 className={styles.showreelHeader}>{activeSec.showreelTitle[lang]}</h3>
                  <div className={styles.showreelCard}>
                    {activeSec.showreelCoverImageId ? (
                      <ResponsivePortfolioImage
                        imageId={activeSec.showreelCoverImageId}
                        ownerType="section"
                        ownerId={activeSec.category}
                        mediaSlot="showreel_cover"
                        mediaMetadata={content.media[activeSec.showreelCoverImageId]}
                        alt={activeSec.showreelTitle[lang]}
                      />
                    ) : (
                      <img
                        src="/img/projets-f654378a4c.jpg"
                        alt={activeSec.showreelTitle[lang]}
                      />
                    )}
                    <button
                      type="button"
                      className={styles.playBtn}
                      onClick={() =>
                        setActiveVideoUrl(
                          activeSec.showreelVideo?.url ||
                            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                        )
                      }
                      aria-label="Lire le showreel"
                    >
                      <svg width="26" height="28" viewBox="0 0 26 28" fill="none">
                        <path d="M4 3 L23 14 L4 25 Z" fill="#F5F6F7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Video Modal with explicit consent */}
      {activeVideoUrl && (
        <VideoModal
          isOpen={Boolean(activeVideoUrl)}
          onClose={() => setActiveVideoUrl(null)}
          videoUrl={activeVideoUrl}
          lang={lang}
        />
      )}
    </div>
  );
}
