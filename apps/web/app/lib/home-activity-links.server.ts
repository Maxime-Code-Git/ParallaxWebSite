import type { HomeActivity, HomeActivityDestination } from "./site-content.shared";
import { getPublicPortfolioContent } from "./portfolio-content.server";
import {
  getPortfolioOverviewUrl,
  getPortfolioProjectUrl,
  getPortfolioSectionUrl,
} from "./localized-urls";

export function getHomePortfolioDestinations() {
  try {
    const { content, publicCategories, publicProjects } = getPublicPortfolioContent();
    return {
      categories: publicCategories,
      projects: publicProjects,
      media: content.media,
    };
  } catch (error) {
    // Portfolio data may be temporarily unavailable. Keep the homepage usable.
    console.error("Destinations des activités du portfolio indisponibles.", error);
    return { categories: [], projects: [], media: {} };
  }
}

export function getHomePortfolioOptions() {
  const { categories, projects } = getHomePortfolioDestinations();
  const categoryTitles = new Map(categories.map((category) => [category.id, category.title]));
  return {
    categories: categories.map(({ id, title }) => ({ id, title })),
    projects: projects.map(({ id, title, category }) => ({
      id,
      title,
      categoryTitle: categoryTitles.get(category),
    })),
  };
}

export function getHomeActivityLinks(
  items: HomeActivity[],
  lang: "fr" | "en",
  portfolio: ReturnType<typeof getHomePortfolioDestinations> | undefined,
) {
  function hrefFor(destination?: HomeActivityDestination) {
    if (destination?.kind === "category") {
      const category = portfolio?.categories.find(({ id }) => id === destination.id);
      if (category) return getPortfolioSectionUrl(category, lang);
    } else if (destination?.kind === "project") {
      const project = portfolio?.projects.find(({ id }) => id === destination.id);
      if (project && portfolio) return getPortfolioProjectUrl(project, lang, portfolio.categories);
    }
    return getPortfolioOverviewUrl(lang);
  }

  return items.flatMap((item) => {
    const label = item[lang].trim();
    return label ? [{ label, href: hrefFor(item.destination) }] : [];
  });
}
