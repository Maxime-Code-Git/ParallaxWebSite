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
import { ScrollToTop } from "../../components/public/ScrollToTop";
import { VideoModal } from "../../components/public/VideoModal";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import {
  type PortfolioContent,
  type PortfolioProject,
  type PortfolioCategory,
  resolveProjectPresentationMode,
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
    const sec =
      content.categories?.find((c) => c.id === panelState.activeCategory) ||
      content.sections?.[panelState.activeCategory];
    if (sec) {
      pageTitle = sec.seo.title[lang] || `${sec.title[lang]} — Parallax`;
      pageDesc = sec.seo.description[lang] || sec.intro[lang];
    }
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

  const { content, publicProjects, publicCategories } = getPublicPortfolioContent();
  const common = getSiteContent().common;

  // Use route params: client navigations keep the .data suffix in request.url.
  let activeCategory: PortfolioCategory | null = null;
  let activeCategoryItem: (typeof publicCategories)[number] | null = null;
  let activeProject: PortfolioProject | null = null;

  if (params.rubrique || params.category) {
    const raw = (params.rubrique || params.category || "").toLowerCase();

    // 1. Match active published category by slug
    const found = publicCategories.find((c) =>
      lang === "fr" ? c.slugFr.toLowerCase() === raw : c.slugEn.toLowerCase() === raw
    );

    // 2. If not found, check alias redirect
    if (!found) {
      const aliasMatch = publicCategories.find((c) => {
        const aliases = lang === "fr" ? c.slugAliases?.fr : c.slugAliases?.en;
        return Array.isArray(aliases) && aliases.some((a) => a.toLowerCase() === raw);
      });

      if (aliasMatch) {
        const canonicalSlug = lang === "fr" ? aliasMatch.slugFr : aliasMatch.slugEn;
        const projectSlug = lang === "fr" ? params.slugFr : params.slugEn;
        const dirQuery = url.searchParams.get("dir") ? `?dir=${url.searchParams.get("dir")}` : "";
        const targetUrl = projectSlug
          ? (lang === "fr"
              ? `/fr/projets/${canonicalSlug}/${projectSlug}${dirQuery}`
              : `/en/projects/${canonicalSlug}/${projectSlug}${dirQuery}`)
          : (lang === "fr"
              ? `/fr/projets/${canonicalSlug}${dirQuery}`
              : `/en/projects/${canonicalSlug}${dirQuery}`);
        return new Response(null, {
          status: 301,
          headers: { Location: targetUrl },
        });
      }

      throw new Response(lang === "fr" ? "Rubrique introuvable" : "Category not found", { status: 404 });
    }

    activeCategory = found.id;
    activeCategoryItem = found;

    const slug = lang === "fr" ? params.slugFr : params.slugEn;
    if (slug) {
      const foundProject = publicProjects.find(
        (p) => (lang === "fr" ? p.slugFr === slug : p.slugEn === slug) && p.category === found.id
      );
      if (!foundProject) {
        throw new Response(lang === "fr" ? "Projet introuvable" : "Project not found", { status: 404 });
      }
      activeProject = foundProject;
    }
  }

  // Direction: read query parameter 'dir' or infer from category default
  let direction: "left" | "right" = "right";
  const queryDir = url.searchParams.get("dir");
  if (queryDir === "left" || queryDir === "right") {
    direction = queryDir;
  } else if (activeCategoryItem) {
    const catIndex = publicCategories.findIndex((c) => c.id === activeCategoryItem.id);
    const effectiveSide =
      activeCategoryItem.entrySide === "left" || activeCategoryItem.entrySide === "right"
        ? activeCategoryItem.entrySide
        : catIndex % 2 === 0
        ? "left"
        : "right";
    direction = effectiveSide === "left" ? "right" : "left";
  }

  const isOpen = activeCategory !== null;

  // Build showcase projects (featured or top 3)
  const showcaseProjects = publicProjects.filter((p) => p.showcase);

  const alternateUrls = getPortfolioAlternateUrls(activeProject, activeCategoryItem || activeCategory, direction, publicCategories);

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
  const { lang, common, content, panelState, alternateUrls } =
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
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setIsReducedMotion(Boolean(mq?.matches));
      const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
      mq.addEventListener?.("change", handler);
      return () => mq.removeEventListener?.("change", handler);
    } catch {
      // safe fallback
    }
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
      navigate(getPortfolioOverviewUrl(lang), { replace: false, preventScrollReset: true });
    }, delay);
  }

  // Active or cached category/project for panel display
  const effectiveCategory = panelState.isOpen
    ? panelState.activeCategory
    : cachedContentRef.current.activeCategory;
  const effectiveProject = panelState.isOpen
    ? panelState.activeProject
    : cachedContentRef.current.activeProject;
  const effectiveProjectPresentationMode = effectiveProject
    ? resolveProjectPresentationMode(effectiveProject)
    : "photo";

  const activeSec = effectiveCategory
    ? (content.categories?.find((c) => c.id === effectiveCategory) || content.sections?.[effectiveCategory])
    : null;

  // Category Entries for Portfolio Overview: all published categories in their administered order
  const categoriesList = content.categories || [];
  const rowsToRender = categoriesList.map((sec, idx) => {
    const defaultSide = idx % 2 === 0 ? "left" : "right";
    const effectiveSide = sec.entrySide && sec.entrySide !== "auto" ? sec.entrySide : defaultSide;
    const openDirection = effectiveSide === "left" ? ("right" as const) : ("left" as const);
    const imageId = sec.entryImageId || sec.coverImageId;
    const isEntrySlot = Boolean(sec.entryImageId);
    const alt = sec.entryAlt?.[lang] || sec.coverAlt?.[lang] || sec.title[lang];
    const summary = sec.entrySummary?.[lang] || sec.intro[lang];

    return {
      category: sec.id,
      categoryTitle: sec.title[lang],
      summary,
      imageId,
      isEntrySlot,
      alt,
      side: effectiveSide,
      openDirection,
      sectionUrl: `${getPortfolioSectionUrl(sec, lang, categoriesList)}?dir=${openDirection}`,
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
      <div
        className={styles.overviewPage}
        data-portfolio-overview=""
        data-direction={panelDirection}
        data-state={phase}
      >
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
                        preventScrollReset
                        className={styles.imageLink}
                        onClick={(e) => {
                          triggerRef.current = e.currentTarget;
                        }}
                        aria-label={`Ouvrir la rubrique ${row.categoryTitle}`}
                      >
                        <div className={`${styles.imageWrapper} ${styles.imageWrapperDiagonalLeft}`}>
                          {row.imageId && (
                            <ResponsivePortfolioImage
                              imageId={row.imageId}
                              ownerType="section"
                              ownerId={row.category}
                              mediaSlot={row.isEntrySlot ? "category_entry" : "cover"}
                              mediaMetadata={content.media[row.imageId]}
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
                          preventScrollReset
                          className={`${styles.seeMoreBtn} ${styles.seeMoreBtnLeft}`}
                          onClick={(e) => {
                            triggerRef.current = e.currentTarget;
                          }}
                          aria-label={`${lang === "fr" ? "Voir les projets" : "View projects"} - ${row.categoryTitle}`}
                        >
                          <span className={styles.btnLabelDesktop}>
                            {content.overview.seeMoreButton[lang]}
                          </span>
                          <span className={styles.btnLabelMobile}>
                            {lang === "fr" ? "Voir les projets" : "View projects"}
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
                          preventScrollReset
                          className={`${styles.seeMoreBtn} ${styles.seeMoreBtnRight}`}
                          onClick={(e) => {
                            triggerRef.current = e.currentTarget;
                          }}
                          aria-label={`${lang === "fr" ? "Voir les projets" : "View projects"} - ${row.categoryTitle}`}
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
                          <span className={styles.btnLabelDesktop}>
                            {content.overview.seeMoreButton[lang]}
                          </span>
                          <span className={styles.btnLabelMobile}>
                            {lang === "fr" ? "Voir les projets" : "View projects"}
                          </span>
                        </Link>
                      </div>
                    </div>

                    {/* Right: Image block */}
                    <div className={styles.imageCol}>
                      <Link
                        to={row.sectionUrl}
                        preventScrollReset
                        className={styles.imageLink}
                        onClick={(e) => {
                          triggerRef.current = e.currentTarget;
                        }}
                        aria-label={`Ouvrir la rubrique ${row.categoryTitle}`}
                      >
                        <div className={`${styles.imageWrapper} ${styles.imageWrapperDiagonalRight}`}>
                          {row.imageId && (
                            <ResponsivePortfolioImage
                              imageId={row.imageId}
                              ownerType="section"
                              ownerId={row.category}
                              mediaSlot={row.isEntrySlot ? "category_entry" : "cover"}
                              mediaMetadata={content.media[row.imageId]}
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
                to={`${getPortfolioSectionUrl(effectiveProject.category, lang, content.categories)}${dirParam}`}
                preventScrollReset
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
                  {(() => {
                    const cat =
                      content.categories?.find((c) => c.id === effectiveProject.category) ||
                      content.sections?.[effectiveProject.category];
                    const catTitle = cat?.title[lang] || "";
                    return lang === "fr" ? `Retour à ${catTitle}` : `Back to ${catTitle}`;
                  })()}
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
                {(content.categories?.find((c) => c.id === effectiveProject.category) ||
                  content.sections?.[effectiveProject.category])?.title[lang] || ""}
              </div>
              <h1 className={styles.detailTitle}>{effectiveProject.title[lang]}</h1>
              <p className={styles.detailSummary}>{effectiveProject.summary[lang]}</p>

              {/* Hero Media according to Presentation Mode */}
              {effectiveProjectPresentationMode === "video" && effectiveProject.video?.url ? (
                <div className={styles.detailCoverWrap}>
                  <div className={styles.showreelCard}>
                    {effectiveProject.video.coverImageId ? (
                      <ResponsivePortfolioImage
                        imageId={effectiveProject.video.coverImageId}
                        ownerType="project"
                        ownerId={effectiveProject.id}
                        mediaSlot="video_cover"
                        mediaMetadata={content.media[effectiveProject.video.coverImageId]}
                        alt={effectiveProject.title[lang]}
                        className={styles.showreelImg}
                        loading="eager"
                      />
                    ) : effectiveProject.coverImageId ? (
                      <ResponsivePortfolioImage
                        imageId={effectiveProject.coverImageId}
                        ownerType="project"
                        ownerId={effectiveProject.id}
                        mediaSlot="cover"
                        mediaMetadata={content.media[effectiveProject.coverImageId]}
                        alt={effectiveProject.title[lang]}
                        className={styles.showreelImg}
                        loading="eager"
                      />
                    ) : null}
                    <div className={styles.showreelOverlay}>
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
                </div>
              ) : effectiveProject.coverImageId ? (
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
              ) : null}

              {/* Typed Editorial Paragraphs */}
              <div className={styles.detailBody}>
                {effectiveProject.description.map((block, bIdx) => (
                  <p key={bIdx} className={styles.detailParagraph}>
                    {block.text[lang]}
                  </p>
                ))}
              </div>

              {/* Video Player Section (for photo projects that include a secondary video) */}
              {effectiveProjectPresentationMode === "photo" && effectiveProject.video?.url && (
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
                        className={styles.showreelImg}
                      />
                    ) : effectiveProject.coverImageId ? (
                      <ResponsivePortfolioImage
                        imageId={effectiveProject.coverImageId}
                        ownerType="project"
                        ownerId={effectiveProject.id}
                        mediaSlot="cover"
                        mediaMetadata={content.media[effectiveProject.coverImageId]}
                        alt={effectiveProject.title[lang]}
                        className={styles.showreelImg}
                      />
                    ) : null}
                    <div className={styles.showreelOverlay}>
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
                  !activeSec.bannerImageId && !activeSec.coverImageId
                    ? ((activeSec.order ?? 0) % 2 === 0 ? styles.sectionHeroDocu : styles.sectionHeroPub)
                    : ""
                }`}
              >
                {(activeSec.bannerImageId || activeSec.coverImageId) && (
                  <ResponsivePortfolioImage
                    imageId={activeSec.bannerImageId || activeSec.coverImageId!}
                    ownerType="section"
                    ownerId={activeSec.id}
                    mediaSlot={activeSec.bannerImageId ? "category_banner" : "cover"}
                    mediaMetadata={content.media[activeSec.bannerImageId || activeSec.coverImageId!]}
                    alt={activeSec.bannerAlt?.[lang] || activeSec.coverAlt?.[lang] || activeSec.title[lang]}
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

              {/* Projects in this section */}
              <div className={styles.projectsList}>
                {categoryProjects.length > 0 ? (
                  categoryProjects.map((p, pIdx) => {
                    const isVideoMode = resolveProjectPresentationMode(p) === "video";
                    const isEven = pIdx % 2 === 0;

                    if (isVideoMode && p.video?.url) {
                      // VIDEO PRESENTATION MODE (16:9 centered card with play button, separate meta below)
                      const posterImageId =
                        p.video.coverImageId || p.draftVideoCoverImageId || p.coverImageId;

                      return (
                        <div key={p.id} className={styles.videoProjectRow}>
                          <div className={styles.videoCardWrapper}>
                            <div className={styles.videoCard169}>
                              {posterImageId ? (
                                <ResponsivePortfolioImage
                                  imageId={posterImageId}
                                  ownerType="project"
                                  ownerId={p.id}
                                  mediaSlot={p.video.coverImageId ? "video_cover" : "cover"}
                                  mediaMetadata={content.media[posterImageId]}
                                  alt={p.coverAlt[lang] || p.title[lang]}
                                  className={styles.videoPosterImg}
                                />
                              ) : (
                                <div className={styles.videoPosterPlaceholder} />
                              )}
                              <div className={styles.videoOverlay}>
                                <button
                                  type="button"
                                  className={styles.videoPlayBtn}
                                  onClick={() => setActiveVideoUrl(p.video!.url)}
                                  aria-label={`Lire la vidéo : ${p.title[lang]}`}
                                >
                                  <svg width="22" height="24" viewBox="0 0 26 28" fill="none">
                                    <path d="M4 3 L23 14 L4 25 Z" fill="#F5F6F7" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className={styles.videoProjectMeta}>
                            <Link
                              to={`${getPortfolioProjectUrl(p, lang, content.categories)}${dirParam}`}
                              preventScrollReset
                              className={styles.videoProjectTitleLink}
                            >
                              <h3 className={styles.projectInfoTitle}>{p.title[lang]}</h3>
                            </Link>
                            <p className={styles.projectVideoDesc}>{p.summary[lang]}</p>
                          </div>
                        </div>
                      );
                    }

                    // PHOTO PRESENTATION MODE (Alternating sides, customizable aspect ratio, text alongside)
                    const isLeft = p.side === "left" || (p.side === "auto" && isEven);
                    const isPortrait = p.aspectRatio === "4:5";
                    const isSquare = p.aspectRatio === "1:1";
                    const photoBoxClass = isPortrait
                      ? styles.photoBoxPortrait
                      : isSquare
                      ? styles.photoBoxSquare
                      : styles.photoBoxLandscape;
                    const ratioClass =
                      p.aspectRatio === "4:5"
                        ? styles.aspect45
                        : p.aspectRatio === "1:1"
                        ? styles.aspect11
                        : p.aspectRatio === "16:9"
                        ? styles.aspect169
                        : styles.aspect32;

                    return (
                      <div
                        key={p.id}
                        className={`${styles.projectRow} ${
                          isLeft ? styles.projectRowEven : styles.projectRowOdd
                        }`}
                      >
                        <div className={photoBoxClass}>
                          <Link
                            to={`${getPortfolioProjectUrl(p, lang, content.categories)}${dirParam}`}
                            preventScrollReset
                            className={styles.projectImageLink}
                            aria-label={`Voir le projet ${p.title[lang]}`}
                          >
                            <div className={`${styles.imageBox} ${ratioClass}`}>
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
                          </Link>
                        </div>

                        <div className={isLeft ? styles.projectTextEven : styles.projectTextOdd}>
                          <Link
                            to={`${getPortfolioProjectUrl(p, lang, content.categories)}${dirParam}`}
                            preventScrollReset
                            className={styles.projectTitleLink}
                          >
                            <h3 className={styles.projectInfoTitle}>{p.title[lang]}</h3>
                          </Link>
                          <p
                            className={`${styles.projectInfoDesc} ${
                              isLeft ? styles.projectDescEven : styles.projectDescOdd
                            }`}
                          >
                            {p.summary[lang]}
                          </p>
                        </div>
                      </div>
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
                          ownerId={activeSec.id}
                          mediaSlot="showreel_cover"
                          mediaMetadata={content.media[activeSec.showreelCoverImageId]}
                          alt={activeSec.showreelTitle[lang]}
                          className={styles.showreelImg}
                        />
                      )}
                      <div className={styles.showreelOverlay}>
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
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Single, non-transformed ScrollToTop controller */}
      <ScrollToTop
        key={phase === "open" ? `panel-${location.pathname}` : "overview"}
        targetRef={phase === "open" ? panelRef : undefined}
        hidden={phase === "opening" || phase === "closing" || Boolean(activeVideoUrl)}
        className={styles.portfolioScrollToTop}
      />

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
