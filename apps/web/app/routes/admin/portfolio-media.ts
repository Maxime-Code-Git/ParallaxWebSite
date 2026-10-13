import type { LoaderFunctionArgs } from "react-router";
import { requireValidAdminSession, createAdminHeaders } from "../../lib/admin-auth.server";
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

export async function loader({ request, params }: LoaderFunctionArgs) {
  // 1. Authenticate admin session
  await requireValidAdminSession(request);

  const { ownerType, ownerId, slot, imageId, variant, ext } = params;

  // 2. Strict validation of parameters
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

  // 3. Ensure media exists in the registry
  try {
    const { content } = getRawPortfolioContent();
    const mediaItem = content.media[imageId];
    if (!mediaItem) {
      return new Response(null, { status: 404 });
    }

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

    const headers = createAdminHeaders();
    headers.set("Content-Type", mimeType);
    headers.set("Content-Length", String(size));
    headers.set("Cache-Control", "private, no-store");
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
