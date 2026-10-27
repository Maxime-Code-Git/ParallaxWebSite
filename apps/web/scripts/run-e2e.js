#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppDir = path.resolve(__dirname, "..");

export function createE2EEnvironment(tempRoot, sourceEnv) {
  return {
    ...sourceEnv,
    PORT: "4174",
    HOST: "127.0.0.1",
    NODE_ENV: "test",
    TRUST_PROXY: "false",
    PUBLIC_SITE_URL: "http://127.0.0.1:4174",
    E2E_ADMIN_PASSWORD: "AdminSecret123!",
    ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$poOY5+jA5fvIe0rIkLn2CA$WLtZ2dkkMRaLnGUH4NTwQNV+TjUZKcl0JnLa8wCp4gU",
    ADMIN_SESSION_SECRET: "parallax-e2e-admin-session-secret-32-chars-long!",
    RATE_LIMIT_SECRET: "parallax-e2e-rate-limit-secret-32-chars-long!",
    RATE_LIMIT_DB_PATH: path.join(tempRoot, "rate-limit.sqlite"),
    GALLERY_DB_PATH: path.join(tempRoot, "gallery.sqlite"),
    GALLERY_MEDIA_PATH: path.join(tempRoot, "gallery-media"),
    GALLERY_IMPORT_PATH: path.join(tempRoot, "gallery-imports"),
    GALLERY_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    GALLERY_CODE_ENCRYPTION_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    SITE_CONTENT_PATH: path.join(tempRoot, "site-content.json"),
    SITE_MEDIA_PATH: path.join(tempRoot, "site-media"),
    PORTFOLIO_CONTENT_PATH: path.join(tempRoot, "portfolio.json"),
    PORTFOLIO_MEDIA_PATH: path.join(tempRoot, "portfolio-media"),
  };
}

async function run() {
  let e2eTempDir = "";

  try {
    // 1. Ensure build exists
    const buildServerPath = path.resolve(webAppDir, "build/server/index.js");
    if (!fs.existsSync(buildServerPath)) {
      console.log("Production build not found, building...");
      execSync("npm run build", { cwd: webAppDir, stdio: "inherit" });
    }

    // 2. Create isolated temp directory
    e2eTempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-e2e-")));

    // 3. Setup environment and required directories
    const env = createE2EEnvironment(e2eTempDir, process.env);
    Object.assign(process.env, env);

    fs.mkdirSync(env.GALLERY_MEDIA_PATH, { recursive: true, mode: 0o700 });
    fs.mkdirSync(env.GALLERY_IMPORT_PATH, { recursive: true, mode: 0o700 });
    fs.mkdirSync(env.SITE_MEDIA_PATH, { recursive: true, mode: 0o700 });
    fs.mkdirSync(env.PORTFOLIO_MEDIA_PATH, { recursive: true, mode: 0o700 });

    // 4. Run Playwright
    const args = process.argv.slice(2);
    const code = await new Promise((resolve, reject) => {
      const child = spawn("npx", ["playwright", "test", ...args], {
        stdio: "inherit",
        env: process.env,
        cwd: webAppDir,
      });

      child.on("close", (exitCode) => {
        resolve(exitCode);
      });

      child.on("error", (err) => {
        reject(err);
      });
    });

    process.exitCode = code !== null ? code : 1;
  } finally {
    if (e2eTempDir && fs.existsSync(e2eTempDir)) {
      const resolvedRoot = fs.realpathSync(os.tmpdir());
      const resolvedCandidate = fs.realpathSync(e2eTempDir);
      const relative = path.relative(resolvedRoot, resolvedCandidate);
      if (
        relative === "" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        !path.basename(resolvedCandidate).startsWith("parallax-e2e-")
      ) {
        console.error("Refusing to delete unsafe temporary directory:", e2eTempDir);
      } else {
        fs.rmSync(e2eTempDir, { recursive: true, force: true });
      }
    }
  }
}

export { run };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
