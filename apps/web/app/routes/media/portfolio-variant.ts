import type { LoaderFunctionArgs } from "react-router";
import {
  PORTFOLIO_MEDIA_OWNER_TYPES,
  PORTFOLIO_MEDIA_SLOTS,
  PORTFOLIO_VARIANT_NAMES,
  UUID_REGEX,
  type PortfolioMediaOwnerType,
  type PortfolioMediaSlot,
  type PortfolioVariantName,
} from "../../lib/portfolio-content.shared";
import { getRawPortfolioContent, getPortfolioMediaPath } from "../../lib/portfolio-content.server";
import { openPortfolioVariant, SafeImageError } from "../../lib/media-image.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const { ownerType, ownerId, slot, imageId, variant, ext } = params;

  // 1. Strict validation of route parameters
  if (
    !ownerType ||
    !PORTFOLIO_MEDIA_OWNER_TYPES.includes(ownerType as PortfolioMediaOwnerType) ||
    !ownerId ||
    !slot ||
    !PORTFOLIO_MEDIA_SLOTS.includes(slot as PortfolioMediaSlot) ||
    !imageId ||
    !UUID_REGEX.test(imageId) ||
    !variant ||
    !PORTFOLIO_VARIANT_NAMES.includes(variant as PortfolioVariantName) ||
    (ext !== "webp" && ext !== "avif")
  ) {
    return new Response(null, { status: 404 });
  }

  // 2. Ensure media is referenced by a PUBLISHED public project or a valid public section
  try {
    const { content } = getRawPortfolioContent();

    let isPubliclyReferenced = false;

    if (ownerType === "section") {
      if (ownerId === "documentary") {
        const sec = content.sections.documentary;
        if (
          (slot === "cover" && sec.coverImageId === imageId) ||
          (slot === "showreel_cover" && sec.showreelCoverImageId === imageId)
        ) {
          isPubliclyReferenced = true;
        }
      } else if (ownerId === "advertising") {
        const sec = content.sections.advertising;
        if (
          (slot === "cover" && sec.coverImageId === imageId) ||
          (slot === "showreel_cover" && sec.showreelCoverImageId === imageId)
        ) {
          isPubliclyReferenced = true;
        }
      }
    } else if (ownerType === "project") {
      const project = content.projects.find((p) => p.id === ownerId);
      if (project && project.status === "published" && !project.archived) {
        if (
          (slot === "cover" && project.coverImageId === imageId) ||
          (slot === "video_cover" && project.video?.coverImageId === imageId) ||
          (slot === "gallery" && project.galleryImageIds.includes(imageId))
        ) {
          isPubliclyReferenced = true;
        }
      }
    }

    if (!isPubliclyReferenced) {
      // Drafts, archived, or unreferenced images are NOT publicly accessible
      return new Response(null, { status: 404 });
    }

    // 3. Open variant with complete path chain validation and O_NOFOLLOW
    const mediaBasePath = getPortfolioMediaPath();
    const { fileHandle, size, mimeType } = await openPortfolioVariant(
      mediaBasePath,
      ownerType as PortfolioMediaOwnerType,
      ownerId,
      slot as PortfolioMediaSlot,
      imageId,
      variant as PortfolioVariantName,
      ext as "webp" | "avif"
    );

    const stream = fileHandle.createReadStream();

    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    headers.set("Content-Length", String(size));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (err) {
    if (err instanceof SafeImageError) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  }
}
