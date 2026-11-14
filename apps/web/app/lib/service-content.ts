import type { ServicesContent } from "@parallax/shared";

const serviceArea = {
  fr: "Nous intervenons à Bruxelles, notamment à Uccle, ainsi qu’à Nivelles, à Ath et ailleurs en Belgique selon le projet.",
  en: "We work across Brussels, including Uccle, as well as Nivelles, Ath and elsewhere in Belgium, depending on the project.",
};

export const services = {
  photo: { paths: { fr: "/fr/photographie-bruxelles", en: "/en/photography-brussels" }, categorySlugs: ["produit", "instant-de-vie", "sports"] },
  video: { paths: { fr: "/fr/production-video-bruxelles", en: "/en/video-production-brussels" }, categorySlugs: ["publicite", "documentaire"] },
};

const defaultServices: ServicesContent = {
  area: serviceArea,
  photo: {
    title: { fr: "Photographe professionnel à Bruxelles", en: "Professional photographer in Brussels" },
    seoTitle: { fr: "Photographe professionnel à Bruxelles", en: "Professional photographer in Brussels" },
    description: {
      fr: "Maxime réalise vos photos de produits, portraits et reportages à Bruxelles, Uccle, Nivelles et Ath. Découvrez les projets photo de Parallax.",
      en: "Maxime shoots products, portraits and events in Brussels, Uccle, Nivelles and Ath. Explore Parallax's photography projects.",
    },
    intro: {
      fr: "Maxime, photographe et cofondateur de Parallax, réalise vos images pour un catalogue, un site, une campagne ou les réseaux sociaux. Il adapte la lumière, le cadrage et la série de photos à l’usage prévu.",
      en: "Maxime, photographer and co-founder of Parallax, shoots images for catalogues, websites, campaigns and social media. He adapts the lighting, framing and shot list to where the photos will be used.",
    },
    offerings: [
      {
        title: { fr: "Photo produit", en: "Product photography" },
        text: {
          fr: "Photographie de produits, du visuel sur fond uni à la mise en scène, pour l’e-commerce ou une campagne.",
          en: "Product images for online shops and campaigns, from clean backgrounds to styled sets.",
        },
      },
      {
        title: { fr: "Portraits", en: "Portraits" },
        text: {
          fr: "Portraits d’équipe, d’indépendants ou d’artistes pour une page de présentation, un dossier de presse ou un profil professionnel.",
          en: "Portraits of teams, independent professionals and artists for about pages, press kits and professional profiles.",
        },
      },
      {
        title: { fr: "Reportages et événements", en: "Events and reportage" },
        text: {
          fr: "Reportages photo pour suivre un événement, une compétition sportive ou une journée sur le terrain.",
          en: "Photo coverage for events, sporting competitions and stories on location.",
        },
      },
    ],
    linkLabel: { fr: "Découvrir la photographie", en: "Explore photography" },
    quoteLabel: { fr: "Demander un devis photo", en: "Request a photography quote" },
  },
  video: {
    title: { fr: "Production vidéo à Bruxelles", en: "Video production in Brussels" },
    seoTitle: { fr: "Production vidéo à Bruxelles", en: "Video production in Brussels" },
    description: {
      fr: "Ludovic réalise films de marque, vidéos pour les réseaux sociaux et clips à Bruxelles, Uccle, Nivelles et Ath. Découvrez les projets vidéo de Parallax.",
      en: "Ludovic makes brand films, social media videos and music videos in Brussels, Uccle, Nivelles and Ath. Explore Parallax's video projects.",
    },
    intro: {
      fr: "Ludovic, vidéaste et cofondateur de Parallax, accompagne les marques et les artistes de la préparation au montage. On définit ensemble le message, le format et le lieu du tournage selon votre projet.",
      en: "Ludovic, videographer and co-founder of Parallax, works with brands and artists from planning through editing. Together we define the message, format and filming location for your project.",
    },
    offerings: [
      {
        title: { fr: "Films de marque et de produit", en: "Brand and product films" },
        text: {
          fr: "Publicités et vidéos de présentation pour montrer un produit, un savoir-faire ou raconter l’histoire d’une marque.",
          en: "Commercials and promotional videos that showcase a product, explain a craft or tell a brand’s story.",
        },
      },
      {
        title: { fr: "Vidéos pour les réseaux sociaux", en: "Social media videos" },
        text: {
          fr: "Capsules courtes en format vertical ou horizontal, selon les canaux et les usages prévus.",
          en: "Short videos in portrait or landscape format, tailored to the channels where you’ll share them.",
        },
      },
      {
        title: { fr: "Clips et documentaires", en: "Music videos and documentaries" },
        text: {
          fr: "Clips musicaux et formats documentaires pour des projets où le récit guide le tournage et le montage.",
          en: "Music videos and documentary work where the story guides filming and editing.",
        },
      },
    ],
    linkLabel: { fr: "Découvrir la production vidéo", en: "Explore video production" },
    quoteLabel: { fr: "Demander un devis vidéo", en: "Request a video quote" },
  },
};

export function getServicesContent(site: { services?: ServicesContent }): ServicesContent {
  return site.services ?? defaultServices;
}
