import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      "@parallax/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts"
      ),
    },
    dedupe: ["react", "react-dom", "react-router"],
  },
  optimizeDeps: {
    exclude: ["@node-rs/argon2"],
  },
  css: {
    modules: {
      localsConvention: "camelCase",
    },
  },
});
