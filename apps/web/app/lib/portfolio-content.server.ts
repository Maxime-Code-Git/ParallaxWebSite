import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENV } from "./env.server";
import { atomicWriteJson, getBackups } from "./atomic-fs.server";
import {
  RevisionConflictError,
  ValidationError,
  CorruptedContentError,
} from "./site-content.server";
import {
  type PortfolioContent,
  type PortfolioProject,
  type PortfolioCategoryItem,
  type PortfolioMediaItem,
  portfolioContentSchema,
  migratePortfolioContentV1ToV2,
} from "./portfolio-content.shared";
import {
  verifySecurePathChain,
  cleanupMediaDirectory,
} from "./media-image.server";

export function getPortfolioContentPath(): string {
  return ENV.PORTFOLIO_CONTENT_PATH;
}

export function getPortfolioMediaPath(): string {
  return ENV.PORTFOLIO_MEDIA_PATH;
}

export function createDefaultPortfolioContent(): PortfolioContent {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const revision = crypto.randomBytes(16).toString("hex");

  const documentaryCategory: PortfolioCategoryItem = {
    id: "documentary",
    slugFr: "documentaire",
    slugEn: "documentary",
    order: 0,
    status: "published",
    title: {
      fr: "Documentaire",
      en: "Documentary",
    },
    intro: {
      fr: "Des films qui racontent le réel : portraits de métiers, de lieux et de savoir-faire, du repérage au montage.",
      en: "Films that tell real stories: portraits of trades, places and craft, from scouting to the edit.",
    },
    seo: {
      title: {
        fr: "Documentaire | Parallax | Films documentaires",
        en: "Documentary | Parallax | Documentary films",
      },
      description: {
        fr: "Portraits de métiers, de lieux et de savoir-faire, du repérage au montage.",
        en: "Portraits of trades, places and craft, from scouting to the edit.",
      },
    },
    coverImageId: null,
    coverAlt: {
      fr: "Bannière documentaire",
      en: "Documentary banner",
    },
    entryImageId: null,
    entryAlt: {
      fr: "Visuel documentaire",
      en: "Documentary visual",
    },
    entrySummary: {
      fr: "Un court documentaire sur une boulangerie artisanale, du fournil à la vitrine.",
      en: "A short documentary on an artisan bakery, from oven to storefront.",
    },
    entrySide: "left",
    bannerImageId: null,
    bannerAlt: {
      fr: "Bannière documentaire",
      en: "Documentary banner",
    },
    showreelTitle: {
      fr: "Showreel documentaire",
      en: "Documentary showreel",
    },
    showreelVideo: null,
    showreelCoverImageId: null,
    morePhotosButton: {
      fr: "Voir plus de photos",
      en: "See more photos",
    },
    lessPhotosButton: {
      fr: "Voir moins",
      en: "See less",
    },
    backButton: {
      fr: "Retour aux projets",
      en: "Back to projects",
    },
  };

  const advertisingCategory: PortfolioCategoryItem = {
    id: "advertising",
    slugFr: "publicite",
    slugEn: "advertising",
    order: 1,
    status: "published",
    title: {
      fr: "Publicité",
      en: "Advertising",
    },
    intro: {
      fr: "Des films de marque et de produit : studio, extérieur, rythme et lumière au service du message.",
      en: "Brand and product films: studio, outdoor, rhythm and light serving the message.",
    },
    seo: {
      title: {
        fr: "Publicité | Parallax | Films de marque et produit",
        en: "Advertising | Parallax | Brand and product films",
      },
      description: {
        fr: "Films de marque et de produit : studio, extérieur, rythme et lumière au service du message.",
        en: "Brand and product films: studio, outdoor, rhythm and light serving the message.",
      },
    },
    coverImageId: null,
    coverAlt: {
      fr: "Bannière publicité",
      en: "Advertising banner",
    },
    entryImageId: null,
    entryAlt: {
      fr: "Visuel publicité",
      en: "Advertising visual",
    },
    entrySummary: {
      fr: "Film publicitaire pour une marque de vélo, entre studio et grand air.",
      en: "Commercial for a bike brand, between studio and open air.",
    },
    entrySide: "right",
    bannerImageId: null,
    bannerAlt: {
      fr: "Bannière publicité",
      en: "Advertising banner",
    },
    showreelTitle: {
      fr: "Showreel publicité",
      en: "Advertising showreel",
    },
    showreelVideo: null,
    showreelCoverImageId: null,
    morePhotosButton: {
      fr: "Voir plus de photos",
      en: "See more photos",
    },
    lessPhotosButton: {
      fr: "Voir moins",
      en: "See less",
    },
    backButton: {
      fr: "Retour aux projets",
      en: "Back to projects",
    },
  };

  return {
    schemaVersion: 2,
    revision,
    updatedAt: iso,
    overview: {
      title: {
        fr: "Portfolio",
        en: "Portfolio",
      },
      intro: {
        fr: "Découvrez nos réalisations documentaires et publicitaires, entre studio et terrain.",
        en: "Discover our documentary and commercial projects, from studio to the field.",
      },
      seo: {
        title: {
          fr: "Portfolio | Parallax | Réalisations photo et vidéo",
          en: "Portfolio | Parallax | Photo & video projects",
        },
        description: {
          fr: "Découvrez nos réalisations documentaires et publicitaires, entre studio et terrain.",
          en: "Discover our documentary and commercial projects, from studio to the field.",
        },
      },
      seeMoreButton: {
        fr: "Voir plus de projets de ce genre",
        en: "See more projects like this",
      },
    },
    categories: [documentaryCategory, advertisingCategory],
    sections: {
      documentary: documentaryCategory,
      advertising: advertisingCategory,
    },
    projects: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        category: "documentary",
        slugFr: "documentaire-boulangerie",
        slugEn: "bakery-documentary",
        title: {
          fr: "[Nom du projet]",
          en: "[Project name]",
        },
        summary: {
          fr: "Un court documentaire sur une boulangerie artisanale, du fournil à la vitrine.",
          en: "A short documentary on an artisan bakery, from oven to storefront.",
        },
        description: [
          {
            type: "paragraph",
            text: {
              fr: "Ce que ce projet raconte : son émotion, son intention.",
              en: "What this project carries: its emotion, its intent.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Documentaire boulangerie | Parallax",
            en: "Bakery documentary | Parallax",
          },
          description: {
            fr: "Un court documentaire sur une boulangerie artisanale.",
            en: "A short documentary on an artisan bakery.",
          },
        },
        coverImageId: null,
        coverAlt: {
          fr: "Documentaire boulangerie",
          en: "Bakery documentary",
        },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "left",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        category: "advertising",
        slugFr: "publicite-velo",
        slugEn: "bike-commercial",
        title: {
          fr: "[Nom du projet]",
          en: "[Project name]",
        },
        summary: {
          fr: "Film publicitaire pour une marque de vélo, entre studio et grand air.",
          en: "A commercial for a bike brand, between studio and open air.",
        },
        description: [
          {
            type: "paragraph",
            text: {
              fr: "Ce que ce projet raconte : son émotion, son intention.",
              en: "What this project carries: its emotion, its intent.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Publicité vélo | Parallax",
            en: "Bike commercial | Parallax",
          },
          description: {
            fr: "Film publicitaire pour une marque de vélo, entre studio et grand air.",
            en: "A commercial for a bike brand, between studio and open air.",
          },
        },
        coverImageId: null,
        coverAlt: {
          fr: "Publicité vélo",
          en: "Bike commercial",
        },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "right",
        order: 1,
        status: "draft",
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        category: "advertising",
        slugFr: "publicite-produit",
        slugEn: "product-commercial",
        title: {
          fr: "[Nom du projet]",
          en: "[Project name]",
        },
        summary: {
          fr: "Nature morte en mouvement pour le lancement d'un produit.",
          en: "A still life in motion for a product launch.",
        },
        description: [
          {
            type: "paragraph",
            text: {
              fr: "Ce que ce projet raconte : son émotion, son intention.",
              en: "What this project carries: its emotion, its intent.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Publicité produit | Parallax",
            en: "Product commercial | Parallax",
          },
          description: {
            fr: "Nature morte en mouvement pour le lancement d'un produit.",
            en: "A still life in motion for a product launch.",
          },
        },
        coverImageId: null,
        coverAlt: {
          fr: "Publicité produit",
          en: "Product commercial",
        },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "left",
        order: 2,
        status: "draft",
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    media: {},
  };
}

/**
 * Loads the raw portfolio content JSON file or initializes default.
 * Idempotently migrates Schema V1 to V2 with backup and validation.
 */
export function getRawPortfolioContent(customPath?: string): {
  content: PortfolioContent;
  fileExists: boolean;
} {
  const filePath = customPath || getPortfolioContentPath();

  if (!fs.existsSync(filePath)) {
    const defaultContent = createDefaultPortfolioContent();
    atomicWriteJson(filePath, defaultContent);
    return { content: defaultContent, fileExists: false };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    throw new CorruptedContentError("Impossible de lire le fichier de contenu portfolio");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CorruptedContentError("Format JSON portfolio invalide");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Le contenu portfolio doit être un objet JSON racine.");
  }

  const obj = parsed as Record<string, unknown>;

  // Reject unsupported schema versions immediately
  if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1 && obj.schemaVersion !== 2) {
    throw new ValidationError(`Version de schéma non prise en charge : ${String(obj.schemaVersion)}`);
  }

  // If already Schema V2
  if (obj.schemaVersion === 2) {
    const result = portfolioContentSchema.safeParse(parsed);
    if (!result.success) {
      const details = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new ValidationError(`Contenu portfolio non conforme au schéma : ${details}`);
    }
    return { content: result.data, fileExists: true };
  }

  // Check if migration is needed from Schema V1 or unversioned V1 content
  if (obj.schemaVersion === 1 || (obj.schemaVersion === undefined && obj.sections && !Array.isArray(obj.categories))) {
    let migrated: PortfolioContent;
    try {
      migrated = migratePortfolioContentV1ToV2(parsed);
    } catch (migErr) {
      throw new ValidationError(
        `Échec de la migration du portfolio : ${migErr instanceof Error ? migErr.message : String(migErr)}`
      );
    }

    const valResult = portfolioContentSchema.safeParse(migrated);
    if (!valResult.success) {
      const details = valResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new ValidationError(`Migration du portfolio non conforme au schéma : ${details}`);
    }

    // Atomically persist the migrated V2 content to disk with backup rotation only after full validation
    atomicWriteJson(filePath, valResult.data);
    return { content: valResult.data, fileExists: true };
  }

  const result = portfolioContentSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new ValidationError(`Contenu portfolio non conforme au schéma : ${details}`);
  }

  return { content: result.data, fileExists: true };
}

/**
 * Returns portfolio content filtered for public viewing.
 * Excludes drafts, unpublished projects, archived projects, and unpublished categories.
 */
export function getPublicPortfolioContent(customPath?: string): {
  content: PortfolioContent;
  publicProjects: PortfolioProject[];
  publicCategories: PortfolioCategoryItem[];
} {
  const { content } = getRawPortfolioContent(customPath);

  const publicCategories = content.categories
    .filter((c) => c.status === "published")
    .sort((a, b) => a.order - b.order);

  const publishedCategoryIds = new Set(publicCategories.map((c) => c.id));

  const publicProjects = content.projects
    .filter((p) => p.status === "published" && !p.archived && publishedCategoryIds.has(p.category))
    .sort((a, b) => a.order - b.order);

  // Collect ONLY media IDs referenced by public categories and published projects
  const publicMediaIds = new Set<string>();
  for (const cat of publicCategories) {
    if (cat.coverImageId) publicMediaIds.add(cat.coverImageId);
    if (cat.showreelCoverImageId) publicMediaIds.add(cat.showreelCoverImageId);
    if (cat.entryImageId) publicMediaIds.add(cat.entryImageId);
    if (cat.bannerImageId) publicMediaIds.add(cat.bannerImageId);
  }

  for (const p of publicProjects) {
    if (p.coverImageId) publicMediaIds.add(p.coverImageId);
    if (p.video?.coverImageId) publicMediaIds.add(p.video.coverImageId);
    if (Array.isArray(p.galleryImageIds)) {
      for (const gid of p.galleryImageIds) {
        publicMediaIds.add(gid);
      }
    }
  }

  const publicMedia: Record<string, PortfolioMediaItem> = {};
  if (content.media) {
    for (const [id, item] of Object.entries(content.media)) {
      if (publicMediaIds.has(id)) {
        publicMedia[id] = item;
      }
    }
  }

  const sections: Record<string, PortfolioCategoryItem> = {};
  for (const c of publicCategories) {
    sections[c.id] = c;
  }

  const publicContent: PortfolioContent = {
    schemaVersion: 2,
    revision: content.revision,
    updatedAt: content.updatedAt,
    overview: content.overview,
    categories: publicCategories,
    sections,
    projects: publicProjects,
    media: publicMedia,
  };

  return {
    content: publicContent,
    publicProjects,
    publicCategories,
  };
}

/**
 * Prunes the media registry to retain only images actively referenced
 * in projects (draft or published) and categories.
 */
export function prunePortfolioMediaRegistry(
  content: PortfolioContent
): Record<string, PortfolioMediaItem> {
  const activeIds = new Set<string>();

  if (Array.isArray(content.categories)) {
    for (const cat of content.categories) {
      if (cat.coverImageId) activeIds.add(cat.coverImageId);
      if (cat.showreelCoverImageId) activeIds.add(cat.showreelCoverImageId);
      if (cat.entryImageId) activeIds.add(cat.entryImageId);
      if (cat.bannerImageId) activeIds.add(cat.bannerImageId);
    }
  }

  if (content.sections && typeof content.sections === "object") {
    for (const sec of Object.values(content.sections) as (PortfolioCategoryItem | null | undefined)[]) {
      if (sec?.coverImageId) activeIds.add(sec.coverImageId);
      if (sec?.showreelCoverImageId) activeIds.add(sec.showreelCoverImageId);
      if (sec?.entryImageId) activeIds.add(sec.entryImageId);
      if (sec?.bannerImageId) activeIds.add(sec.bannerImageId);
    }
  }

  if (Array.isArray(content.projects)) {
    for (const project of content.projects) {
      if (project.coverImageId) activeIds.add(project.coverImageId);
      if (project.draftVideoCoverImageId) activeIds.add(project.draftVideoCoverImageId);
      if (project.video?.coverImageId) activeIds.add(project.video.coverImageId);
      for (const gid of project.galleryImageIds) {
        activeIds.add(gid);
      }
    }
  }

  const pruned: Record<string, PortfolioMediaItem> = {};
  if (content.media) {
    for (const [id, meta] of Object.entries(content.media)) {
      if (activeIds.has(id)) {
        pruned[id] = meta;
      }
    }
  }
  return pruned;
}

/**
 * Atomic save of portfolio content with revision checking and backup rotation.
 */
export async function savePortfolioContent(
  nextContent: PortfolioContent,
  expectedRevision: string,
  customPath?: string
): Promise<{ success: boolean; newRevision: string; content: PortfolioContent }> {
  const filePath = customPath || getPortfolioContentPath();
  const { content: currentContent } = getRawPortfolioContent(filePath);

  if (currentContent.revision !== expectedRevision) {
    throw new RevisionConflictError(
      "Un autre utilisateur ou onglet a modifie le portfolio. Veuillez recharger la page."
    );
  }

  const categories = Array.isArray(nextContent.categories) ? nextContent.categories : [];
  const sections: Record<string, PortfolioCategoryItem> = {};
  for (const c of categories) {
    sections[c.id] = c;
  }

  const newRevision = crypto.randomBytes(16).toString("hex");
  const toSave: PortfolioContent = {
    ...nextContent,
    schemaVersion: 2,
    revision: newRevision,
    updatedAt: new Date().toISOString(),
    categories,
    sections,
  };

  // Prune unreferenced media from the current active registry
  toSave.media = prunePortfolioMediaRegistry(toSave);

  const validation = portfolioContentSchema.safeParse(toSave);
  if (!validation.success) {
    const details = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new ValidationError(`Validation du portfolio échouée : ${details}`);
  }

  atomicWriteJson(filePath, validation.data);

  return {
    success: true,
    newRevision,
    content: validation.data,
  };
}

/**
 * Collects all media IDs referenced across current active content and up to 5 real backups.
 * Fully compatible with Schema V2 (categories) and Schema V1 (sections).
 */
export function getReferencedPortfolioMediaIds(
  content: PortfolioContent,
  contentPath: string = getPortfolioContentPath()
): { referencedIds: Set<string>; hasUnreadableBackup: boolean } {
  const referencedIds = new Set<string>();
  let hasUnreadableBackup = false;

  const collectFromContent = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const obj = c as Record<string, unknown>;

    if (Array.isArray(obj.categories)) {
      for (const cat of obj.categories as Array<Record<string, unknown> | null | undefined>) {
        if (typeof cat?.coverImageId === "string") referencedIds.add(cat.coverImageId);
        if (typeof cat?.showreelCoverImageId === "string") referencedIds.add(cat.showreelCoverImageId);
        if (typeof cat?.entryImageId === "string") referencedIds.add(cat.entryImageId);
        if (typeof cat?.bannerImageId === "string") referencedIds.add(cat.bannerImageId);
      }
    }

    if (obj.sections && typeof obj.sections === "object") {
      for (const sec of Object.values(obj.sections) as Array<Record<string, unknown> | null | undefined>) {
        if (typeof sec?.coverImageId === "string") referencedIds.add(sec.coverImageId);
        if (typeof sec?.showreelCoverImageId === "string") referencedIds.add(sec.showreelCoverImageId);
        if (typeof sec?.entryImageId === "string") referencedIds.add(sec.entryImageId);
        if (typeof sec?.bannerImageId === "string") referencedIds.add(sec.bannerImageId);
      }
    }

    if (Array.isArray(obj.projects)) {
      for (const p of obj.projects as Array<Record<string, unknown> | null | undefined>) {
        if (typeof p?.coverImageId === "string") referencedIds.add(p.coverImageId);
        if (typeof p?.draftVideoCoverImageId === "string") referencedIds.add(p.draftVideoCoverImageId);
        const pVideo = p?.video as Record<string, unknown> | null | undefined;
        if (typeof pVideo?.coverImageId === "string") referencedIds.add(pVideo.coverImageId);
        if (Array.isArray(p?.galleryImageIds)) {
          for (const gid of p.galleryImageIds) {
            if (typeof gid === "string") referencedIds.add(gid);
          }
        }
      }
    }
  };

  collectFromContent(content);

  const backupFiles = getBackups(contentPath).slice(0, 5);
  const dir = path.dirname(contentPath);
  for (const bName of backupFiles) {
    try {
      const bPath = path.join(dir, bName);
      const raw = fs.readFileSync(bPath, "utf-8");
      const parsed = JSON.parse(raw);
      collectFromContent(parsed);
    } catch {
      hasUnreadableBackup = true;
    }
  }

  return { referencedIds, hasUnreadableBackup };
}

/**
 * Clean up unreferenced media in PORTFOLIO_MEDIA_PATH while respecting backups,
 * draft projects, active staging directories, and path confinement.
 */
export async function cleanupUnreferencedPortfolioMedia(
  customContentPath?: string,
  customMediaPath?: string
): Promise<{ cleanedCount: number; deferred: boolean }> {
  const contentPath = customContentPath || getPortfolioContentPath();
  const mediaBasePath = customMediaPath || getPortfolioMediaPath();

  if (!fs.existsSync(contentPath) || !fs.existsSync(mediaBasePath)) {
    return { cleanedCount: 0, deferred: false };
  }

  const { content } = getRawPortfolioContent(contentPath);
  const { referencedIds, hasUnreadableBackup } = getReferencedPortfolioMediaIds(content, contentPath);

  if (hasUnreadableBackup) {
    return { cleanedCount: 0, deferred: true };
  }

  let cleanedCount = 0;

  // Inspect allowed subdirectories under portfolio media path: sections, projects
  const allowedRoots = ["sections", "projects"];

  for (const root of allowedRoots) {
    const rootPath = path.join(mediaBasePath, root);
    if (!fs.existsSync(rootPath)) continue;

    try {
      verifySecurePathChain(mediaBasePath, [root], "directory");
    } catch {
      continue;
    }

    // Iterate owner directories (e.g. sections/<categoryId>, projects/<projectId>)
    const ownerEntries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const ownerEntry of ownerEntries) {
      if (!ownerEntry.isDirectory()) continue;

      try {
        verifySecurePathChain(mediaBasePath, [root, ownerEntry.name], "directory");
      } catch {
        continue;
      }

      const ownerPath = path.join(rootPath, ownerEntry.name);
      const slotEntries = fs.readdirSync(ownerPath, { withFileTypes: true });

      for (const slotEntry of slotEntries) {
        if (!slotEntry.isDirectory()) continue;

        try {
          verifySecurePathChain(mediaBasePath, [root, ownerEntry.name, slotEntry.name], "directory");
        } catch {
          continue;
        }

        const slotPath = path.join(ownerPath, slotEntry.name);
        const imageEntries = fs.readdirSync(slotPath, { withFileTypes: true });

        for (const imgEntry of imageEntries) {
          if (!imgEntry.isDirectory()) continue;
          const imageId = imgEntry.name;

          try {
            verifySecurePathChain(mediaBasePath, [root, ownerEntry.name, slotEntry.name, imageId], "directory");
          } catch {
            continue;
          }

          // If this imageId is NOT in referencedIds, clean it up!
          if (!referencedIds.has(imageId)) {
            const imgPath = path.join(slotPath, imageId);
            cleanupMediaDirectory(imgPath, mediaBasePath);
            cleanedCount++;
          }
        }
      }
    }
  }

  // Clean stale staging directories older than 1 hour
  const stagingPath = path.join(mediaBasePath, "staging");
  if (fs.existsSync(stagingPath)) {
    try {
      verifySecurePathChain(mediaBasePath, ["staging"], "directory");
      const stagingEntries = fs.readdirSync(stagingPath, { withFileTypes: true });
      const oneHourAgo = Date.now() - 3600 * 1000;
      for (const entry of stagingEntries) {
        if (entry.isDirectory()) {
          try {
            verifySecurePathChain(mediaBasePath, ["staging", entry.name], "directory");
            const dirPath = path.join(stagingPath, entry.name);
            const stat = fs.statSync(dirPath);
            if (stat.mtimeMs < oneHourAgo) {
              cleanupMediaDirectory(dirPath, mediaBasePath);
            }
          } catch {
            // ignore inaccessible or untrusted staging entry
          }
        }
      }
    } catch {
      // ignore if staging root is inaccessible
    }
  }

  return { cleanedCount, deferred: false };
}
