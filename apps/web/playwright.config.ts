import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60 * 1000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    actionTimeout: 10000,
    baseURL: process.env.PUBLIC_SITE_URL || "http://127.0.0.1:4174",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "node ../../node_modules/@react-router/serve/bin.cjs ./build/server/index.js",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 60 * 1000,
    env: {
      PORT: "4174",
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      TRUST_PROXY: "false",
      PUBLIC_SITE_URL: "http://127.0.0.1:4174",
      ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || "$argon2id$v=19$m=19456,t=2,p=1$poOY5+jA5fvIe0rIkLn2CA$WLtZ2dkkMRaLnGUH4NTwQNV+TjUZKcl0JnLa8wCp4gU",
      ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET || "parallax-e2e-admin-session-secret-32-chars-long!",
      RATE_LIMIT_SECRET: process.env.RATE_LIMIT_SECRET || "parallax-e2e-rate-limit-secret-32-chars-long!",
      GALLERY_SECRET: process.env.GALLERY_SECRET || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      GALLERY_CODE_ENCRYPTION_KEY: process.env.GALLERY_CODE_ENCRYPTION_KEY || "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      RATE_LIMIT_DB_PATH: process.env.RATE_LIMIT_DB_PATH || "",
      GALLERY_DB_PATH: process.env.GALLERY_DB_PATH || "",
      GALLERY_MEDIA_PATH: process.env.GALLERY_MEDIA_PATH || "",
      GALLERY_IMPORT_PATH: process.env.GALLERY_IMPORT_PATH || "",
      SITE_CONTENT_PATH: process.env.SITE_CONTENT_PATH || "",
      SITE_MEDIA_PATH: process.env.SITE_MEDIA_PATH || "",
      PORTFOLIO_CONTENT_PATH: process.env.PORTFOLIO_CONTENT_PATH || "",
      PORTFOLIO_MEDIA_PATH: process.env.PORTFOLIO_MEDIA_PATH || "",
    },
  },
});
