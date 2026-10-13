export interface LocalizedString {
  fr: string;
  en: string;
}

export type AllowedImageId =
  | "index-showreel"
  | "index-duo"
  | "studio-ludovic"
  | "studio-maxime"
  | "logo-parallax"
  | "logo-sempra";

export const ALLOWED_IMAGE_MAP: Record<AllowedImageId, string> = {
  "index-showreel": "/img/index-36b7cd6c87.jpg",
  "index-duo": "/img/index-0ff090a6e4.jpg",
  "studio-ludovic": "/img/studio-d0f3184629.jpg",
  "studio-maxime": "/img/studio-b4c530c5ae.jpg",
  "logo-parallax": "/img/logo-parallax.png",
  "logo-sempra": "/img/img-73c121e112.png",
};

export function resolveAllowedImage(id: string | null | undefined): string | null {
  if (!id) return null;
  return ALLOWED_IMAGE_MAP[id as AllowedImageId] ?? null;
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
}
