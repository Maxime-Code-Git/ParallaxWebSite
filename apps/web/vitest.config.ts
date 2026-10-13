import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@parallax/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts"
      ),
      "~": path.resolve(__dirname, "app"),
    },
    dedupe: ["react", "react-dom", "react-router"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    server: {
      deps: {
        inline: ["react", "react-dom", "react-router"],
      },
    },
  },
});
