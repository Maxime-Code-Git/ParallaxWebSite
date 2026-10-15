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
    errorSummary?: LocalizedString;
    nameRequired?: LocalizedString;
    nameTooLong?: LocalizedString;
    emailRequired?: LocalizedString;
    emailInvalid?: LocalizedString;
    phoneInvalid?: LocalizedString;
    timelineInvalid?: LocalizedString;
    typeRequired?: LocalizedString;
    messageRequired?: LocalizedString;
    messageTooLong?: LocalizedString;
    sessionExpired?: LocalizedString;
    rateLimit?: LocalizedString;
    inProgress?: LocalizedString;
    uncertain?: LocalizedString;
    conflict?: LocalizedString;
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

export const DEFAULT_CONTACT_PAGE_MESSAGES = {
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
  errorSummary: {
    fr: "Veuillez corriger les erreurs ci-dessous.",
    en: "Please correct the errors below.",
  },
  nameRequired: {
    fr: "Le nom ou la raison sociale est obligatoire.",
    en: "Name or company is required.",
  },
  nameTooLong: {
    fr: "Le nom ne doit pas dépasser 100 caractères.",
    en: "Name cannot exceed 100 characters.",
  },
  emailRequired: {
    fr: "L'adresse email est obligatoire.",
    en: "Email address is required.",
  },
  emailInvalid: {
    fr: "L'adresse email est invalide.",
    en: "Email address is invalid.",
  },
  phoneInvalid: {
    fr: "Le format du numéro de téléphone est invalide.",
    en: "Phone number format is invalid.",
  },
  timelineInvalid: {
    fr: "L'échéance ne doit pas dépasser 120 caractères.",
    en: "Timeline cannot exceed 120 characters.",
  },
  typeRequired: {
    fr: "Veuillez sélectionner un type de projet valide.",
    en: "Please select a valid project type.",
  },
  messageRequired: {
    fr: "Le message est obligatoire.",
    en: "Message is required.",
  },
  messageTooLong: {
    fr: "Le message ne doit pas dépasser 5 000 caractères.",
    en: "Message cannot exceed 5,000 characters.",
  },
  sessionExpired: {
    fr: "Votre session de formulaire a expiré ou n'est plus valide. Veuillez recharger la page.",
    en: "Your form session has expired or is invalid. Please reload the page.",
  },
  rateLimit: {
    fr: "Trop de tentatives. Veuillez réessayer dans {seconds} secondes.",
    en: "Too many attempts. Please try again in {seconds} seconds.",
  },
  inProgress: {
    fr: "Un envoi identique est déjà en cours de traitement. Veuillez patienter.",
    en: "A matching submission is already being processed. Please wait.",
  },
  uncertain: {
    fr: "Le statut de transmission de votre message n'a pas pu être confirmé en raison d'un délai de communication. Pour éviter tout doublon, veuillez patienter quelques instants avant de renouveler votre demande.",
    en: "The transmission status of your message could not be confirmed due to a connection timeout. To prevent duplicates, please wait a moment before trying again.",
  },
  conflict: {
    fr: "Ce jeton de formulaire a déjà été utilisé avec un contenu différent. Veuillez rafraîchir la page pour une nouvelle soumission.",
    en: "This form session was already submitted with different content. Please refresh the page to submit a new message.",
  },
} as const;

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
    ...DEFAULT_CONTACT_PAGE_MESSAGES,
  },
};

export interface CompanyContent {
  tradeName: string;
  legalName: string;
  legalForm: string;
  address: string;
  enterpriseNumber: string;
  vatNumber: string;
  vatRegime?: string;
  publicationDirector: string;
  privacyContact: string;
  hostingProvider: string;
  hostingAddress: string;
  phone: string;
  email: string;
  instagramUrl: string;
  youtubeUrl: string;
  isPublished?: boolean;
}

export type LegalPageKey = "mentions" | "privacy" | "terms" | "cookies";
export const LEGAL_PAGE_KEYS: readonly LegalPageKey[] = [
  "mentions",
  "privacy",
  "terms",
  "cookies",
] as const;

export const LEGAL_PAGE_URLS: Record<LegalPageKey, LocalizedString> = {
  mentions: { fr: "/fr/mentions-legales", en: "/en/legal-notice" },
  privacy: { fr: "/fr/confidentialite", en: "/en/privacy-policy" },
  terms: { fr: "/fr/cgv", en: "/en/terms" },
  cookies: { fr: "/fr/cookies", en: "/en/cookies" },
};

export interface LegalSection {
  id: string;
  title: LocalizedString;
  paragraphs: LocalizedString[];
  listItems?: LocalizedString[];
}

export interface CookieInventoryItem {
  id: string;
  name: LocalizedString;
  provider: LocalizedString;
  category: "technical" | "preferences";
  purpose: LocalizedString;
  duration: LocalizedString;
  exemptionJustification?: LocalizedString;
}

export interface LegalDocument {
  seoTitle: LocalizedString;
  seoDescription: LocalizedString;
  publicTitle: LocalizedString;
  intro: LocalizedString;
  effectiveDate: string;
  version: number;
  sections: LegalSection[];
  inventory?: CookieInventoryItem[];
}

export interface LegalPageRecord {
  draft: LegalDocument;
  published: LegalDocument | null;
  lastUpdated: string;
}

export interface LegalPagesContent {
  mentions: LegalPageRecord;
  privacy: LegalPageRecord;
  terms: LegalPageRecord;
  cookies: LegalPageRecord;
}

export const DEFAULT_COMPANY_CONTENT: CompanyContent = {
  tradeName: "Parallax",
  legalName: "LS studio",
  legalForm: "",
  address: "",
  enterpriseNumber: "",
  vatNumber: "",
  vatRegime: "",
  publicationDirector: "Maxime",
  privacyContact: "contact@parallax.be",
  hostingProvider: "",
  hostingAddress: "",
  phone: "",
  email: "contact@parallax.be",
  instagramUrl: "https://instagram.com/parallax",
  youtubeUrl: "https://youtube.com/@parallax",
  isPublished: false,
};

export const DEFAULT_LEGAL_PAGES_CONTENT: LegalPagesContent = {
  mentions: {
    lastUpdated: "2026-10-15T00:00:00.000Z",
    published: null,
    draft: {
      seoTitle: {
        fr: "Mentions légales | Parallax - Studio photo & vidéo",
        en: "Legal notice | Parallax - Photo & video studio",
      },
      seoDescription: {
        fr: "Mentions légales et informations éditoriales de la plateforme Parallax.",
        en: "Legal notice and editorial information for the Parallax platform.",
      },
      publicTitle: {
        fr: "Mentions légales",
        en: "Legal notice",
      },
      intro: {
        fr: "Les présentes mentions légales précisent l'identité de l'éditeur de la plateforme Parallax, ainsi que les coordonnées d'hébergement et de contact.",
        en: "This legal notice details the publisher of the Parallax platform, as well as hosting and contact information.",
      },
      effectiveDate: "15 octobre 2026",
      version: 1,
      sections: [
        {
          id: "editor",
          title: {
            fr: "Éditeur de la plateforme",
            en: "Platform publisher",
          },
          paragraphs: [
            {
              fr: "Le site Parallax est édité par l'entité juridique exploitante LS studio.",
              en: "The Parallax website is published by the operating legal entity LS studio.",
            },
          ],
        },
        {
          id: "registration",
          title: {
            fr: "Immatriculation et coordonnées professionnelles",
            en: "Registration and business details",
          },
          paragraphs: [
            {
              fr: "Siège social et coordonnées : voir informations d'entreprise renseignées ci-dessous.",
              en: "Registered office and contact details: see company information provided below.",
            },
          ],
        },
        {
          id: "publication",
          title: {
            fr: "Responsable de la publication",
            en: "Publication director",
          },
          paragraphs: [
            {
              fr: "Le responsable de la publication est Maxime.",
              en: "The publication director is Maxime.",
            },
          ],
        },
        {
          id: "hosting",
          title: {
            fr: "Hébergement",
            en: "Hosting provider",
          },
          paragraphs: [
            {
              fr: "L'hébergement de la plateforme est assuré par des infrastructures sécurisées conformes aux normes européennes.",
              en: "Platform hosting is provided by secure infrastructures complying with European standards.",
            },
          ],
        },
        {
          id: "intellectual_property",
          title: {
            fr: "Propriété intellectuelle et droits réservés",
            en: "Intellectual property and reserved rights",
          },
          paragraphs: [
            {
              fr: "L'ensemble des photographies, vidéos, textes, éléments graphiques et sonores diffusés sur le site Parallax sont protégés par le droit d'auteur et les dispositions du Code de droit économique belge. Toute reproduction ou diffusion sans accord préalable écrit est strictement interdite.",
              en: "All photographs, videos, texts, graphic elements, and sounds published on Parallax are protected by copyright and Belgian economic law. Any unauthorized reproduction or broadcast is strictly prohibited.",
            },
          ],
        },
      ],
    },
  },
  privacy: {
    lastUpdated: "2026-10-15T00:00:00.000Z",
    published: null,
    draft: {
      seoTitle: {
        fr: "Politique de confidentialité | Parallax",
        en: "Privacy policy | Parallax",
      },
      seoDescription: {
        fr: "Engagement de confidentialité et protection des données personnelles (RGPD) du studio Parallax.",
        en: "Privacy policy and personal data protection (GDPR) of Parallax studio.",
      },
      publicTitle: {
        fr: "Politique de confidentialité",
        en: "Privacy policy",
      },
      intro: {
        fr: "Parallax attache une importance fondamentale à la protection de votre vie privée et de vos données personnelles, en stricte conformité avec le RGPD (Règlement UE 2016/679) et la législation belge.",
        en: "Parallax is committed to protecting your privacy and personal data in strict compliance with the GDPR (EU Regulation 2016/679) and Belgian legislation.",
      },
      effectiveDate: "15 octobre 2026",
      version: 1,
      sections: [
        {
          id: "data_controller",
          title: {
            fr: "1. Responsable du traitement",
            en: "1. Data controller",
          },
          paragraphs: [
            {
              fr: "Le responsable du traitement des données personnelles collectées sur le site est l'exploitant de Parallax. Pour toute question relative à vos données, vous pouvez nous écrire à l'adresse de contact dédiée.",
              en: "The data controller for personal data collected on the site is the operator of Parallax. For any question regarding your data, you can reach out via the dedicated contact email.",
            },
          ],
        },
        {
          id: "contact_requests",
          title: {
            fr: "2. Demandes de contact et devis",
            en: "2. Contact inquiries and quotes",
          },
          paragraphs: [
            {
              fr: "Lorsque vous utilisez notre formulaire de contact, nous collectons votre nom ou société, votre adresse e-mail, ainsi que facultativement votre téléphone, l'échéance souhaitée, le type de projet et le message transmis. Ces données sont traitées dans le seul but de répondre à votre demande et d'établir un devis ou d'exécuter des mesures précontractuelles. Elles ne sont jamais cédées ni exploitées à des fins de prospection non sollicitée.",
              en: "When you use our contact form, we collect your name or company, email address, and optionally your phone, timeline, project type, and message. This data is processed solely to answer your inquiry, establish a quote, or perform pre-contractual steps. It is never sold or used for unsolicited prospecting.",
            },
          ],
        },
        {
          id: "client_galleries",
          title: {
            fr: "3. Galeries privées clients et sécurité des médias",
            en: "3. Private client galleries and media security",
          },
          paragraphs: [
            {
              fr: "L'accès aux galeries privées s'effectue au moyen d'un code d'accès unique sécurisé. Une session temporaire chiffrée protège la consultation des photos et le téléchargement des médias. La durée de conservation des galeries est administrable et adaptée aux besoins de chaque projet sans suppression arbitraire automatique.",
              en: "Access to private galleries is granted through a secure unique access code. An encrypted temporary session protects photo viewing and media downloads. The retention duration of galleries is configurable by the administrator based on project requirements without arbitrary automatic deletion.",
            },
          ],
        },
        {
          id: "security_rate_limit",
          title: {
            fr: "4. Sécurité, intégrité et limitation de débit",
            en: "4. Security, integrity, and rate limiting",
          },
          paragraphs: [
            {
              fr: "Pour prévenir les attaques par force brute et garantir la disponibilité de la plateforme, les adresses IP font l'objet d'un hachage cryptographique irréversible HMAC-SHA256 avec clé secrète, dans une base de données locale restreinte. Les données d'accès glissantes sont conservées pendant une durée maximale de 15 minutes avant purge automatique.",
              en: "To prevent brute-force attacks and ensure platform availability, IP addresses undergo irreversible HMAC-SHA256 cryptographic hashing with a secret key in a restricted local database. Sliding access records are retained for a maximum of 15 minutes before automated purge.",
            },
          ],
        },
        {
          id: "external_video",
          title: {
            fr: "5. Lecteurs vidéo externes (YouTube et Vimeo)",
            en: "5. External video players (YouTube and Vimeo)",
          },
          paragraphs: [
            {
              fr: "Pour garantir votre confidentialité, aucun lecteur tiers (YouTube ou Vimeo), script, cookie tiers ou préconnexion réseau n'est chargé avant votre autorisation explicite. Vous pouvez accorder une lecture ponctuelle ou mémoriser vos préférences pour une durée maximale de 6 mois. Vos préférences sont révocables à tout moment.",
              en: "To protect your privacy, no third-party player (YouTube or Vimeo), script, third-party cookie, or network preconnection is loaded prior to your explicit authorization. You may allow a single playback or save your preferences for up to 6 months. Your preferences can be revoked at any time.",
            },
          ],
        },
        {
          id: "user_rights",
          title: {
            fr: "6. Vos droits et voies de recours (RGPD)",
            en: "6. Your rights and remedies (GDPR)",
          },
          paragraphs: [
            {
              fr: "Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation du traitement et d'opposition concernant vos données personnelles. Vous pouvez exercer ces droits en nous contactant directement. Vous disposez également du droit d'introduire une réclamation auprès de l'Autorité de Protection des Données belge (APD - www.autoriteprotectiondonnees.be).",
              en: "In accordance with the GDPR, you have the right to access, rectify, erase, restrict processing, and object to processing of your personal data. You may exercise these rights by contacting us directly. You also have the right to lodge a complaint with the Belgian Data Protection Authority (APD / GBA - www.autoriteprotectiondonnees.be).",
            },
          ],
        },
      ],
    },
  },
  terms: {
    lastUpdated: "2026-10-15T00:00:00.000Z",
    published: null,
    draft: {
      seoTitle: {
        fr: "Conditions Générales de Vente (CGV) | Parallax",
        en: "Terms of Service | Parallax",
      },
      seoDescription: {
        fr: "Conditions générales régissant les prestations audiovisuelles et photographiques de Parallax.",
        en: "Terms governing audiovisual and photographic production services provided by Parallax.",
      },
      publicTitle: {
        fr: "Conditions générales de vente",
        en: "Terms of service",
      },
      intro: {
        fr: "Les présentes conditions générales régissent l'ensemble des prestations de production audiovisuelle, réalisation de clips, photographie et direction artistique proposées par Parallax.",
        en: "These terms of service govern all audiovisual production, music video direction, photography, and art direction services provided by Parallax.",
      },
      effectiveDate: "15 octobre 2026",
      version: 1,
      sections: [
        {
          id: "scope",
          title: {
            fr: "1. Objet et champ d'application",
            en: "1. Scope of application",
          },
          paragraphs: [
            {
              fr: "Toute commande de prestation implique l'adhésion entière et sans réserve du client aux présentes conditions générales de vente, qui prévalent sur tout document contradictoire.",
              en: "Any order of services implies full and unreserved acceptance by the client of these terms, prevailing over any conflicting document.",
            },
          ],
        },
        {
          id: "quotes",
          title: {
            fr: "2. Devis, commandes et acomptes",
            en: "2. Quotes, orders, and deposits",
          },
          paragraphs: [
            {
              fr: "Chaque prestation fait l'objet d'un devis préalable détaillé stipulant la durée, les livrables attendus, les lieux de tournage et les modalités financières convenues entre les parties.",
              en: "Each service is subject to a prior detailed quote specifying duration, expected deliverables, shooting locations, and agreed financial terms.",
            },
          ],
        },
        {
          id: "delivery",
          title: {
            fr: "3. Délais de réalisation et livraison",
            en: "3. Delivery timelines and file delivery",
          },
          paragraphs: [
            {
              fr: "Les fichiers finaux (vidéos masterisées, photos haute définition) sont mis à disposition via un espace de galerie privée sécurisé ou par transfert numérique dédié.",
              en: "Final files (mastered videos, high-resolution photos) are made available through a secure private gallery or dedicated digital transfer.",
            },
          ],
        },
        {
          id: "intellectual_property",
          title: {
            fr: "4. Droits d'auteur et cession de droits",
            en: "4. Copyright and licensing",
          },
          paragraphs: [
            {
              fr: "Parallax demeure titulaire des droits de propriété intellectuelle sur les œuvres créées. Les droits d'exploitation et de diffusion cédés au client sont expressément délimités par le devis et le contrat de cession convenus.",
              en: "Parallax retains copyright in all created works. The exploitation and broadcast rights granted to the client are explicitly delimited by the quote and agreed assignment contract.",
            },
          ],
        },
        {
          id: "disputes",
          title: {
            fr: "5. Droit applicable et juridiction compétente",
            en: "5. Applicable law and jurisdiction",
          },
          paragraphs: [
            {
              fr: "Les présentes conditions sont soumises au droit belge. En cas de différend relatif à l'interprétation ou à l'exécution d'un contrat, les parties s'engagent à rechercher une solution amiable avant tout recours judiciaire devant les tribunaux compétents.",
              en: "These terms are governed by Belgian law. In the event of a dispute, the parties undertake to seek an amicable resolution prior to any legal proceedings before the competent courts.",
            },
          ],
        },
      ],
    },
  },
  cookies: {
    lastUpdated: "2026-10-15T00:00:00.000Z",
    published: null,
    draft: {
      seoTitle: {
        fr: "Politique relative aux cookies et traceurs | Parallax",
        en: "Cookie and tracking policy | Parallax",
      },
      seoDescription: {
        fr: "Inventaire des cookies techniques et gestion de vos préférences sur Parallax.",
        en: "Technical cookie inventory and preference management on Parallax.",
      },
      publicTitle: {
        fr: "Politique relative aux cookies",
        en: "Cookie policy",
      },
      intro: {
        fr: "Parallax utilise exclusivement des traceurs techniques indispensables au bon fonctionnement du site et applique une politique stricte de consentement préalable pour l'affichage des lecteurs vidéo externes.",
        en: "Parallax uses strictly necessary technical trackers required for website operation and enforces strict prior consent for external video players.",
      },
      effectiveDate: "15 octobre 2026",
      version: 1,
      sections: [
        {
          id: "what_is_cookie",
          title: {
            fr: "1. Qu'est-ce qu'un cookie ou traceur ?",
            en: "1. What is a cookie or tracker?",
          },
          paragraphs: [
            {
              fr: "Un cookie est un fichier texte de petite taille déposé sur votre terminal lors de la consultation d'un site web. Conformément aux recommandations de l'Autorité de Protection des Données (APD), les cookies strictement nécessaires au fonctionnement technique sont dispensés de consentement préalable mais font l'objet d'une information transparente dans l'inventaire ci-dessous.",
              en: "A cookie is a small text file placed on your device when browsing a website. In accordance with Belgian DPA guidance, strictly necessary technical cookies are exempt from prior consent but are documented transparently in the inventory below.",
            },
          ],
        },
        {
          id: "external_players",
          title: {
            fr: "2. Lecteurs vidéo externes (YouTube et Vimeo)",
            en: "2. Third-party video players (YouTube and Vimeo)",
          },
          paragraphs: [
            {
              fr: "Parallax ne charge aucun script, iframe ou traceur YouTube/Vimeo par défaut. Lorsque vous choisissez de visionner une vidéo, vous pouvez autoriser la lecture ponctuelle ou mémoriser votre accord pour 6 mois. Votre accord est retirable à tout instant.",
              en: "Parallax does not load any YouTube or Vimeo script, iframe, or tracker by default. When you choose to watch a video, you can authorize playback once or remember your choice for 6 months. Your consent can be withdrawn at any time.",
            },
          ],
        },
        {
          id: "manage_preferences",
          title: {
            fr: "3. Gestion et retrait de votre consentement",
            en: "3. Managing and withdrawing your consent",
          },
          paragraphs: [
            {
              fr: "Vous pouvez à tout moment modifier ou révoquer vos choix en matière de lecteurs vidéo externes à l'aide des boutons ci-dessous ou depuis le lien accessible en pied de page.",
              en: "You can modify or revoke your preferences regarding external video players at any time using the buttons below or via the footer link.",
            },
          ],
        },
      ],
      inventory: [
        {
          id: "admin_session",
          name: { fr: "__parallax_admin_session", en: "__parallax_admin_session" },
          provider: { fr: "Parallax (première partie)", en: "Parallax (first party)" },
          category: "technical",
          purpose: {
            fr: "Maintien de la session d'administration authentifiée et protection contre les attaques CSRF.",
            en: "Authenticated admin session management and CSRF attack protection.",
          },
          duration: { fr: "8 heures", en: "8 hours" },
          exemptionJustification: {
            fr: "Strictement nécessaire au service d'administration sécurisé demandé par l'exploitant.",
            en: "Strictly necessary for the secure administration service requested by the operator.",
          },
        },
        {
          id: "gallery_session",
          name: { fr: "__parallax_gallery_session", en: "__parallax_gallery_session" },
          provider: { fr: "Parallax (première partie)", en: "Parallax (first party)" },
          category: "technical",
          purpose: {
            fr: "Maintien de la session de consultation sécurisée de galerie privée pour le client authentifié.",
            en: "Maintaining the secure private gallery consultation session for the authenticated client.",
          },
          duration: { fr: "8 heures", en: "8 hours" },
          exemptionJustification: {
            fr: "Strictement nécessaire à la fourniture de la galerie privée demandée par le client.",
            en: "Strictly necessary to provide the private gallery requested by the client.",
          },
        },
        {
          id: "contact_ctx",
          name: { fr: "__parallax_contact_ctx", en: "__parallax_contact_ctx" },
          provider: { fr: "Parallax (première partie)", en: "Parallax (first party)" },
          category: "technical",
          purpose: {
            fr: "Contexte cryptographique éphémère anti-usurpation et liaison du jeton du formulaire de contact.",
            en: "Ephemeral cryptographic context anti-tampering and contact form token binding.",
          },
          duration: { fr: "2 heures", en: "2 hours" },
          exemptionJustification: {
            fr: "Strictement nécessaire à la sécurité et à l'intégrité de la transmission du message.",
            en: "Strictly necessary for security and integrity of message transmission.",
          },
        },
        {
          id: "contact_flash",
          name: { fr: "__parallax_contact_flash", en: "__parallax_contact_flash" },
          provider: { fr: "Parallax (première partie)", en: "Parallax (first party)" },
          category: "technical",
          purpose: {
            fr: "Affichage unique et temporaire du message de confirmation après soumission réussie (pattern PRG).",
            en: "Single-use temporary display of confirmation notice after submission (PRG pattern).",
          },
          duration: { fr: "60 secondes (effacé à la lecture)", en: "60 seconds (cleared upon read)" },
          exemptionJustification: {
            fr: "Strictement nécessaire au retour d'état de l'action de contact demandée.",
            en: "Strictly necessary for feedback on the requested contact action.",
          },
        },
        {
          id: "privacy_prefs",
          name: { fr: "__parallax_privacy_prefs", en: "__parallax_privacy_prefs" },
          provider: { fr: "Parallax (première partie)", en: "Parallax (first party)" },
          category: "preferences",
          purpose: {
            fr: "Mémorisation des préférences de l'utilisateur pour le chargement des lecteurs vidéo tiers YouTube et Vimeo.",
            en: "Remembering user preferences regarding third-party YouTube and Vimeo video players.",
          },
          duration: { fr: "180 jours (6 mois)", en: "180 days (6 months)" },
          exemptionJustification: {
            fr: "Traceur de préférences activé uniquement à la demande expresse de l'utilisateur.",
            en: "Preferences tracker activated only upon express user choice.",
          },
        },
      ],
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

export interface SiteContentV2 {
  schemaVersion: 2;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  contactPage: ContactPageContent;
  media?: Record<string, UploadedMediaMetadata>;
}

export interface SiteContent {
  schemaVersion: 3;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  contactPage: ContactPageContent;
  company: CompanyContent;
  legalPages: LegalPagesContent;
  media?: Record<string, UploadedMediaMetadata>;
}
