import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getSiteContent } from "../../lib/site-content.server";
import { resolveAllowedImage } from "../../lib/site-content.shared";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { ScrollToTop } from "../../components/public/ScrollToTop";
import styles from "./studio.module.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const isEn = url.pathname.startsWith("/en");
  const lang: "fr" | "en" = isEn ? "en" : "fr";

  const siteContent = getSiteContent();

  return {
    lang,
    common: siteContent.common,
    studio: siteContent.studio,
  };
}

export function meta({ data }: { data?: Awaited<ReturnType<typeof loader>> }) {
  if (!data) {
    return [{ title: "Parallax - Studio" }];
  }
  const { studio, lang } = data;
  return [
    { title: studio.seo.title[lang] },
    { name: "description", content: studio.seo.description[lang] },
  ];
}

export default function StudioPage() {
  const { lang, common, studio } = useLoaderData<typeof loader>();

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
            const memberImageUrl =
              resolveAllowedImage(member.imageId) ||
              (member.id === "ludovic" ? "/img/studio-d0f3184629.jpg" : "/img/studio-b4c530c5ae.jpg");

            return (
              <article key={member.id} className={styles.memberCard}>
                <div className={styles.memberImageWrapper}>
                  {memberImageUrl && (
                    <img
                      src={memberImageUrl}
                      alt={member.imageAlt[lang]}
                      className={styles.memberImage}
                      loading="lazy"
                    />
                  )}
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
      <ScrollToTop />
    </div>
  );
}
