import type {
  PortfolioMediaItem,
  PortfolioMediaOwnerType,
  PortfolioMediaSlot,
} from "../../lib/portfolio-content.shared";

export interface ResponsivePortfolioImageProps {
  imageId: string | null | undefined;
  ownerType: PortfolioMediaOwnerType;
  ownerId: string;
  mediaSlot: PortfolioMediaSlot;
  mediaMetadata?: PortfolioMediaItem | null;
  fallbackSrc?: string;
  alt: string;
  className?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "auto" | "sync";
  isAdminPreview?: boolean;
}

export function ResponsivePortfolioImage({
  imageId,
  ownerType,
  ownerId,
  mediaSlot,
  mediaMetadata,
  fallbackSrc,
  alt,
  className,
  sizes = "(max-width: 768px) 100vw, 1200px",
  loading = "lazy",
  decoding = "async",
  isAdminPreview = false,
}: ResponsivePortfolioImageProps) {
  const isCustomImage =
    imageId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId);

  // If no uploaded image or static prototype fallback
  if (!isCustomImage || !imageId) {
    if (!fallbackSrc) return null;
    return (
      <img
        src={fallbackSrc}
        alt={alt}
        className={className}
        loading={loading}
        decoding={decoding}
      />
    );
  }

  const prefix = isAdminPreview ? "/admin/media/portfolio" : "/media/portfolio";
  const variants = mediaMetadata?.variants;
  const effectiveOwnerType = mediaMetadata?.ownerType || ownerType;
  const effectiveOwnerId = mediaMetadata?.ownerId || ownerId;
  const effectiveSlot = mediaMetadata?.mediaSlot || mediaSlot;

  if (variants && variants.length > 0) {
    const sortedVariants = [...variants].sort((a, b) => a.width - b.width);

    const avifSrcSet = sortedVariants
      .map((v) => `${prefix}/${effectiveOwnerType}/${effectiveOwnerId}/${effectiveSlot}/${imageId}/${v.name}/avif ${v.width}w`)
      .join(", ");

    const webpSrcSet = sortedVariants
      .map((v) => `${prefix}/${effectiveOwnerType}/${effectiveOwnerId}/${effectiveSlot}/${imageId}/${v.name}/webp ${v.width}w`)
      .join(", ");

    const fallbackVariant =
      sortedVariants.find((v) => v.name === "960p") ||
      sortedVariants.find((v) => v.name === "640p") ||
      sortedVariants[0];

    const fallbackImgUrl = `${prefix}/${effectiveOwnerType}/${effectiveOwnerId}/${effectiveSlot}/${imageId}/${fallbackVariant.name}/webp`;

    return (
      <picture>
        <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />
        <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />
        <img
          src={fallbackImgUrl}
          alt={alt}
          width={fallbackVariant.width}
          height={fallbackVariant.height}
          loading={loading}
          decoding={decoding}
          className={className}
        />
      </picture>
    );
  }

  // Fallback if metadata is not provided
  const fallbackUrl = `${prefix}/${ownerType}/${ownerId}/${mediaSlot}/${imageId}/640p/webp`;
  return (
    <img
      src={fallbackUrl}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
    />
  );
}
