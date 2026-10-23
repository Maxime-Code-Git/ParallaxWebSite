import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { execSync, spawn } from "node:child_process";
import sharp from "sharp";
import * as argon2 from "@node-rs/argon2";

// 1. Create completely isolated temporary directory with 0700 permissions
// Absolutely NEVER read from or touch ~/.parallax-data or .env.local
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-test-server-"));
fs.chmodSync(tmpDir, 0o700);

const galleryMediaDir = path.join(tmpDir, "gallery-media");
const galleryImportDir = path.join(tmpDir, "gallery-import");
const importSubDir = path.join(galleryImportDir, "session-mariage-alice-bob");
const importPhotosDir = path.join(importSubDir, "photos");
const importVideosDir = path.join(importSubDir, "videos");
const siteMediaDir = path.join(tmpDir, "site-media");
const portfolioMediaDir = path.join(tmpDir, "portfolio-media");

fs.mkdirSync(galleryMediaDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(galleryImportDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(importPhotosDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(importVideosDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(siteMediaDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(portfolioMediaDir, { recursive: true, mode: 0o700 });

// 2. Synthetic site & portfolio content (independent of user data)
const repoRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(repoRoot, "apps", "web");
const defaultSiteContentPath = path.join(appDir, "app", "content", "default-site-content.json");
fs.copyFileSync(defaultSiteContentPath, path.join(tmpDir, "site-content.json"));

const syntheticPortfolioContent = {
  projects: [],
};
fs.writeFileSync(path.join(tmpDir, "portfolio-content.json"), JSON.stringify(syntheticPortfolioContent, null, 2), { mode: 0o600 });

// 3. Generate valid synthetic photo fixtures using Sharp
console.log("Generating synthetic photo fixtures with Sharp...");
const photo1Path = path.join(importPhotosDir, "photo-01.jpg");
await sharp({
  create: {
    width: 1200,
    height: 800,
    channels: 3,
    background: { r: 35, g: 65, b: 120 },
  },
})
  .jpeg({ quality: 85 })
  .toFile(photo1Path);

const photo2Path = path.join(importPhotosDir, "photo-02.jpg");
await sharp({
  create: {
    width: 800,
    height: 1200,
    channels: 3,
    background: { r: 180, g: 80, b: 60 },
  },
})
  .jpeg({ quality: 85 })
  .toFile(photo2Path);

const photo3Path = path.join(importPhotosDir, "photo-03.webp");
await sharp({
  create: {
    width: 1000,
    height: 1000,
    channels: 3,
    background: { r: 50, g: 120, b: 80 },
  },
})
  .webp({ quality: 85 })
  .toFile(photo3Path);

// Generate native poster file fixture
const posterFile = path.join(tmpDir, "poster-native.jpg");
await sharp({
  create: {
    width: 640,
    height: 360,
    channels: 3,
    background: { r: 100, g: 40, b: 140 },
  },
})
  .jpeg({ quality: 85 })
  .toFile(posterFile);

// 4. Generate valid 1s MP4 video fixture using ffmpeg
console.log("Generating synthetic MP4 video fixture with ffmpeg...");
const videoFile = path.join(importVideosDir, "film-mariage.mp4");
execSync(`ffmpeg -y -f lavfi -i color=c=blue:s=320x180:d=1 -c:v libx264 -pix_fmt yuv420p "${videoFile}"`, {
  stdio: "ignore",
});

// 5. Hash synthetic admin password
console.log("Hashing synthetic admin password with Argon2id...");
const adminPassword = "AdminPassword2026!";
const adminHash = await argon2.hash(adminPassword, {
  algorithm: 2, // argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

// 6. Find a free loopback port (defaulting to 3847 or dynamically finding one)
async function findFreePort(preferredPort = 3847) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => {
      // Preferred port busy, ask OS for any free loopback port
      const altServer = net.createServer();
      altServer.unref();
      altServer.listen(0, "127.0.0.1", () => {
        const address = altServer.address();
        const port = typeof address === "object" && address ? address.port : 3848;
        altServer.close(() => resolve(port));
      });
    });
    server.listen(preferredPort, "127.0.0.1", () => {
      server.close(() => resolve(preferredPort));
    });
  });
}

const preferredPort = parseInt(process.env.TEST_PORT || "3847", 10);
const port = await findFreePort(preferredPort);
const baseUrl = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  PUBLIC_SITE_URL: baseUrl,
  TRUST_PROXY: "false",
  PARALLAX_LOCAL_PREVIEW: "true",
  NODE_ENV: "production",
  ADMIN_PASSWORD_HASH: adminHash,
  ADMIN_SESSION_SECRET: "admin-session-secret-at-least-32-chars-long-test!",
  GALLERY_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  GALLERY_CODE_ENCRYPTION_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  GALLERY_DB_PATH: path.join(tmpDir, "gallery.sqlite"),
  GALLERY_MEDIA_PATH: galleryMediaDir,
  GALLERY_IMPORT_PATH: galleryImportDir,
  RATE_LIMIT_DB_PATH: path.join(tmpDir, "rate-limit.sqlite"),
  RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-chars-long-test!",
  SITE_CONTENT_PATH: path.join(tmpDir, "site-content.json"),
  SITE_MEDIA_PATH: siteMediaDir,
  PORTFOLIO_CONTENT_PATH: path.join(tmpDir, "portfolio-content.json"),
  PORTFOLIO_MEDIA_PATH: portfolioMediaDir,
};

console.log(`Starting React Router production server on ${baseUrl} from ${appDir}...`);
const child = spawn(
  "npx",
  ["react-router-serve", "./build/server/index.js"],
  {
    cwd: appDir,
    stdio: "inherit",
    env,
  }
);

let isExiting = false;
const cleanup = () => {
  if (isExiting) return;
  isExiting = true;
  console.log("\nShutting down test server cleanly...");
  try {
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 1000).unref();
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
};

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

child.on("error", (err) => {
  console.error("Child process error:", err);
});

child.on("exit", (code) => {
  console.log(`Child process exited with code ${code}`);
  process.exit(code ?? 0);
});

// Wait for server health check
let ready = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`${baseUrl}/fr`);
    if (res.status === 200) {
      ready = true;
      break;
    }
  } catch {}
}

if (!ready) {
  console.error(`Server failed to respond on ${baseUrl}/fr within 20s`);
  child.kill("SIGKILL");
  process.exit(1);
}

const info = {
  port,
  baseUrl,
  adminPassword,
  tmpDir,
  importFolder: "session-mariage-alice-bob",
  photo1Path,
  videoPath: videoFile,
  posterFile,
};

fs.writeFileSync(path.join(tmpDir, "test-server-info.json"), JSON.stringify(info, null, 2), { mode: 0o600 });
fs.writeFileSync("/tmp/parallax-test-server-active.json", JSON.stringify(info, null, 2), { mode: 0o600 });

console.log("==================================================");
console.log("TEST SERVER IS RUNNING AND HEALTHY!");
console.log(`URL            : ${baseUrl}`);
console.log(`Admin URL      : ${baseUrl}/admin`);
console.log(`Admin Password : ${adminPassword}`);
console.log(`Import Folder  : session-mariage-alice-bob`);
console.log(`Tmp Dir (0700) : ${tmpDir}`);
console.log("==================================================");
