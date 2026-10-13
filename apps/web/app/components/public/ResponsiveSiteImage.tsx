import {
  type AdminUploadLocation,
  type UploadedMediaMetadata,
  resolveAllowedImage,
} from "../../lib/site-content.shared";

export interface ResponsiveSiteImageProps {
  imageId: string;
  location?: AdminUploadLocation;
  mediaMetadata?: UploadedMediaMetadata | null;
  fallbackSrc?: string;
  alt: string;
  className?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "auto" | "sync";
}

export function ResponsiveSiteImage({
  imageId,
  location,
  mediaMetadata,
  fallbackSrc,
  alt,
  className,
  sizes = "(max-width: 768px) 100vw, 1200px",
  loading = "lazy",
  decoding = "async",
}: ResponsiveSiteImageProps) {
  const isCustomImage =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId);

  // If it's a static prototype image
  if (!isCustomImage) {
    const staticSrc = resolveAllowedImage(imageId) || fallbackSrc || "";
    return (
      <img
        src={staticSrc}
        alt={alt}
        className={className}
        loading={loading}
        decoding={decoding}
      />
    );
  }

  // Uploaded media image
  const effectiveLocation = location || mediaMetadata?.location || "showreel_cover";
  const variants = mediaMetadata?.variants;

  if (variants && variants.length > 0) {
    // Sort variants by width ascending
    const sortedVariants = [...variants].sort((a, b) => a.width - b.width);

    // Build srcset using the actual produced widths
    const avifSrcSet = sortedVariants
      .map(
        (v) => `/media/site/${effectiveLocation}/${imageId}/${v.name}/avif ${v.width}w`
      )
      .join(", ");

    const webpSrcSet = sortedVariants
      .map(
        (v) => `/media/site/${effectiveLocation}/${imageId}/${v.name}/webp ${v.width}w`
      )
      .join(", ");

    // Pick a sensible fallback variant (640p or first available)
    const fallbackVariant =
      sortedVariants.find((v) => v.name === "960p") ||
      sortedVariants.find((v) => v.name === "640p") ||
      sortedVariants[0];

    const fallbackImgUrl = `/media/site/${effectiveLocation}/${imageId}/${fallbackVariant.name}/webp`;

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

  // Fallback if metadata is not loaded
  const fallbackUrl = `/media/site/${effectiveLocation}/${imageId}/640p/webp`;
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
