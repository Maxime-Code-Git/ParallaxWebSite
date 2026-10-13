export interface LocalizedString {
  fr: string;
  en: string;
}

export type AllowedStaticImageId =
  | "index-showreel"
  | "index-duo"
  | "studio-ludovic"
  | "studio-maxime"
  | "logo-parallax"
  | "logo-sempra";

export type AllowedImageId = AllowedStaticImageId | string;

export const ALLOWED_IMAGE_MAP: Record<AllowedStaticImageId, string> = {
  "index-showreel": "/img/index-36b7cd6c87.jpg",
  "index-duo": "/img/index-0ff090a6e4.jpg",
  "studio-ludovic": "/img/studio-d0f3184629.jpg",
  "studio-maxime": "/img/studio-b4c530c5ae.jpg",
  "logo-parallax": "/img/logo-parallax.png",
  "logo-sempra": "/img/img-73c121e112.png",
};

export type AdminUploadLocation =
  | "showreel_cover"
  | "duo"
  | "portrait_ludovic"
  | "portrait_maxime";

export const ADMIN_UPLOAD_LOCATIONS: readonly AdminUploadLocation[] = [
  "showreel_cover",
  "duo",
  "portrait_ludovic",
  "portrait_maxime",
] as const;

export const DEFAULT_LOCATION_IMAGES: Record<AdminUploadLocation, AllowedStaticImageId> = {
  showreel_cover: "index-showreel",
  duo: "index-duo",
  portrait_ludovic: "studio-ludovic",
  portrait_maxime: "studio-maxime",
};

export interface MediaVariantInfo {
  name: "640p" | "960p" | "1440p" | "1920p";
  width: number;
  height: number;
  sizeBytesWebp: number;
  sizeBytesAvif: number;
  fileId: string;
}

export interface UploadedMediaMetadata {
  imageId: string;
  location: AdminUploadLocation;
  originalWidth: number;
  originalHeight: number;
  variants: MediaVariantInfo[];
  createdAt: string;
}

export function resolveAllowedImage(id: string | null | undefined): string | null {
  if (!id) return null;
  return (ALLOWED_IMAGE_MAP as Record<string, string>)[id] ?? null;
}

export function resolveImageUrl(
  id: string | null | undefined,
  location?: AdminUploadLocation,
  variant: "640p" | "960p" | "1440p" | "1920p" = "640p",
  ext: "webp" | "avif" = "webp"
): string | null {
  if (!id) return null;
  if (id in ALLOWED_IMAGE_MAP) {
    return (ALLOWED_IMAGE_MAP as Record<string, string>)[id];
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && location) {
    return `/media/site/${location}/${id}/${variant}/${ext}`;
  }
  return null;
}

export interface CommonContent {
  brandName: string;
  navigation: {
    portfolio: LocalizedString;
    studio: LocalizedString;
    contact: LocalizedString;
    sempra: LocalizedString;
    clientArea: LocalizedString;
  };
  footer: {
    copyright: LocalizedString;
    legalNotice: LocalizedString;
    privacy: LocalizedString;
    terms: LocalizedString;
    cookies: LocalizedString;
  };
}

export interface HomeContent {
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  hero: {
    badge: LocalizedString;
    title: LocalizedString;
    subtitle: LocalizedString;
  };
  showreel: {
    title: LocalizedString;
    coverImageId: AllowedImageId;
    coverImageAlt: LocalizedString;
    videoUrl: string;
  };
  duo: {
    title: LocalizedString;
    text: LocalizedString;
    imageId: AllowedImageId;
    imageAlt: LocalizedString;
  };
  savoirFaire: {
    title: LocalizedString;
    photoTitle: LocalizedString;
    photoItems: LocalizedString[];
    videoTitle: LocalizedString;
    videoItems: LocalizedString[];
  };
  contact: {
    title: LocalizedString;
    emailLabel: LocalizedString;
    email: string;
    socialLabel: LocalizedString;
    instagramUrl: string;
    youtubeUrl: string;
  };
  sempra: {
    badge: LocalizedString;
    title: LocalizedString;
    buttonText: LocalizedString;
    buttonUrl: string;
  };
}

export interface StudioMember {
  id: string;
  name: string;
  role: LocalizedString;
  imageId: AllowedImageId;
  imageAlt: LocalizedString;
}

export interface StudioContent {
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  hero: {
    title: LocalizedString;
    text: LocalizedString;
  };
  team: {
    title: LocalizedString;
    members: StudioMember[];
  };
  approach: {
    title: LocalizedString;
    headline: LocalizedString;
    text: LocalizedString;
  };
}

export interface SiteContent {
  schemaVersion: 1;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  media?: Record<string, UploadedMediaMetadata>;
}
