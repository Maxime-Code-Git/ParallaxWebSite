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
  route("admin/logout", "routes/admin/logout.tsx"),

  // Media API & Public variants serving
  route("api/admin/media-upload", "routes/api/admin-media-upload.ts"),
  route("api/admin/portfolio-upload", "routes/api/admin-portfolio-upload.ts"),
  route("media/site/:location/:imageId/:variant/:ext", "routes/media/site-variant.ts"),
  route("media/portfolio/:ownerType/:ownerId/:slot/:imageId/:variant/:ext", "routes/media/portfolio-variant.ts"),
  route("admin/media/portfolio/:ownerType/:ownerId/:slot/:imageId/:variant/:ext", "routes/admin/portfolio-media.ts"),
] satisfies RouteConfig;
