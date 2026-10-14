import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Root redirects to /fr
  index("routes/root-redirect.tsx"),

  // Public vitrine FR/EN
  route("fr", "routes/public/home.tsx", { id: "fr-home" }),
  route("en", "routes/public/home.tsx", { id: "en-home" }),
  route("fr/studio", "routes/public/studio.tsx", { id: "fr-studio" }),
  route("en/studio", "routes/public/studio.tsx", { id: "en-studio" }),

  // Public portfolio FR (Persistent single route container)
  route("fr/projets/:rubrique?/:slugFr?", "routes/public/portfolio.tsx", { id: "fr-portfolio" }),

  // Public portfolio EN (Persistent single route container)
  route("en/projects/:category?/:slugEn?", "routes/public/portfolio.tsx", { id: "en-portfolio" }),

  // Administration
  route("admin", "routes/admin/login.tsx"),
  route("admin/dashboard", "routes/admin/dashboard.tsx"),
  route("admin/home", "routes/admin/home.tsx"),
  route("admin/studio", "routes/admin/studio.tsx"),
  route("admin/portfolio", "routes/admin/portfolio.tsx"),
  route("admin/portfolio/:id", "routes/admin/portfolio-edit.tsx"),
  route("admin/portfolio/section/:category", "routes/admin/portfolio-section.tsx"),
  route("admin/galleries", "routes/admin/galleries-list.tsx"),
  route("admin/galleries/new", "routes/admin/galleries-new.tsx"),
  route("admin/galleries/:id", "routes/admin/galleries-edit.tsx"),
  route("admin/galleries/:id/preview", "routes/admin/galleries-preview.tsx"),
  route("admin/data-retention", "routes/admin/data-retention.tsx"),
  route("admin/data-retention/settings", "routes/admin/data-retention-settings.tsx"),
  route("admin/logout", "routes/admin/logout.tsx"),

  // Client Area Login FR/EN
  route("fr/espace-client", "routes/public/client-login.tsx", { id: "fr-client-login" }),
  route("en/client-area", "routes/public/client-login.tsx", { id: "en-client-login" }),

  // Client Gallery FR/EN
  route("fr/galerie/:publicId", "routes/public/gallery.tsx", { id: "fr-gallery" }),
  route("en/gallery/:publicId", "routes/public/gallery.tsx", { id: "en-gallery" }),

  // Client Gallery APIs
  route("api/gallery/logout", "routes/api/gallery-logout.ts"),
  route("api/gallery/:publicId/photos", "routes/api/gallery-photos.ts"),
  route("api/gallery/:publicId/media/:mediaId", "routes/api/gallery-media.ts"),
  route("api/gallery/:publicId/media/:mediaId/poster", "routes/api/gallery-media-poster.ts"),
  route("api/gallery/:publicId/download/original/:mediaId", "routes/api/gallery-download-original.ts"),
  route("api/gallery/:publicId/download", "routes/api/gallery-download.ts"),

  // Admin Gallery APIs
  route("api/admin/galleries/:id/import", "routes/api/admin-gallery-import.ts"),
  route("api/admin/galleries/:id/imports/:importId", "routes/api/admin-gallery-import-status.ts"),
  route("api/admin/galleries/:id/media/:mediaId/poster", "routes/api/admin-gallery-media-poster.ts"),
  route("api/admin/galleries/:id/media/:mediaId", "routes/api/admin-gallery-media.ts"),
  route("api/admin/data-retention/gallery-export", "routes/api/admin-gallery-export.ts"),

  // Media API & Public variants serving
  route("api/admin/media-upload", "routes/api/admin-media-upload.ts"),
  route("api/admin/portfolio-upload", "routes/api/admin-portfolio-upload.ts"),
  route("media/site/:location/:imageId/:variant/:ext", "routes/media/site-variant.ts"),
  route("media/portfolio/:ownerType/:ownerId/:slot/:imageId/:variant/:ext", "routes/media/portfolio-variant.ts"),
  route("admin/media/portfolio/:ownerType/:ownerId/:slot/:imageId/:variant/:ext", "routes/admin/portfolio-media.ts"),
] satisfies RouteConfig;
