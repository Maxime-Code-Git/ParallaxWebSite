import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("admin", "routes/admin/login.tsx"),
  route("admin/dashboard", "routes/admin/dashboard.tsx"),
  route("admin/logout", "routes/admin/logout.tsx"),
] satisfies RouteConfig;
