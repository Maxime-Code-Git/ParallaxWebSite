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

  let pageTitle = content.overview.seo.title[lang] || `${content.overview.title[lang]} — Parallax`;
  let pageDesc = content.overview.seo.description[lang] || content.overview.intro[lang];

  if (panelState.activeProject) {
    pageTitle =
      panelState.activeProject.seo.title[lang] ||
      `${panelState.activeProject.title[lang]} — Parallax`;
    pageDesc =
      panelState.activeProject.seo.description[lang] ||
      panelState.activeProject.summary[lang];
  } else if (panelState.activeCategory) {
    const sec = content.sections[panelState.activeCategory];
    pageTitle = sec.seo.title[lang] || `${sec.title[lang]} — Parallax`;
    pageDesc = sec.seo.description[lang] || sec.intro[lang];
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
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const lang: "fr" | "en" = pathname.startsWith("/en") ? "en" : "fr";

  const { content, publicProjects } = getPublicPortfolioContent();
  const common = getSiteContent().common;

  // Use route params: client navigations keep the .data suffix in request.url.
  let activeCategory: PortfolioCategory | null = null;
  let activeProject: PortfolioProject | null = null;

  if (params.rubrique || params.category) {
    let cat: PortfolioCategory | null = null;
    if (lang === "fr") {
      const raw = (params.rubrique || "").toLowerCase();
      if (raw === "documentaire") cat = "documentary";
      else if (raw === "publicite") cat = "advertising";
      else throw new Response("Rubrique introuvable", { status: 404 });
    } else {
      const raw = (params.category || "").toLowerCase();
      if (raw === "documentary") cat = "documentary";
      else if (raw === "advertising") cat = "advertising";
      else throw new Response("Section not found", { status: 404 });
    }

    const slug = lang === "fr" ? params.slugFr : params.slugEn;
    if (slug) {
      const found = publicProjects.find(
        (p) => (lang === "fr" ? p.slugFr === slug : p.slugEn === slug) && p.category === cat
      );
      if (!found) {
        throw new Response("Projet introuvable", { status: 404 });
      }
      activeProject = found;
    }
    activeCategory = cat;
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

  const alternateUrls = getPortfolioAlternateUrls(activeProject, activeCategory, direction);

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

  // Persistent panel lifecycle: "closed" | "opening" | "open" | "closing"
  type PanelPhase = "closed" | "opening" | "open" | "closing";
  const [phase, setPhase] = useState<PanelPhase>(
    panelState.isOpen ? "open" : "closed"
  );
  const [panelDirection, setPanelDirection] = useState<"left" | "right">(panelState.direction);
  const [showGallery, setShowGallery] = useState(false);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Cached content ref to keep content rendered during closing animation
  const cachedContentRef = useRef<{
    activeCategory: PortfolioCategory | null;
    activeProject: PortfolioProject | null;
  }>({
    activeCategory: panelState.activeCategory,
    activeProject: panelState.activeProject,
  });

  if (panelState.isOpen) {
    cachedContentRef.current = {
      activeCategory: panelState.activeCategory,
      activeProject: panelState.activeProject,
    };
  }

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLAnchorElement | null>(null);
  const isClosingRef = useRef(false);
  const isInitialMountRef = useRef(true);
  const prevIsOpenRef = useRef(panelState.isOpen);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevIsOpenRef.current = panelState.isOpen;
      if (panelState.isOpen) {
        document.body.classList.add(styles.bodyScrollLocked);
      }
      return;
    }

    const wasOpen = prevIsOpenRef.current;
    const isOpenNow = panelState.isOpen;
    prevIsOpenRef.current = isOpenNow;

    // Transition from CLOSED to OPEN: Real entrance animation
    if (!wasOpen && isOpenNow) {
      isClosingRef.current = false;
      setPanelDirection(panelState.direction);
      setShowGallery(false);
      // Frame 1: Mount visible off-screen without transition
      setPhase("opening");
      document.body.classList.add(styles.bodyScrollLocked);
      if (panelRef.current) {
        panelRef.current.scrollTop = 0;
      }

      // Frame 2: Trigger transition into translateX(0)
      let raf2Id = 0;
      const raf1Id = requestAnimationFrame(() => {
        raf2Id = requestAnimationFrame(() => {
          setPhase("open");
          setTimeout(() => {
            closeBtnRef.current?.focus();
          }, 50);
        });
      });

      return () => {
        cancelAnimationFrame(raf1Id);
        if (raf2Id) cancelAnimationFrame(raf2Id);
      };
    }

    // Already OPEN, navigating between category and project
    if (wasOpen && isOpenNow) {
      setPanelDirection(panelState.direction);
      setShowGallery(false);
      if (phase !== "open") {
        setPhase("open");
      }
      if (panelRef.current) {
        panelRef.current.scrollTop = 0;
      }
      return;
    }

    // Transition from OPEN to CLOSED (e.g. browser back button)
    if (wasOpen && !isOpenNow) {
      if (phase === "open" || phase === "opening") {
        setPhase("closing");
        const delay = isReducedMotion ? 50 : 500;
        const timer = setTimeout(() => {
          setPhase("closed");
          document.body.classList.remove(styles.bodyScrollLocked);
        }, delay);
        return () => clearTimeout(timer);
      } else {
        setPhase("closed");
        document.body.classList.remove(styles.bodyScrollLocked);
      }
    }
  }, [panelState.isOpen, panelState.direction, location.pathname, isReducedMotion]);

  // Restore focus after React has removed inert from the trigger's ancestors.
  useEffect(() => {
    if (phase === "closed" && triggerRef.current?.isConnected) {
      triggerRef.current.focus();
    }
  }, [phase]);

  // Handle ESC key (with priority to VideoModal)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && phase === "open" && !activeVideoUrl) {
        handleClosePanel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, activeVideoUrl, lang, isReducedMotion]);

  // Focus trap within panelRef when open
  useEffect(() => {
    if (phase !== "open" || !panelRef.current) return;
    const panelEl = panelRef.current;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (activeVideoUrl) return;

      const focusable = panelEl.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", handleTab);
    return () => window.removeEventListener("keydown", handleTab);
  }, [phase, activeVideoUrl]);

  function handleClosePanel() {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setPhase("closing");

    const delay = isReducedMotion ? 50 : 500;
    setTimeout(() => {
      setPhase("closed");
      document.body.classList.remove(styles.bodyScrollLocked);
      navigate(getPortfolioOverviewUrl(lang), { replace: false });
    }, delay);
  }

  // Active or cached category/project for panel display
  const effectiveCategory = panelState.isOpen
    ? panelState.activeCategory
    : cachedContentRef.current.activeCategory;
  const effectiveProject = panelState.isOpen
    ? panelState.activeProject
    : cachedContentRef.current.activeProject;

  const activeSec = effectiveCategory ? content.sections[effectiveCategory] : null;

  // Build showcase presentation rows from published projects
  const rowsToRender = showcaseProjects.map((p, idx) => {
    const effectiveSide = calculateEffectiveSide(p.side, idx);
    const openDirection = effectiveSide === "left" ? ("right" as const) : ("left" as const);
    return {
      category: p.category,
      categoryTitle: content.sections[p.category].title[lang],
      summary: p.summary[lang],
      project: p,
      alt: p.coverAlt[lang] || p.title[lang],
      side: effectiveSide,
      openDirection,
      sectionUrl: `${getPortfolioSectionUrl(p.category, lang)}?dir=${openDirection}`,
    };
  });

  // Projects in active section
  const categoryProjects = effectiveCategory
    ? content.projects.filter(
        (p) => p.category === effectiveCategory && p.status === "published" && !p.archived
      )
    : [];

  // Collect all gallery images in this category
  const categoryGalleryImages: { imageId: string; alt: string; projectId: string }[] = [];
  if (categoryProjects.length > 0) {
    for (const p of categoryProjects) {
      for (const gid of p.galleryImageIds) {
        categoryGalleryImages.push({
          imageId: gid,
          alt: p.coverAlt[lang] || p.title[lang],
          projectId: p.id,
        });
      }
    }
  }

  const dirParam = `?dir=${panelDirection}`;

  return (
    <div className={styles.pageRoot}>
      <div inert={phase !== "closed" ? true : undefined}>
        <Header common={common} lang={lang} currentRoute="portfolio" alternateUrls={alternateUrls} />
      </div>

      {/* Main Showcase Feed */}
      <main className={styles.showcaseSection} inert={phase !== "closed" ? true : undefined}>
        {/* Prototype Hero Title */}
        <section className={styles.heroSection}>
          <h1 className={styles.heroTitle}>{content.overview.title[lang]}</h1>
        </section>

        {rowsToRender.length > 0 ? (
          rowsToRender.map((row, idx) => {
            const isLeftImage = row.side === "left";
            const rowClass = `${styles.showcaseRow} ${
              isLeftImage ? styles.rowLayoutLeft : styles.rowLayoutRight
            } ${idx > 0 ? styles.rowOverlap : ""}`;
            return (
              <section key={`${row.category}-${idx}`} className={rowClass}>
                {isLeftImage ? (
                  <>
                    {/* Left: Image block */}
                    <div className={styles.imageCol}>
                      <Link
                        to={row.sectionUrl}
                        className={styles.imageLink}
                        onClick={(e) => {
                          triggerRef.current = e.currentTarget;
                        }}
                        aria-label={`Ouvrir la rubrique ${row.categoryTitle}`}
                      >
                        <div className={styles.imageWrapper}>
                          {row.project.coverImageId && (
                            <ResponsivePortfolioImage
                              imageId={row.project.coverImageId}
                              ownerType="project"
                              ownerId={row.project.id}
                              mediaSlot="cover"
                              mediaMetadata={content.media[row.project.coverImageId]}
                              alt={row.alt}
                              className={styles.showcaseImg}
                              loading={idx === 0 ? "eager" : "lazy"}
                            />
                          )}
                        </div>
                      </Link>
                    </div>

                    {/* Right: Text Content block (overlapping dark side of image) */}
                    <div className={styles.textColLeft}>
                      <div className={styles.textCard}>
                        <div className={styles.categoryTag}>{row.categoryTitle}</div>
                        <p className={styles.projectSummary}>{row.summary}</p>
                        <Link
                          to={row.sectionUrl}
                          className={`${styles.seeMoreBtn} ${styles.seeMoreBtnLeft}`}
                          onClick={(e) => {
                            triggerRef.current = e.currentTarget;
                          }}
                        >
                          <span className={styles.btnLabel}>
                            {content.overview.seeMoreButton[lang]}
                          </span>
                          <span className={styles.circleIcon}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M5 12 H19 M12 5 L19 12 L12 19"
                                stroke="#F5F6F7"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </Link>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Left: Text Content block (overlapping dark side of image) */}
                    <div className={styles.textColRight}>
                      <div className={styles.textCard}>
                        <div className={styles.categoryTag}>{row.categoryTitle}</div>
                        <p className={styles.projectSummary}>{row.summary}</p>
                        <Link
                          to={row.sectionUrl}
                          className={`${styles.seeMoreBtn} ${styles.seeMoreBtnRight}`}
                          onClick={(e) => {
                            triggerRef.current = e.currentTarget;
                          }}
                        >
                          <span className={styles.circleIcon}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M19 12 H5 M12 5 L5 12 L12 19"
                                stroke="#F5F6F7"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className={styles.btnLabel}>
                            {content.overview.seeMoreButton[lang]}
                          </span>
                        </Link>
                      </div>
                    </div>

                    {/* Right: Image block */}
                    <div className={styles.imageCol}>
                      <Link
                        to={row.sectionUrl}
                        className={styles.imageLink}
                        onClick={(e) => {
                          triggerRef.current = e.currentTarget;
                        }}
                        aria-label={`Ouvrir la rubrique ${row.categoryTitle}`}
                      >
                        <div className={styles.imageWrapper}>
                          {row.project.coverImageId && (
                            <ResponsivePortfolioImage
                              imageId={row.project.coverImageId}
                              ownerType="project"
                              ownerId={row.project.id}
                              mediaSlot="cover"
                              mediaMetadata={content.media[row.project.coverImageId]}
                              alt={row.alt}
                              className={styles.showcaseImg}
                              loading="lazy"
                            />
                          )}
                        </div>
                      </Link>
                    </div>
                  </>
                )}
              </section>
            );
          })
        ) : (
          <div className={styles.emptyOverview}>
            <p>
              {lang === "fr"
                ? "Aucune réalisation en vitrine pour le moment."
                : "No showcase projects available at this time."}
            </p>
          </div>
        )}
      </main>

      <div inert={phase !== "closed" ? true : undefined}>
        <Footer common={common} lang={lang} />
      </div>

      {/* Directional Sliding Panel Overlay */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          effectiveProject
            ? effectiveProject.title[lang]
            : activeSec
            ? activeSec.title[lang]
            : "Portfolio"
        }
        className={styles.panelOverlay}
        data-direction={panelDirection}
        data-state={phase}
        hidden={phase === "closed"}
      >
        <div className={styles.panelContent}>
          {/* Top navigation buttons */}
          <div className={styles.panelNavButtons}>
            {effectiveProject ? (
              <Link
                to={`${getPortfolioSectionUrl(effectiveProject.category, lang)}${dirParam}`}
                className={styles.backBtn}
              >
                <span className={`${styles.circleIcon} ${styles.circleIconLarge}`}>
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
                    ? `Retour à ${content.sections[effectiveProject.category].title[lang]}`
                    : `Back to ${content.sections[effectiveProject.category].title[lang]}`}
                </span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleClosePanel}
                className={styles.backBtn}
              >
                <span className={`${styles.circleIcon} ${styles.circleIconLarge}`}>
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
              </button>
            )}

            {/* Deterministic Close Button */}
            <a
              ref={closeBtnRef}
              href={getPortfolioOverviewUrl(lang)}
              onClick={(e) => {
                e.preventDefault();
                handleClosePanel();
              }}
              className={styles.closeBtn}
              aria-label="Fermer le panneau"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 6 L6 18 M6 6 L18 18"
                  stroke="#F5F6F7"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>

          {effectiveProject ? (
            /* VIEW 1: Project Detail View */
            <div className={styles.detailContainer}>
              <div className={styles.detailCategory}>
                {content.sections[effectiveProject.category].title[lang]}
              </div>
              <h1 className={styles.detailTitle}>{effectiveProject.title[lang]}</h1>
              <p className={styles.detailSummary}>{effectiveProject.summary[lang]}</p>

              {effectiveProject.coverImageId && (
                <div className={styles.detailCoverWrap}>
                  <ResponsivePortfolioImage
                    imageId={effectiveProject.coverImageId}
                    ownerType="project"
                    ownerId={effectiveProject.id}
                    mediaSlot="cover"
                    mediaMetadata={content.media[effectiveProject.coverImageId]}
                    alt={effectiveProject.coverAlt[lang] || effectiveProject.title[lang]}
                    className={styles.detailCoverImg}
                    loading="eager"
                  />
                </div>
              )}

              {/* Typed Editorial Paragraphs */}
              <div className={styles.detailBody}>
                {effectiveProject.description.map((block, bIdx) => (
                  <p key={bIdx} className={styles.detailParagraph}>
                    {block.text[lang]}
                  </p>
                ))}
              </div>

              {/* Video Player Section */}
              {effectiveProject.video?.url && (
                <div className={styles.detailVideoSection}>
                  <div className={styles.showreelCard}>
                    {effectiveProject.video.coverImageId ? (
                      <ResponsivePortfolioImage
                        imageId={effectiveProject.video.coverImageId}
                        ownerType="project"
                        ownerId={effectiveProject.id}
                        mediaSlot="video_cover"
                        mediaMetadata={content.media[effectiveProject.video.coverImageId]}
                        alt={effectiveProject.title[lang]}
                      />
                    ) : effectiveProject.coverImageId ? (
                      <ResponsivePortfolioImage
                        imageId={effectiveProject.coverImageId}
                        ownerType="project"
                        ownerId={effectiveProject.id}
                        mediaSlot="cover"
                        mediaMetadata={content.media[effectiveProject.coverImageId]}
                        alt={effectiveProject.title[lang]}
                      />
                    ) : null}
                    <button
                      type="button"
                      className={styles.playBtn}
                      onClick={() => setActiveVideoUrl(effectiveProject.video!.url)}
                      aria-label="Lire la vidéo"
                    >
                      <svg width="26" height="28" viewBox="0 0 26 28" fill="none">
                        <path d="M4 3 L23 14 L4 25 Z" fill="#F5F6F7" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Gallery Photos */}
              {effectiveProject.galleryImageIds.length > 0 && (
                <div className={styles.detailGallerySection}>
                  <h3 className={styles.galleryTitle}>
                    {lang === "fr" ? "Galerie photos" : "Photo gallery"}
                  </h3>
                  <div className={styles.detailPhotoGrid}>
                    {effectiveProject.galleryImageIds.map((gid) => (
                      <div key={gid} className={styles.photoGridItem}>
                        <ResponsivePortfolioImage
                          imageId={gid}
                          ownerType="project"
                          ownerId={effectiveProject.id}
                          mediaSlot="gallery"
                          mediaMetadata={content.media[gid]}
                          alt={effectiveProject.title[lang]}
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
                className={`${styles.sectionHero} ${
                  activeSec.category === "documentary" && !activeSec.coverImageId
                    ? styles.sectionHeroDocu
                    : styles.sectionHeroPub
                }`}
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
                  to={`${getPortfolioSectionUrl("documentary", lang)}${dirParam}`}
                  className={`${styles.filterTab} ${
                    activeSec.category === "documentary" ? styles.filterTabActive : ""
                  }`}
                >
                  {content.sections.documentary.title[lang]}
                </Link>
                <Link
                  to={`${getPortfolioSectionUrl("advertising", lang)}${dirParam}`}
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
                        to={`${getPortfolioProjectUrl(p, lang)}${dirParam}`}
                        key={p.id}
                        className={styles.projectCardLink}
                      >
                        <div
                          className={`${styles.projectRow} ${
                            isEven ? styles.projectRowEven : styles.projectRowOdd
                          }`}
                        >
                          <div
                            className={isEven ? styles.projectBoxEven : styles.projectBoxOdd}
                          >
                            <div
                              className={`${styles.imageBox} ${
                                isEven ? styles.aspect32 : styles.aspect45
                              }`}
                            >
                              {p.coverImageId && (
                                <ResponsivePortfolioImage
                                  imageId={p.coverImageId}
                                  ownerType="project"
                                  ownerId={p.id}
                                  mediaSlot="cover"
                                  mediaMetadata={content.media[p.coverImageId]}
                                  alt={p.coverAlt[lang] || p.title[lang]}
                                />
                              )}
                            </div>
                          </div>

                          <div
                            className={isEven ? styles.projectTextEven : styles.projectTextOdd}
                          >
                            <div className={styles.projectInfoTitle}>
                              {p.title[lang]}
                            </div>
                            <p
                              className={`${styles.projectInfoDesc} ${
                                isEven ? styles.projectDescEven : styles.projectDescOdd
                              }`}
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
                      ? "Aucune réalisation publiée dans cette rubrique pour le moment."
                      : "No published projects in this category yet."}
                  </p>
                )}
              </div>

              {/* "Voir plus de photos" Masonry Gallery - only if gallery images exist! */}
              {categoryGalleryImages.length > 0 && (
                <>
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
                        className={`${styles.chevronIcon} ${
                          showGallery ? styles.chevronOpen : styles.chevronClosed
                        }`}
                        aria-hidden="true"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M6 9 L12 15 L18 9" />
                        </svg>
                      </span>
                    </button>
                  </div>

                  {showGallery && (
                    <div className={styles.masonryGrid}>
                      {categoryGalleryImages.map((imgItem, idx) => (
                        <div key={`${imgItem.imageId}-${idx}`} className={styles.masonryItem}>
                          <div className={styles.masonryThumb}>
                            <ResponsivePortfolioImage
                              imageId={imgItem.imageId}
                              ownerType="project"
                              ownerId={imgItem.projectId}
                              mediaSlot="gallery"
                              mediaMetadata={content.media[imgItem.imageId]}
                              alt={imgItem.alt}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Showreel Section - only if showreel video is configured! */}
              {activeSec.showreelVideo?.url && (
                <div className={styles.showreelSection}>
                  <div className={styles.showreelDivider}>
                    <h3 className={styles.showreelHeader}>
                      {activeSec.showreelTitle[lang]}
                    </h3>
                    <div className={`${styles.showreelCard} ${styles.showreelCardMargin}`}>
                      {activeSec.showreelCoverImageId && (
                        <ResponsivePortfolioImage
                          imageId={activeSec.showreelCoverImageId}
                          ownerType="section"
                          ownerId={activeSec.category}
                          mediaSlot="showreel_cover"
                          mediaMetadata={content.media[activeSec.showreelCoverImageId]}
                          alt={activeSec.showreelTitle[lang]}
                        />
                      )}
                      <button
                        type="button"
                        className={styles.playBtn}
                        onClick={() =>
                          setActiveVideoUrl(activeSec.showreelVideo!.url)
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
              )}
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
