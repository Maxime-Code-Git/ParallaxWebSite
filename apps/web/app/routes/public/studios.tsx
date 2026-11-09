import type { MetaFunction, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getRawSiteContent, cleanStudiosContent } from "../../lib/site-content.server";
import type {
  StudiosFraming,
  MediaVariantInfo,
} from "../../lib/site-content.shared";
import styles from "./studios.module.css";

export const SEMPRA_URL = "https://sempra.be/fr/";
export const PARALLAX_URL = "https://parallax-creative-studio.com/fr";

export interface StudiosPanelData {
  imageId: string | null;
  framing: StudiosFraming;
  variants?: MediaVariantInfo[];
}

export interface StudiosLoaderData {
  sempra: StudiosPanelData;
  parallax: StudiosPanelData;
}

export const meta: MetaFunction = () => {
  return [
    { title: "StudioLM | SEMPRA & Parallax" },
    {
      name: "description",
      content:
        "Portail StudioLM : découvrez SEMPRA (mariage) et Parallax (studio photo et création vidéo).",
    },
    { name: "robots", content: "noindex, nofollow" },
    { name: "googlebot", content: "noindex, nofollow" },
  ];
};

export const headers: HeadersFunction = () => {
  return {
    "X-Robots-Tag": "noindex, nofollow",
  };
};

export async function loader() {
  const { content } = getRawSiteContent();
  const studios = cleanStudiosContent(content?.studios);

  const getPanelData = (
    imageId: string | null,
    framing: StudiosFraming
  ): StudiosPanelData => {
    if (!imageId) {
      return { imageId: null, framing };
    }
    const metaRecord = content?.media?.[imageId];
    return {
      imageId,
      framing,
      variants: metaRecord?.variants,
    };
  };

  return Response.json(
    {
      sempra: getPanelData(studios.sempra.imageId, studios.sempra.framing),
      parallax: getPanelData(studios.parallax.imageId, studios.parallax.framing),
    },
    {
      headers: {
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    }
  );
}

export default function StudiosGateway() {
  let loaderData: StudiosLoaderData | undefined;
  try {
    loaderData = useLoaderData<StudiosLoaderData>();
  } catch {
    // Fallback when rendered without React Router data router in tests
  }

  const sempra = loaderData?.sempra ?? { imageId: null, framing: "center" };
  const parallax = loaderData?.parallax ?? { imageId: null, framing: "center" };

  const getFramingClass = (framing: StudiosFraming) => {
    if (framing === "top") return styles.framingTop;
    if (framing === "bottom") return styles.framingBottom;
    return styles.framingCenter;
  };

  return (
    <main className={styles.gatewayPage}>
      {/* Two destination panels */}
      <div className={styles.panelsContainer}>
        {/* Parallax Panel */}
        <a
          href={PARALLAX_URL}
          className={styles.panelParallax}
          aria-label="Parallax | Photographie et création vidéo"
        >
          {parallax.imageId && (
            <img
              src={`/media/site/studios_parallax/${parallax.imageId}/1440p/webp`}
              srcSet={
                parallax.variants && parallax.variants.length > 0
                  ? parallax.variants
                      .map(
                        (v) =>
                          `/media/site/studios_parallax/${parallax.imageId}/${v.name}/webp ${v.width}w`
                      )
                      .join(", ")
                  : undefined
              }
              sizes="(max-width: 900px) 100vw, 50vw"
              alt=""
              aria-hidden="true"
              className={`${styles.bgImage} ${getFramingClass(parallax.framing)}`}
              loading="eager"
              decoding="async"
            />
          )}
          <div className={styles.parallaxOverlay} aria-hidden="true" />

          <div className={styles.panelContent}>
            <div className={styles.parallaxLogoWrap}>
              <img
                src="/img/logo-parallax.png"
                alt=""
                aria-hidden="true"
                className={styles.parallaxLogo}
                width="64"
                height="67"
              />
              <span className={styles.parallaxBrandName}>Parallax</span>
            </div>
            <p className={styles.parallaxText}>Photographie et création vidéo</p>
            <span className={styles.parallaxButton}>
              <span className={styles.buttonLabel}>Découvrir Parallax</span>
              <span className={styles.parallaxButtonIcon} aria-hidden="true">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </span>
          </div>
        </a>
        {/* Visual junction divider between the two universes */}
        <div className={styles.junctionDivider} aria-hidden="true" />

        {/* SEMPRA Panel */}
        <a
          href={SEMPRA_URL}
          className={styles.panelSempra}
          aria-label="SEMPRA | Photographie et vidéo de mariage"
        >
          {sempra.imageId && (
            <img
              src={`/media/site/studios_sempra/${sempra.imageId}/1440p/webp`}
              srcSet={
                sempra.variants && sempra.variants.length > 0
                  ? sempra.variants
                      .map(
                        (v) =>
                          `/media/site/studios_sempra/${sempra.imageId}/${v.name}/webp ${v.width}w`
                      )
                      .join(", ")
                  : undefined
              }
              sizes="(max-width: 900px) 100vw, 50vw"
              alt=""
              aria-hidden="true"
              className={`${styles.bgImage} ${getFramingClass(sempra.framing)}`}
              loading="eager"
              decoding="async"
            />
          )}
          <div className={styles.sempraOverlay} aria-hidden="true" />

          <div className={styles.panelContent}>
            <div className={styles.sempraLogoWrap}>
              <img
                src="/img/img-73c121e112.png"
                alt="SEMPRA"
                className={styles.sempraLogo}
                width="280"
                height="89"
              />
            </div>
            <p className={styles.sempraText}>Photographie et vidéo de mariage</p>
            <span className={styles.sempraButton}>
              <span className={styles.buttonLabel}>Découvrir SEMPRA</span>
              <span className={styles.sempraButtonIcon} aria-hidden="true">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </span>
          </div>
        </a>

      </div>

      {/* StudioLM identity below both destinations */}
      <div className={styles.studioLmIdentity}>
        <div className={styles.studioLmBrand}>
          <img
            src="/img/logo-studiolm.png"
            alt=""
            aria-hidden="true"
            className={styles.studioLmLogo}
            width="64"
            height="68"
          />
          <h1 className={styles.studioLmTitle}>StudioLM</h1>
        </div>
      </div>

    </main>
  );
}
