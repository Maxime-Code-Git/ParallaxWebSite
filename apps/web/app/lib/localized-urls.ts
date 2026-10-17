import type {
  PortfolioProject,
  PortfolioCategory,
  PortfolioCategoryItem,
  PortfolioContent,
} from "./portfolio-content.shared";

function extractCategories(
  categoriesInput?: PortfolioCategoryItem[] | PortfolioContent | null
): PortfolioCategoryItem[] | undefined {
  if (!categoriesInput) return undefined;
  if (Array.isArray(categoriesInput)) return categoriesInput;
  if (Array.isArray(categoriesInput.categories)) return categoriesInput.categories;
  return undefined;
}

export function getPortfolioOverviewUrl(lang: "fr" | "en"): string {
  return lang === "fr" ? "/fr/projets" : "/en/projects";
}

export function getPortfolioSectionUrl(
  category: PortfolioCategoryItem | PortfolioCategory,
  lang: "fr" | "en",
  categoriesInput?: PortfolioCategoryItem[] | PortfolioContent | null
): string {
  if (typeof category === "object" && category !== null) {
    const slug = lang === "fr" ? category.slugFr : category.slugEn;
    return lang === "fr" ? `/fr/projets/${slug}` : `/en/projects/${slug}`;
  }

  const categoryId = String(category || "");
  const categories = extractCategories(categoriesInput);

  if (categories) {
    const found = categories.find((c) => c.id === categoryId);
    if (found) {
      const slug = lang === "fr" ? found.slugFr : found.slugEn;
      return lang === "fr" ? `/fr/projets/${slug}` : `/en/projects/${slug}`;
    }
  }

  // Fallback for historical categories if no category object or array is passed
  if (categoryId === "documentary") {
    return lang === "fr" ? "/fr/projets/documentaire" : "/en/projects/documentary";
  }
  if (categoryId === "advertising") {
    return lang === "fr" ? "/fr/projets/publicite" : "/en/projects/advertising";
  }

  return lang === "fr" ? `/fr/projets/${categoryId}` : `/en/projects/${categoryId}`;
}

export function getPortfolioProjectUrl(
  project: PortfolioProject,
  lang: "fr" | "en",
  categoriesInput?: PortfolioCategoryItem[] | PortfolioContent | null
): string {
  const categories = extractCategories(categoriesInput);
  let catSlug: string;

  if (categories) {
    const found = categories.find((c) => c.id === project.category);
    if (found) {
      catSlug = lang === "fr" ? found.slugFr : found.slugEn;
    } else if (project.category === "documentary") {
      catSlug = lang === "fr" ? "documentaire" : "documentary";
    } else if (project.category === "advertising") {
      catSlug = lang === "fr" ? "publicite" : "advertising";
    } else {
      catSlug = project.category;
    }
  } else if (project.category === "documentary") {
    catSlug = lang === "fr" ? "documentaire" : "documentary";
  } else if (project.category === "advertising") {
    catSlug = lang === "fr" ? "publicite" : "advertising";
  } else {
    catSlug = project.category;
  }

  if (lang === "fr") {
    return `/fr/projets/${catSlug}/${project.slugFr}`;
  }
  return `/en/projects/${catSlug}/${project.slugEn}`;
}

export function getPortfolioAlternateUrls(
  project?: PortfolioProject | null,
  category?: PortfolioCategoryItem | PortfolioCategory | null,
  direction?: "left" | "right" | null,
  categoriesInput?: PortfolioCategoryItem[] | PortfolioContent | null
): { fr: string; en: string } {
  const dirSuffix = direction ? `?dir=${direction}` : "";
  if (project) {
    return {
      fr: `${getPortfolioProjectUrl(project, "fr", categoriesInput)}${dirSuffix}`,
      en: `${getPortfolioProjectUrl(project, "en", categoriesInput)}${dirSuffix}`,
    };
  }
  if (category) {
    return {
      fr: `${getPortfolioSectionUrl(category, "fr", categoriesInput)}${dirSuffix}`,
      en: `${getPortfolioSectionUrl(category, "en", categoriesInput)}${dirSuffix}`,
    };
  }
  return {
    fr: getPortfolioOverviewUrl("fr"),
    en: getPortfolioOverviewUrl("en"),
  };
}
