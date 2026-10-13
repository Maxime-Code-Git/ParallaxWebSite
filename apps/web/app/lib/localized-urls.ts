import type { PortfolioProject, PortfolioCategory } from "./portfolio-content.shared";

export function getPortfolioOverviewUrl(lang: "fr" | "en"): string {
  return lang === "fr" ? "/fr/projets" : "/en/projects";
}

export function getPortfolioSectionUrl(category: PortfolioCategory, lang: "fr" | "en"): string {
  if (lang === "fr") {
    return category === "documentary" ? "/fr/projets/documentaire" : "/fr/projets/publicite";
  }
  return category === "documentary" ? "/en/projects/documentary" : "/en/projects/advertising";
}

export function getPortfolioProjectUrl(project: PortfolioProject, lang: "fr" | "en"): string {
  if (lang === "fr") {
    const cat = project.category === "documentary" ? "documentaire" : "publicite";
    return `/fr/projets/${cat}/${project.slugFr}`;
  }
  const cat = project.category === "documentary" ? "documentary" : "advertising";
  return `/en/projects/${cat}/${project.slugEn}`;
}

export function getPortfolioAlternateUrls(
  project?: PortfolioProject | null,
  category?: PortfolioCategory | null
): { fr: string; en: string } {
  if (project) {
    return {
      fr: getPortfolioProjectUrl(project, "fr"),
      en: getPortfolioProjectUrl(project, "en"),
    };
  }
  if (category) {
    return {
      fr: getPortfolioSectionUrl(category, "fr"),
      en: getPortfolioSectionUrl(category, "en"),
    };
  }
  return {
    fr: getPortfolioOverviewUrl("fr"),
    en: getPortfolioOverviewUrl("en"),
  };
}
