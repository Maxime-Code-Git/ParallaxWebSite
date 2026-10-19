import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getSiteContent } from "../../lib/site-content.server";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { ScrollToTop } from "../../components/public/ScrollToTop";
import { VideoModal } from "../../components/public/VideoModal";
import { ResponsiveSiteImage } from "../../components/public/ResponsiveSiteImage";
import {
  resolveSempraButtonUrl,
  cleanCommonContent,
  cleanHomeContent,
  cleanTypography,
} from "../../lib/site-content.shared";
import styles from "./home.module.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const isEn = url.pathname.startsWith("/en");
  const lang: "fr" | "en" = isEn ? "en" : "fr";

  const siteContent = getSiteContent();

  return {
    lang,
    common: cleanCommonContent(siteContent.common),
    home: cleanHomeContent(siteContent.home),
    media: siteContent.media || {},
  };
}

export function meta({ data }: { data?: Awaited<ReturnType<typeof loader>> }) {
  if (!data) {
    return [{ title: "Parallax" }];
  }
  const { home, lang } = data;
  return [
    { title: cleanTypography(home.seo.title[lang]) },
    { name: "description", content: cleanTypography(home.seo.description[lang]) },
  ];
}

export default function HomePage() {
  const { lang, common, home, media } = useLoaderData<typeof loader>();
  const [showreelOpen, setShowreelOpen] = useState(false);

  return (
    <div className={styles.container}>
      <Header common={common} lang={lang} currentRoute="home" />

      {/* Hero Section */}
      <section className={styles.heroSection}>
        <div className={styles.heroBadge}>{home.hero.badge[lang]}</div>
        <h1 className={styles.heroTitle}>{home.hero.title[lang]}</h1>
        <p className={styles.heroSubtitle}>{home.hero.subtitle[lang]}</p>
      </section>

      {/* Showreel Section */}
      <section className={styles.showreelSection}>
        <div
          className={styles.showreelCard}
          role="region"
          aria-label={home.showreel.coverImageAlt[lang]}
        >
          <ResponsiveSiteImage
            imageId={home.showreel.coverImageId}
            location="showreel_cover"
            mediaMetadata={media[home.showreel.coverImageId]}
            fallbackSrc="/img/index-36b7cd6c87.jpg"
            alt={home.showreel.coverImageAlt[lang]}
            className={styles.showreelCoverImg}
            sizes="(max-width: 768px) 100vw, 1440px"
            loading="lazy"
          />
          <div className={styles.showreelOverlay} />
          <button
            type="button"
            className={styles.playButton}
            onClick={() => setShowreelOpen(true)}
            aria-label="Lire le showreel"
          >
            <svg
              className={styles.playIcon}
              viewBox="0 0 26 28"
              fill="none"
              aria-hidden="true"
            >
              <path d="M4 3 L23 14 L4 25 Z" fill="#F5F6F7" />
            </svg>
          </button>
          <div className={styles.showreelLabel}>{home.showreel.title[lang]}</div>
        </div>
      </section>

      {/* Duo Maxime & Ludovic */}
      <section className={styles.duoSection}>
        <div className={styles.duoGrid}>
          <div className={styles.duoImageWrapper}>
            <ResponsiveSiteImage
              imageId={home.duo.imageId}
              location="duo"
              mediaMetadata={media[home.duo.imageId]}
              fallbackSrc="/img/index-0ff090a6e4.jpg"
              alt={home.duo.imageAlt[lang]}
              className={styles.duoImage}
              sizes="(max-width: 768px) 100vw, 800px"
              loading="lazy"
            />
          </div>
          <div className={styles.duoContent}>
            <h2 className={styles.duoTitle}>{home.duo.title[lang]}</h2>
            <p className={styles.duoText}>{home.duo.text[lang]}</p>
          </div>
        </div>
      </section>

      {/* Savoir-faire Section */}
      <section className={styles.savoirFaireSection}>
        <h2 className={styles.sectionHeader}>{home.savoirFaire.title[lang]}</h2>
        <div className={styles.savoirFaireGrid}>
          <div>
            <div className={styles.categoryTitle}>{home.savoirFaire.photoTitle[lang]}</div>
            {home.savoirFaire.photoItems?.filter((item) => item && typeof item[lang] === "string" && item[lang].trim()).length > 0 && (
              <ul className={styles.categoryList}>
                {home.savoirFaire.photoItems
                  .filter((item) => item && typeof item[lang] === "string" && item[lang].trim())
                  .map((item, idx) => (
                    <li key={idx}>{item[lang].trim()}</li>
                  ))}
              </ul>
            )}
          </div>
          <div>
            <div className={styles.categoryTitle}>{home.savoirFaire.videoTitle[lang]}</div>
            {home.savoirFaire.videoItems?.filter((item) => item && typeof item[lang] === "string" && item[lang].trim()).length > 0 && (
              <ul className={styles.categoryList}>
                {home.savoirFaire.videoItems
                  .filter((item) => item && typeof item[lang] === "string" && item[lang].trim())
                  .map((item, idx) => (
                    <li key={idx}>{item[lang].trim()}</li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className={styles.contactSection}>
        <h2 className={styles.contactTitle}>{home.contact.title[lang]}</h2>
        <div className={styles.contactItems}>
          <div>
            <div className={styles.contactBlockLabel}>{home.contact.emailLabel[lang]}</div>
            {home.contact.email ? (
              <a href={`mailto:${home.contact.email}`} className={styles.contactEmailLink}>
                {home.contact.email}
              </a>
            ) : (
              <span className={styles.contactDivider}>
                {lang === "fr" ? "À renseigner dans l'administration" : "To be configured in admin"}
              </span>
            )}
          </div>
          <div>
            <div className={styles.contactBlockLabel}>{home.contact.socialLabel[lang]}</div>
            <a
              href={home.contact.instagramUrl || "https://instagram.com"}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.contactSocialLink}
            >
              Instagram
            </a>
            <span className={styles.contactDivider}> · </span>
            <a
              href={home.contact.youtubeUrl || "https://youtube.com"}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.contactSocialLink}
            >
              YouTube
            </a>
          </div>
        </div>
      </section>

      {/* Transition gradient to SEMPRA */}
      <div className={styles.transitionGradient} />

      {/* SEMPRA Section */}
      <section id="sempra" className={styles.sempraSection}>
        <div className={styles.sempraBadge}>{home.sempra.badge[lang]}</div>
        <img
          src="/img/img-73c121e112.png"
          alt="SEMPRA - studio photo & vidéo de mariage"
          className={styles.sempraLogo}
        />
        <p className={styles.sempraTitle}>{home.sempra.title[lang]}</p>
        <a href={resolveSempraButtonUrl(home.sempra.buttonUrl)} rel="noopener noreferrer" className={styles.sempraButton}>
          <span>{home.sempra.buttonText[lang]}</span>
          <span className={styles.sempraButtonIcon}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FBF6F0"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12 H19" />
              <path d="M13 6 L19 12 L13 18" />
            </svg>
          </span>
        </a>
      </section>

      {/* Footer matching SEMPRA styling */}
      <Footer common={common} lang={lang} theme="sempra" />

      {/* Floating scroll to top button */}
      <ScrollToTop checkSempra={true} />

      {/* Showreel video modal with explicit consent */}
      <VideoModal
        isOpen={showreelOpen}
        onClose={() => setShowreelOpen(false)}
        videoUrl={home.showreel.videoUrl}
        lang={lang}
      />
    </div>
  );
}
