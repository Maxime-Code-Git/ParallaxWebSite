import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Root redirects to /fr
  index("routes/root-redirect.tsx"),

  // Public vitrine FR/EN
  route("fr", "routes/public/home.tsx", { id: "fr-home" }),
  route("en", "routes/public/home.tsx", { id: "en-home" }),
  route("fr/studio", "routes/public/studio.tsx", { id: "fr-studio" }),
  route("en/studio", "routes/public/studio.tsx", { id: "en-studio" }),

  // Administration
  route("admin", "routes/admin/login.tsx"),
  route("admin/dashboard", "routes/admin/dashboard.tsx"),
  route("admin/home", "routes/admin/home.tsx"),
  route("admin/studio", "routes/admin/studio.tsx"),
  route("admin/logout", "routes/admin/logout.tsx"),

  // Media API & Public variants serving
  route("api/admin/media-upload", "routes/api/admin-media-upload.ts"),
  route("media/site/:location/:imageId/:variant/:ext", "routes/media/site-variant.ts"),
] satisfies RouteConfig;
