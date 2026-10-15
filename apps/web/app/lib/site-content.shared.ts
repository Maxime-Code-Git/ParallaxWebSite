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

export interface ProjectTypeOption {
  id: string;
  enabled: boolean;
  label: LocalizedString;
}

export interface ContactPageContent {
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  hero: {
    title: LocalizedString;
    subtitle?: LocalizedString;
  };
  form: {
    nameLabel: LocalizedString;
    namePlaceholder: LocalizedString;
    emailLabel: LocalizedString;
    emailPlaceholder: LocalizedString;
    phoneLabel: LocalizedString;
    phonePlaceholder: LocalizedString;
    timelineLabel: LocalizedString;
    timelinePlaceholder: LocalizedString;
    typeLabel: LocalizedString;
    typePlaceholder: LocalizedString;
    projectTypes: ProjectTypeOption[];
    messageLabel: LocalizedString;
    messagePlaceholder: LocalizedString;
    submitButton: LocalizedString;
    noticeText: LocalizedString;
    privacyPolicyText: LocalizedString;
    privacyPolicyUrl: string;
  };
  card: {
    title: LocalizedString;
    emailLabel: LocalizedString;
    phoneLabel: LocalizedString;
    phone: string;
    socialLabel: LocalizedString;
    responseTimeNotice: LocalizedString;
  };
  messages: {
    successTitle: LocalizedString;
    successMessage: LocalizedString;
    unavailableMessage: LocalizedString;
    genericError: LocalizedString;
  };
}

export const DEFAULT_PROJECT_TYPES: readonly ProjectTypeOption[] = [
  {
    id: "music-video",
    enabled: true,
    label: { fr: "Clip musical", en: "Music video" },
  },
  {
    id: "advertising",
    enabled: true,
    label: { fr: "Publicité", en: "Advertising" },
  },
  {
    id: "portrait",
    enabled: true,
    label: { fr: "Portrait", en: "Portrait" },
  },
  {
    id: "documentary",
    enabled: true,
    label: { fr: "Documentaire", en: "Documentary" },
  },
  {
    id: "other",
    enabled: true,
    label: { fr: "Autre", en: "Other" },
  },
] as const;

export const DEFAULT_CONTACT_PAGE_CONTENT: ContactPageContent = {
  seo: {
    title: {
      fr: "Contact | Parallax - Studio photo & vidéo",
      en: "Contact | Parallax - Photo & video studio",
    },
    description: {
      fr: "Contactez le studio Parallax pour vos projets photo et vidéo. Clips musicaux, publicités, portraits et documentaires.",
      en: "Contact Parallax studio for your photo and video projects. Music videos, commercials, portraits and documentaries.",
    },
  },
  hero: {
    title: {
      fr: "Vous préférez écrire ? Remplissez le formulaire ci-dessous.",
      en: "Prefer to write? Fill in the form below.",
    },
  },
  form: {
    nameLabel: { fr: "Nom / société", en: "Name / company" },
    namePlaceholder: { fr: "Studio, marque, artiste…", en: "Studio, brand, artist…" },
    emailLabel: { fr: "Email", en: "Email" },
    emailPlaceholder: { fr: "vous@exemple.com", en: "you@example.com" },
    phoneLabel: { fr: "Téléphone (optionnel)", en: "Phone (optional)" },
    phonePlaceholder: { fr: "04XX XX XX XX", en: "04XX XX XX XX" },
    timelineLabel: { fr: "Échéance souhaitée", en: "Preferred timeline" },
    timelinePlaceholder: { fr: "JJ / MM / AAAA", en: "DD / MM / YYYY" },
    typeLabel: { fr: "Type de projet", en: "Project type" },
    typePlaceholder: { fr: "Sélectionner…", en: "Select…" },
    projectTypes: [...DEFAULT_PROJECT_TYPES],
    messageLabel: { fr: "Votre message", en: "Your message" },
    messagePlaceholder: { fr: "Racontez-nous votre projet…", en: "Tell us about your project…" },
    submitButton: { fr: "Envoyer", en: "Send" },
    noticeText: {
      fr: "Les informations transmises servent uniquement à répondre à votre demande et préparer une éventuelle prestation.",
      en: "The information you provide is used only to answer your request and prepare a possible project.",
    },
    privacyPolicyText: {
      fr: "Politique de confidentialité",
      en: "Privacy policy",
    },
    privacyPolicyUrl: "",
  },
  card: {
    title: { fr: "Coordonnées", en: "Details" },
    emailLabel: { fr: "Email", en: "Email" },
    phoneLabel: { fr: "Téléphone", en: "Phone" },
    phone: "",
    socialLabel: { fr: "Réseaux", en: "Social" },
    responseTimeNotice: {
      fr: "Nous répondons sous 48h.",
      en: "We reply within 48h.",
    },
  },
  messages: {
    successTitle: {
      fr: "Message envoyé avec succès",
      en: "Message sent successfully",
    },
    successMessage: {
      fr: "Merci pour votre message. Nous reviendrons vers vous dans les meilleurs délais.",
      en: "Thank you for your message. We will get back to you as soon as possible.",
    },
    unavailableMessage: {
      fr: "Le formulaire de contact est temporairement indisponible. Veuillez nous écrire directement par e-mail.",
      en: "The contact form is temporarily unavailable. Please write to us directly by email.",
    },
    genericError: {
      fr: "Une erreur est survenue lors de l'envoi de votre message. Veuillez vérifier vos informations et réessayer.",
      en: "An error occurred while sending your message. Please check your information and try again.",
    },
  },
};

export interface SiteContentV1 {
  schemaVersion: 1;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  media?: Record<string, UploadedMediaMetadata>;
}

export interface SiteContent {
  schemaVersion: 2;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  contactPage: ContactPageContent;
  media?: Record<string, UploadedMediaMetadata>;
}
