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
  type PortfolioMediaItem,
  portfolioContentSchema,
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

  return {
    schemaVersion: 1,
    revision,
    updatedAt: iso,
    overview: {
      title: {
        fr: "Portfolio",
        en: "Portfolio",
      },
      seo: {
        title: {
          fr: "Portfolio — Parallax | Réalisations photo et vidéo",
          en: "Portfolio — Parallax | Photo & video projects",
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
    sections: {
      documentary: {
        category: "documentary",
        title: {
          fr: "Documentaire",
          en: "Documentary",
        },
        intro: {
          fr: "Des films qui racontent le réel — portraits de métiers, de lieux et de savoir-faire, du repérage au montage.",
          en: "Films that tell real stories — portraits of trades, places and craft, from scouting to the edit.",
        },
        seo: {
          title: {
            fr: "Documentaire — Parallax | Films documentaires",
            en: "Documentary — Parallax | Documentary films",
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
      },
      advertising: {
        category: "advertising",
        title: {
          fr: "Publicité",
          en: "Advertising",
        },
        intro: {
          fr: "Des films de marque et de produit — studio, extérieur, rythme et lumière au service du message.",
          en: "Brand and product films — studio, outdoor, rhythm and light serving the message.",
        },
        seo: {
          title: {
            fr: "Publicité — Parallax | Films de marque et produit",
            en: "Advertising — Parallax | Brand and product films",
          },
          description: {
            fr: "Films de marque et de produit — studio, extérieur, rythme et lumière au service du message.",
            en: "Brand and product films — studio, outdoor, rhythm and light serving the message.",
          },
        },
        coverImageId: null,
        coverAlt: {
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
      },
    },
    // Initial draft projects reflecting prototype layout (not published commercially)
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
              fr: "Ce que ce projet raconte — son émotion, son intention.",
              en: "What this project carries — its emotion, its intent.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Documentaire boulangerie — Parallax",
            en: "Bakery documentary — Parallax",
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
              fr: "Ce que ce projet raconte — son émotion, son intention.",
              en: "What this project carries — its emotion, its intent.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Publicité vélo — Parallax",
            en: "Bike commercial — Parallax",
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
              fr: "Ce que ce projet raconte — son émotion, son intention.",
              en: "What this project carries — its emotion, its intent.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Publicité produit — Parallax",
            en: "Product commercial — Parallax",
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

  const result = portfolioContentSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new ValidationError(`Contenu portfolio non conforme au schéma : ${details}`);
  }

  return { content: result.data, fileExists: true };
}

/**
 * Returns portfolio content filtered for public viewing.
 * Excludes drafts, unpublished projects, archived projects, and internal paths.
 */
export function getPublicPortfolioContent(customPath?: string): {
  content: PortfolioContent;
  publicProjects: PortfolioProject[];
} {
  const { content } = getRawPortfolioContent(customPath);

  const publicProjects = content.projects
    .filter((p) => p.status === "published" && !p.archived)
    .sort((a, b) => a.order - b.order);

  return {
    content: {
      ...content,
      projects: publicProjects,
    },
    publicProjects,
  };
}

/**
 * Prunes the media registry to retain only images actively referenced
 * in projects (draft or published) and sections.
 */
export function prunePortfolioMediaRegistry(
  content: PortfolioContent
): Record<string, PortfolioMediaItem> {
  const activeIds = new Set<string>();

  if (content.sections.documentary.coverImageId) {
    activeIds.add(content.sections.documentary.coverImageId);
  }
  if (content.sections.documentary.showreelCoverImageId) {
    activeIds.add(content.sections.documentary.showreelCoverImageId);
  }
  if (content.sections.advertising.coverImageId) {
    activeIds.add(content.sections.advertising.coverImageId);
  }
  if (content.sections.advertising.showreelCoverImageId) {
    activeIds.add(content.sections.advertising.showreelCoverImageId);
  }

  for (const project of content.projects) {
    if (project.coverImageId) activeIds.add(project.coverImageId);
    if (project.video?.coverImageId) activeIds.add(project.video.coverImageId);
    for (const gid of project.galleryImageIds) {
      activeIds.add(gid);
    }
  }

  const pruned: Record<string, PortfolioMediaItem> = {};
  for (const [id, meta] of Object.entries(content.media)) {
    if (activeIds.has(id)) {
      pruned[id] = meta;
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

  // Prune unreferenced media from the current active registry
  const prunedMedia = prunePortfolioMediaRegistry(nextContent);

  const newRevision = crypto.randomBytes(16).toString("hex");
  const toSave: PortfolioContent = {
    ...nextContent,
    revision: newRevision,
    updatedAt: new Date().toISOString(),
    media: prunedMedia,
  };

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
 */
export function getReferencedPortfolioMediaIds(
  content: PortfolioContent,
  contentPath: string
): { referencedIds: Set<string>; hasUnreadableBackup: boolean } {
  const referencedIds = new Set<string>();
  let hasUnreadableBackup = false;

  const collectFromContent = (c: PortfolioContent) => {
    if (c.sections?.documentary?.coverImageId) referencedIds.add(c.sections.documentary.coverImageId);
    if (c.sections?.documentary?.showreelCoverImageId) referencedIds.add(c.sections.documentary.showreelCoverImageId);
    if (c.sections?.advertising?.coverImageId) referencedIds.add(c.sections.advertising.coverImageId);
    if (c.sections?.advertising?.showreelCoverImageId) referencedIds.add(c.sections.advertising.showreelCoverImageId);

    if (Array.isArray(c.projects)) {
      for (const p of c.projects) {
        if (p.coverImageId) referencedIds.add(p.coverImageId);
        if (p.video?.coverImageId) referencedIds.add(p.video.coverImageId);
        if (Array.isArray(p.galleryImageIds)) {
          for (const gid of p.galleryImageIds) referencedIds.add(gid);
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
      const parsed = JSON.parse(raw) as PortfolioContent;
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

    // Iterate owner directories (e.g. sections/documentary, projects/<projectId>)
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
