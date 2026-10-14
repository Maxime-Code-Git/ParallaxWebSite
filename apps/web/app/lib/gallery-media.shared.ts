export interface PublicPhotoVariantInfo {
  width: number;
  height: number;
}

/**
 * Builds an accurate, deduplicated srcset using the actual produced dimensions of variants.
 * Prevents small images (e.g. 200px) from erroneously claiming 960w.
 */
export function buildPhotoSrcSet(
  mediaUrlPrefix: string,
  mediaId: string,
  variants?: Record<number, { width: number; height: number }> | null,
  fallbackWidth?: number | null
): { srcSet: string; src: string } {
  const targetWidths = [480, 960];
  const seenWidths = new Set<number>();
  const srcSetEntries: string[] = [];
  let largestTarget = 960;

  for (const target of targetWidths) {
    const effectiveWidth =
      variants?.[target]?.width ?? (fallbackWidth ? Math.min(fallbackWidth, target) : target);
    if (!seenWidths.has(effectiveWidth)) {
      seenWidths.add(effectiveWidth);
      srcSetEntries.push(`${mediaUrlPrefix}/${mediaId}?width=${target}&format=webp ${effectiveWidth}w`);
      largestTarget = target;
    }
  }

  const src = `${mediaUrlPrefix}/${mediaId}?width=${largestTarget}&format=webp`;
  return {
    srcSet: srcSetEntries.join(", "),
    src,
  };
}
