export const APP_NAME = "Parallax";

export interface LocalizedString {
  fr: string;
  en: string;
}

/**
 * Normalizes typography by removing em-dashes (U+2014, &mdash;, &#8212;, etc.) and replacing them
 * with appropriate punctuation according to context (parentheses for incises, colons/pipes
 * for titles and coordinates, commas for lists and status badges, "Non renseigné" for empty cells).
 */
export function cleanTypography(str: string | null | undefined, lang: "fr" | "en" = "fr"): string {
  if (!str || typeof str !== "string") return "";

  // Normalize entities and literal escaped sequences to Unicode em-dash U+2014
  let s = str.replace(/&mdash;|&#8212;|&#x2014;|\\u2014/gi, "\u2014");

  if (!s.includes("\u2014")) return s;

  // Single standalone em-dash representing an empty value
  if (s.trim() === "\u2014") {
    return lang === "en" ? "Not specified" : "Non renseigné";
  }

  // 1. Legal incise: " — incluant de manière non limitative ... — " -> " (incluant de manière non limitative ...) "
  s = s.replace(
    /\s*\u2014\s*(incluant de manière non limitative [^\u2014]+?)\s*\u2014\s*/gi,
    " ($1) "
  );
  s = s.replace(
    /\s*\u2014\s*(including without limitation [^\u2014]+?)\s*\u2014\s*/gi,
    " ($1) "
  );

  // 2. Juxtaposed postal addresses and contact details (APD, Consumer Mediation)
  s = s.replace(
    /(\d{4}\s+(?:Bruxelles|Brussels))\s*\u2014\s*(Téléphone|Phone)\s*:\s*([^\u2014]+?)\s*\u2014\s*(E-mail|Email)\s*:\s*([^\u2014]+?)\s*\u2014\s*(Site officiel|Official website|Site)\s*:\s*(\S+)/gi,
    "$1 | $2 : $3 | $4 : $5 | $6 : $7"
  );

  // 3. BCE and VAT mentions
  s = s.replace(
    /\s*\u2014\s*(numéro de TVA intracommunautaire)/gi,
    ", numéro de TVA intracommunautaire"
  );
  s = s.replace(
    /\s*\u2014\s*(intra-community VAT number)/gi,
    ", intra-community VAT number"
  );
  s = s.replace(/\s*\u2014\s*(régime TVA)/gi, ", régime TVA");
  s = s.replace(/\s*\u2014\s*(VAT regime)/gi, ", VAT regime");

  // 4. B2B / B2C mentions in parentheses
  s = s.replace(/\s*\u2014\s*(B2[BC]\))/g, ", $1");

  // 5. Version and date in status badges: "(v1 — 2026-10-15)" -> "(v1 | 2026-10-15)"
  s = s.replace(/\((v\d+)\s*\u2014\s*(\d{4}-\d{2}-\d{2})\)/g, "($1 | $2)");

  // 6. Explicit editorial descriptions requested by Maxime
  s = s.replace(
    /Des films qui racontent le réel\s*\u2014\s*portraits de métiers/g,
    "Des films qui racontent le réel : portraits de métiers"
  );
  s = s.replace(
    /Films that tell real stories\s*\u2014\s*portraits of trades/g,
    "Films that tell real stories: portraits of trades"
  );
  s = s.replace(
    /Des films de marque et de produit\s*\u2014\s*studio/g,
    "Des films de marque et de produit : studio"
  );
  s = s.replace(
    /Brand and product films\s*\u2014\s*studio/g,
    "Brand and product films: studio"
  );
  s = s.replace(
    /Ce que ce projet raconte\s*\u2014\s*son émotion/g,
    "Ce que ce projet raconte : son émotion"
  );
  s = s.replace(
    /What this project carries\s*\u2014\s*its emotion/g,
    "What this project carries: its emotion"
  );

  // 7. Title brand suffix: " — Parallax" -> " | Parallax"
  s = s.replace(/\s*\u2014\s*(Parallax\b)/g, " | $1");

  // 8. General fallback for any remaining single em-dashes
  s = s.replace(/\s*\u2014\s*/g, " | ");
  s = s.replace(/\u2014/g, " - ");

  // Spacing and punctuation cleanups
  s = s
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .replace(/[ ]{2,}/g, " ")
    .trim();

  return s;
}

export function cleanLocalizedString(
  loc: LocalizedString | null | undefined
): LocalizedString {
  if (!loc || typeof loc !== "object") return { fr: "", en: "" };
  return {
    fr: cleanTypography(loc.fr, "fr"),
    en: cleanTypography(loc.en, "en"),
  };
}

export function cleanCommonContent<T>(common: T): T {
  if (!common || typeof common !== "object") return common;
  const clone = structuredClone(common) as Record<string, unknown>;

  const navigation = clone.navigation;
  if (navigation && typeof navigation === "object") {
    const nav = navigation as Record<string, unknown>;
    for (const key of Object.keys(nav)) {
      if (nav[key]) {
        nav[key] = cleanLocalizedString(nav[key] as LocalizedString);
      }
    }
  }
  const footer = clone.footer;
  if (footer && typeof footer === "object") {
    const foot = footer as Record<string, unknown>;
    for (const key of Object.keys(foot)) {
      if (foot[key]) {
        foot[key] = cleanLocalizedString(foot[key] as LocalizedString);
      }
    }
  }

  return clone as unknown as T;
}

export function cleanHomeContent<T>(home: T): T {
  if (!home || typeof home !== "object") return home;
  const clone = structuredClone(home) as Record<string, unknown>;

  const seo = clone.seo as Record<string, unknown> | undefined;
  if (seo) {
    if (seo.title) seo.title = cleanLocalizedString(seo.title as LocalizedString);
    if (seo.description) seo.description = cleanLocalizedString(seo.description as LocalizedString);
  }
  const hero = clone.hero as Record<string, unknown> | undefined;
  if (hero) {
    if (hero.badge) hero.badge = cleanLocalizedString(hero.badge as LocalizedString);
    if (hero.title) hero.title = cleanLocalizedString(hero.title as LocalizedString);
    if (hero.subtitle) hero.subtitle = cleanLocalizedString(hero.subtitle as LocalizedString);
  }
  const showreel = clone.showreel as Record<string, unknown> | undefined;
  if (showreel) {
    if (showreel.title) showreel.title = cleanLocalizedString(showreel.title as LocalizedString);
    if (showreel.coverImageAlt) showreel.coverImageAlt = cleanLocalizedString(showreel.coverImageAlt as LocalizedString);
  }
  const duo = clone.duo as Record<string, unknown> | undefined;
  if (duo) {
    if (duo.title) duo.title = cleanLocalizedString(duo.title as LocalizedString);
    if (duo.text) duo.text = cleanLocalizedString(duo.text as LocalizedString);
    if (duo.imageAlt) duo.imageAlt = cleanLocalizedString(duo.imageAlt as LocalizedString);
  }
  const savoirFaire = clone.savoirFaire as Record<string, unknown> | undefined;
  if (savoirFaire) {
    if (savoirFaire.title) savoirFaire.title = cleanLocalizedString(savoirFaire.title as LocalizedString);
    if (savoirFaire.photoTitle) savoirFaire.photoTitle = cleanLocalizedString(savoirFaire.photoTitle as LocalizedString);
    if (savoirFaire.videoTitle) savoirFaire.videoTitle = cleanLocalizedString(savoirFaire.videoTitle as LocalizedString);
    if (Array.isArray(savoirFaire.photoItems)) {
      savoirFaire.photoItems = savoirFaire.photoItems.map((item) => cleanLocalizedString(item as LocalizedString));
    }
    if (Array.isArray(savoirFaire.videoItems)) {
      savoirFaire.videoItems = savoirFaire.videoItems.map((item) => cleanLocalizedString(item as LocalizedString));
    }
  }
  const contact = clone.contact as Record<string, unknown> | undefined;
  if (contact) {
    if (contact.badge) contact.badge = cleanLocalizedString(contact.badge as LocalizedString);
    if (contact.title) contact.title = cleanLocalizedString(contact.title as LocalizedString);
    if (contact.subtitle) contact.subtitle = cleanLocalizedString(contact.subtitle as LocalizedString);
    if (contact.cta) contact.cta = cleanLocalizedString(contact.cta as LocalizedString);
  }
  const sempra = clone.sempra as Record<string, unknown> | undefined;
  if (sempra) {
    if (sempra.badge) sempra.badge = cleanLocalizedString(sempra.badge as LocalizedString);
    if (sempra.title) sempra.title = cleanLocalizedString(sempra.title as LocalizedString);
    if (sempra.text) sempra.text = cleanLocalizedString(sempra.text as LocalizedString);
    if (sempra.buttonText) sempra.buttonText = cleanLocalizedString(sempra.buttonText as LocalizedString);
    if (sempra.imageAlt) sempra.imageAlt = cleanLocalizedString(sempra.imageAlt as LocalizedString);
  }

  return clone as unknown as T;
}

export function cleanStudioContent<T>(studio: T): T {
  if (!studio || typeof studio !== "object") return studio;
  const clone = structuredClone(studio) as Record<string, unknown>;

  const seo = clone.seo as Record<string, unknown> | undefined;
  if (seo) {
    if (seo.title) seo.title = cleanLocalizedString(seo.title as LocalizedString);
    if (seo.description) seo.description = cleanLocalizedString(seo.description as LocalizedString);
  }
  const hero = clone.hero as Record<string, unknown> | undefined;
  if (hero) {
    if (hero.title) hero.title = cleanLocalizedString(hero.title as LocalizedString);
    if (hero.text) hero.text = cleanLocalizedString(hero.text as LocalizedString);
  }
  const team = clone.team as Record<string, unknown> | undefined;
  if (team) {
    if (team.title) team.title = cleanLocalizedString(team.title as LocalizedString);
    if (Array.isArray(team.members)) {
      team.members.forEach((m) => {
        if (!m || typeof m !== "object") return;
        const member = m as Record<string, unknown>;
        if (typeof member.name === "string") member.name = cleanTypography(member.name);
        if (member.role) member.role = cleanLocalizedString(member.role as LocalizedString);
        if (member.imageAlt) member.imageAlt = cleanLocalizedString(member.imageAlt as LocalizedString);
      });
    }
  }
  const approach = clone.approach as Record<string, unknown> | undefined;
  if (approach) {
    if (approach.title) approach.title = cleanLocalizedString(approach.title as LocalizedString);
    if (approach.headline) approach.headline = cleanLocalizedString(approach.headline as LocalizedString);
    if (approach.text) approach.text = cleanLocalizedString(approach.text as LocalizedString);
  }

  return clone as unknown as T;
}

export function cleanContactContent<T>(contact: T): T {
  if (!contact || typeof contact !== "object") return contact;
  const clone = structuredClone(contact) as Record<string, unknown>;

  const seo = clone.seo as Record<string, unknown> | undefined;
  if (seo) {
    if (seo.title) seo.title = cleanLocalizedString(seo.title as LocalizedString);
    if (seo.description) seo.description = cleanLocalizedString(seo.description as LocalizedString);
  }
  const hero = clone.hero as Record<string, unknown> | undefined;
  if (hero) {
    if (hero.title) hero.title = cleanLocalizedString(hero.title as LocalizedString);
    if (hero.subtitle) hero.subtitle = cleanLocalizedString(hero.subtitle as LocalizedString);
  }
  const form = clone.form as Record<string, unknown> | undefined;
  if (form) {
    for (const key of [
      "nameLabel", "namePlaceholder", "emailLabel", "emailPlaceholder",
      "phoneLabel", "phonePlaceholder", "timelineLabel", "timelinePlaceholder",
      "typeLabel", "typePlaceholder", "messageLabel", "messagePlaceholder",
      "submitButton", "noticeText", "privacyPolicyText"
    ]) {
      if (form[key]) form[key] = cleanLocalizedString(form[key] as LocalizedString);
    }
    if (Array.isArray(form.projectTypes)) {
      form.projectTypes.forEach((pt) => {
        if (pt && typeof pt === "object") {
          const ptObj = pt as Record<string, unknown>;
          if (ptObj.label) ptObj.label = cleanLocalizedString(ptObj.label as LocalizedString);
        }
      });
    }
  }
  const card = clone.card as Record<string, unknown> | undefined;
  if (card) {
    for (const key of ["title", "emailLabel", "phoneLabel", "socialLabel", "responseTimeNotice"]) {
      if (card[key]) card[key] = cleanLocalizedString(card[key] as LocalizedString);
    }
  }
  const messages = clone.messages as Record<string, unknown> | undefined;
  if (messages && typeof messages === "object") {
    for (const key of Object.keys(messages)) {
      if (messages[key]) messages[key] = cleanLocalizedString(messages[key] as LocalizedString);
    }
  }

  return clone as unknown as T;
}

export function cleanLegalDocument<T>(doc: T): T {
  if (!doc || typeof doc !== "object") return doc;
  const clone = structuredClone(doc) as Record<string, unknown>;

  if (clone.seoTitle) clone.seoTitle = cleanLocalizedString(clone.seoTitle as LocalizedString);
  if (clone.seoDescription) clone.seoDescription = cleanLocalizedString(clone.seoDescription as LocalizedString);
  if (clone.publicTitle) clone.publicTitle = cleanLocalizedString(clone.publicTitle as LocalizedString);
  if (clone.intro) clone.intro = cleanLocalizedString(clone.intro as LocalizedString);

  if (Array.isArray(clone.sections)) {
    clone.sections.forEach((sec) => {
      if (!sec || typeof sec !== "object") return;
      const secObj = sec as Record<string, unknown>;
      if (secObj.title) secObj.title = cleanLocalizedString(secObj.title as LocalizedString);
      if (Array.isArray(secObj.paragraphs)) {
        secObj.paragraphs = secObj.paragraphs.map((p) => cleanLocalizedString(p as LocalizedString));
      }
      if (Array.isArray(secObj.listItems)) {
        secObj.listItems = secObj.listItems.map((li) => cleanLocalizedString(li as LocalizedString));
      }
    });
  }

  if (Array.isArray(clone.inventory)) {
    clone.inventory.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const itemObj = item as Record<string, unknown>;
      if (itemObj.purpose) itemObj.purpose = cleanLocalizedString(itemObj.purpose as LocalizedString);
      if (itemObj.retention) itemObj.retention = cleanLocalizedString(itemObj.retention as LocalizedString);
    });
  }

  return clone as unknown as T;
}

export function cleanPortfolioContent<T>(portfolio: T): T {
  if (!portfolio || typeof portfolio !== "object") return portfolio;
  const clone = structuredClone(portfolio) as Record<string, unknown>;

  const overview = clone.overview as Record<string, unknown> | undefined;
  if (overview) {
    if (overview.title) overview.title = cleanLocalizedString(overview.title as LocalizedString);
    if (overview.intro) overview.intro = cleanLocalizedString(overview.intro as LocalizedString);
    const overviewSeo = overview.seo as Record<string, unknown> | undefined;
    if (overviewSeo) {
      if (overviewSeo.title) overviewSeo.title = cleanLocalizedString(overviewSeo.title as LocalizedString);
      if (overviewSeo.description) overviewSeo.description = cleanLocalizedString(overviewSeo.description as LocalizedString);
    }
    const heroVideo = overview.heroVideo as Record<string, unknown> | undefined;
    if (heroVideo?.posterAlt) {
      heroVideo.posterAlt = cleanLocalizedString(heroVideo.posterAlt as LocalizedString);
    }
    if (overview.morePhotosButton) overview.morePhotosButton = cleanLocalizedString(overview.morePhotosButton as LocalizedString);
    if (overview.lessPhotosButton) overview.lessPhotosButton = cleanLocalizedString(overview.lessPhotosButton as LocalizedString);
    if (overview.backButton) overview.backButton = cleanLocalizedString(overview.backButton as LocalizedString);
  }

  function cleanCategoryItem(c: unknown) {
    if (!c || typeof c !== "object") return;
    const cat = c as Record<string, unknown>;
    if (cat.title) cat.title = cleanLocalizedString(cat.title as LocalizedString);
    if (cat.intro) cat.intro = cleanLocalizedString(cat.intro as LocalizedString);
    if (cat.entrySummary) cat.entrySummary = cleanLocalizedString(cat.entrySummary as LocalizedString);
    if (cat.coverAlt) cat.coverAlt = cleanLocalizedString(cat.coverAlt as LocalizedString);
    if (cat.entryAlt) cat.entryAlt = cleanLocalizedString(cat.entryAlt as LocalizedString);
    const catSeo = cat.seo as Record<string, unknown> | undefined;
    if (catSeo) {
      if (catSeo.title) catSeo.title = cleanLocalizedString(catSeo.title as LocalizedString);
      if (catSeo.description) catSeo.description = cleanLocalizedString(catSeo.description as LocalizedString);
    }
  }

  if (Array.isArray(clone.categories)) {
    clone.categories.forEach(cleanCategoryItem);
  }
  const sections = clone.sections;
  if (sections && typeof sections === "object") {
    Object.values(sections as Record<string, unknown>).forEach(cleanCategoryItem);
  }

  if (Array.isArray(clone.projects)) {
    clone.projects.forEach((p) => {
      if (!p || typeof p !== "object") return;
      const proj = p as Record<string, unknown>;
      if (proj.title) proj.title = cleanLocalizedString(proj.title as LocalizedString);
      if (proj.summary) proj.summary = cleanLocalizedString(proj.summary as LocalizedString);
      if (proj.client) proj.client = cleanLocalizedString(proj.client as LocalizedString);
      if (proj.location) proj.location = cleanLocalizedString(proj.location as LocalizedString);
      if (proj.credit) proj.credit = cleanLocalizedString(proj.credit as LocalizedString);
      const projSeo = proj.seo as Record<string, unknown> | undefined;
      if (projSeo) {
        if (projSeo.title) projSeo.title = cleanLocalizedString(projSeo.title as LocalizedString);
        if (projSeo.description) projSeo.description = cleanLocalizedString(projSeo.description as LocalizedString);
      }
      if (Array.isArray(proj.description)) {
        proj.description.forEach((block) => {
          if (block && typeof block === "object") {
            const b = block as Record<string, unknown>;
            if (b.text) b.text = cleanLocalizedString(b.text as LocalizedString);
          }
        });
      }
      if (Array.isArray(proj.media)) {
        proj.media.forEach((item) => {
          if (item && typeof item === "object") {
            const m = item as Record<string, unknown>;
            if (m.alt) m.alt = cleanLocalizedString(m.alt as LocalizedString);
            if (m.caption) m.caption = cleanLocalizedString(m.caption as LocalizedString);
          }
        });
      }
    });
  }

  return clone as unknown as T;
}
