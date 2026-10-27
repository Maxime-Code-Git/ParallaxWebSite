import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";

/**
 * Generates a valid JPEG strictly greater than 5 MB (approx 6.3 MB)
 * without loading huge fixtures into Git.
 */
async function generateValidBigJpeg(outputPath: string, seed: number): Promise<void> {
  const width = 3000;
  const height = 3000;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i * 17 + seed * 13) & 255;
    raw[i + 1] = (i * 31 + seed * 23) & 255;
    raw[i + 2] = (i * 47 + seed * 37) & 255;
  }
  const jpegBuffer = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();

  if (jpegBuffer.length <= 5 * 1024 * 1024) {
    throw new Error(`Generated JPEG size (${jpegBuffer.length} bytes) is not strictly > 5 MB`);
  }
  fs.writeFileSync(outputPath, jpegBuffer);
}

/**
 * Generates a valid WebM video file header recognized by magic bytes.
 */
function generateValidWebmVideo(outputPath: string): void {
  // WebM EBML header + Segment container
  const header = Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
    0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x02,
    0x42, 0x85, 0x81, 0x02, 0x18, 0x53, 0x80, 0x67, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
  ]);
  const padding = Buffer.alloc(4096, 0);
  fs.writeFileSync(outputPath, Buffer.concat([header, padding]));
}

test.describe("Gallery Browser Upload E2E Scenarios", () => {
  let fixturesDir: string;
  const bigJpegPaths: string[] = [];
  let videoPath: string;

  test.beforeAll(async () => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-e2e-fixtures-"));
    // Generate 6 valid JPEGs, each strictly > 5 MB
    for (let i = 1; i <= 6; i++) {
      const p = path.join(fixturesDir, `photo-e2e-${i}.jpg`);
      await generateValidBigJpeg(p, i);
      const stat = fs.statSync(p);
      expect(stat.size).toBeGreaterThan(5 * 1024 * 1024);
      bigJpegPaths.push(p);
    }

    // Generate 1 valid small WebM video
    videoPath = path.join(fixturesDir, "video-e2e-1.webm");
    generateValidWebmVideo(videoPath);
  });

  test.afterAll(() => {
    if (fixturesDir && fs.existsSync(fixturesDir)) {
      fs.rmSync(fixturesDir, { recursive: true, force: true });
    }
  });

  test("Photos: 6 valid JPEGs > 5MB with concurrency <= 2, automated scan, import pipeline, DB persistence, and client gallery verification", async ({
    page,
  }) => {
    // 1. Connect to administration
    await page.goto("/admin");
    await page.fill('input[name="password"]', process.env.E2E_ADMIN_PASSWORD || "AdminSecret123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/dashboard/);

    // 2. Create a gallery with future expiration date
    await page.goto("/admin/galleries/new");
    const galleryTitle = `Projet Horizon Photos ${Date.now()}`;
    await page.fill('input[name="title"]', galleryTitle);
    await page.fill('input[name="clientName"]', "Horizon Studio");
    await page.fill('input[name="projectDate"]', "2026-10-27");
    await page.fill('input[name="expiresAt"]', "2030-12-31");
    await page.click('button[type="submit"]');

    // Wait for redirect to gallery edit page (not staying on /new)
    await page.waitForURL((url) => url.pathname.startsWith("/admin/galleries/") && !url.pathname.endsWith("/new"));
    const galleryId = page.url().split("/admin/galleries/")[1].split("/")[0].split("?")[0];
    expect(galleryId).not.toBe("new");

    // 3. Verify automatic creation of photos/ and videos/ on disk
    const importBase = process.env.GALLERY_IMPORT_PATH!;
    const importEntries = fs.readdirSync(importBase);
    const galleryFolderEntry = importEntries.find((e) => e.includes(galleryId));
    expect(galleryFolderEntry).toBeDefined();

    const createdGalleryFolder = path.join(importBase, galleryFolderEntry!);
    expect(fs.existsSync(path.join(createdGalleryFolder, "photos"))).toBe(true);
    expect(fs.existsSync(path.join(createdGalleryFolder, "videos"))).toBe(true);
    expect(fs.existsSync(path.join(createdGalleryFolder, ".tmp_uploads"))).toBe(true);

    // Setup network monitoring for chunked uploads and concurrency tracking
    let activeUploads = 0;
    let maxObservedConcurrency = 0;
    const monitoredResponses: { url: string; status: number; action: string }[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (url.includes(`/api/admin/gallery-upload/${galleryId}`) && req.method() === "POST") {
        activeUploads++;
        if (activeUploads > maxObservedConcurrency) {
          maxObservedConcurrency = activeUploads;
        }
      }
    });

    page.on("response", (res) => {
      const url = res.url();
      if (url.includes(`/api/admin/gallery-upload/${galleryId}`)) {
        if (res.request().method() === "POST") {
          activeUploads--;
        }
        let action = "other";
        if (url.includes("action=init")) action = "init";
        else if (url.includes("action=chunk")) action = "chunk";
        else if (url.includes("action=status")) action = "status";
        else if (url.includes("action=finalize")) action = "finalize";
        monitoredResponses.push({ url, status: res.status(), action });
      }
    });

    // 4. Select the six JPEG files in one go
    const photoInput = page.locator('input[data-testid="photo-file-input"]');
    await photoInput.setInputFiles(bigJpegPaths);

    // 8. Wait for exact batch success message without clicking retry
    const batchSuccess = page.locator('p[role="status"]').filter({
      hasText: "Tous les fichiers ont été envoyés avec succès",
    });
    await expect(batchSuccess).toBeVisible({ timeout: 90000 });
    await expect(batchSuccess).toContainText("6 photo(s), 0 vidéo(s)");

    // 9. Verify total absence of alert
    await expect(page.locator('[role="alert"]').filter({ hasText: "Échec" })).toHaveCount(0);

    // 6. Verify that all monitored upload responses succeeded (HTTP 200)
    expect(monitoredResponses.length).toBeGreaterThan(0);
    for (const r of monitoredResponses) {
      expect(r.status, `Requête ${r.action} (${r.url}) doit réussir avec statut 200`).toBe(200);
    }
    expect(monitoredResponses.some((r) => r.action === "init")).toBe(true);
    expect(monitoredResponses.some((r) => r.action === "chunk")).toBe(true);
    expect(monitoredResponses.some((r) => r.action === "finalize")).toBe(true);

    // 7. Verify browser concurrency never exceeded 2
    expect(maxObservedConcurrency).toBeGreaterThan(0);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);

    // 10. Verify presence of six final files on disk
    const photosDir = path.join(createdGalleryFolder, "photos");
    for (const p of bigJpegPaths) {
      const base = path.basename(p);
      expect(fs.existsSync(path.join(photosDir, base)), `Fichier ${base} doit exister dans photos/`).toBe(true);
    }

    // 11. Verify absence of .part, .tmp, residual chunks, and distinguish finalized receipts from orphan sessions
    for (const f of fs.readdirSync(photosDir)) {
      expect(f.endsWith(".part"), `Aucun .part résiduel dans photos/ (${f})`).toBe(false);
      expect(f.endsWith(".tmp"), `Aucun .tmp résiduel dans photos/ (${f})`).toBe(false);
    }
    const tempDir = path.join(createdGalleryFolder, ".tmp_uploads");
    if (fs.existsSync(tempDir)) {
      const sessionEntries = fs.readdirSync(tempDir);
      for (const s of sessionEntries) {
        const sessionPath = path.join(tempDir, s);
        if (!fs.statSync(sessionPath).isDirectory()) continue;
        const receiptPath = path.join(sessionPath, "finalized.json");
        // Must be a preserved finalized receipt, not an orphan active session
        expect(fs.existsSync(receiptPath), `La session ${s} doit être un reçu finalisé conservé`).toBe(true);

        // Verify absence of residual temporary chunks or assembly files
        const sessionFiles = fs.readdirSync(sessionPath);
        for (const file of sessionFiles) {
          expect(file.startsWith("chunk_"), `Aucun morceau résiduel (${file}) dans ${s}`).toBe(false);
          expect(file.endsWith(".part"), `Aucun .part résiduel (${file}) dans ${s}`).toBe(false);
          expect(file.endsWith(".tmp"), `Aucun .tmp résiduel (${file}) dans ${s}`).toBe(false);
        }
      }
    }

    // 12. Verify automatic analysis: 6 photos, 0 video
    await expect(page.getByText(/Photos valides\s*:\s*6/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Vidéos valides\s*:\s*0/i)).toBeVisible();

    // 13. Confirm import via real existing button
    const startImportBtn = page.getByRole("button", { name: "Démarrer l'import", exact: true });
    await expect(startImportBtn).toBeVisible({ timeout: 10000 });
    await startImportBtn.click();

    // 14. Await real end of the worker
    await expect(page.getByText("Importation terminée avec succès.")).toBeVisible({ timeout: 60000 });

    // 15. Verify persistence in SQLite database
    const dbPath = process.env.GALLERY_DB_PATH!;
    const db = new DatabaseSync(dbPath);
    const countRow = db.prepare("SELECT count(*) as count FROM gallery_media WHERE gallery_id = ?").get(galleryId) as {
      count: number;
    };
    expect(countRow.count).toBe(6);

    // 16. Reload administration and publish the gallery
    await page.reload();

    const publishBtn = page.getByRole("button", { name: "Publier la galerie" });
    if (await publishBtn.isVisible()) {
      await publishBtn.click();
      await expect(page.getByText(/La galerie est maintenant publiée/i)).toBeVisible({ timeout: 10000 });
    }

    // Retrieve unique access code and public_id
    await page.getByRole("button", { name: "Révéler" }).click();
    const codeDisplay = page.locator('[class*="codeDisplay"]');
    const clientCode = (await codeDisplay.textContent())?.trim();
    expect(clientCode).toBeTruthy();
    expect(clientCode).not.toContain("••••••");

    const galRow = db.prepare("SELECT public_id FROM galleries WHERE id = ?").get(galleryId) as { public_id: string };
    const publicId = galRow.public_id;
    db.close();

    // 17. Connect to client gallery with its unique code
    await page.goto("/fr/espace-client");
    await page.fill('input[name="code"]', clientCode!);
    await page.click('button[type="submit"]');

    // 18. Verify that the six media are visible in client gallery
    await page.waitForURL(new RegExp(`/fr/galerie/${publicId}`));
    await expect(page.locator('[class*="photoCard"]')).toHaveCount(6, { timeout: 15000 });
  });

  test("Videos: valid WebM video upload, automated scan, import pipeline, and client gallery verification", async ({
    page,
  }) => {
    // 1. Connect to administration
    await page.goto("/admin");
    await page.fill('input[name="password"]', process.env.E2E_ADMIN_PASSWORD || "AdminSecret123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/dashboard/);

    // 2. Create a gallery
    await page.goto("/admin/galleries/new");
    const galleryTitle = `Projet Horizon Video ${Date.now()}`;
    await page.fill('input[name="title"]', galleryTitle);
    await page.fill('input[name="clientName"]', "Horizon Video Studio");
    await page.fill('input[name="projectDate"]', "2026-10-27");
    await page.fill('input[name="expiresAt"]', "2030-12-31");
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => url.pathname.startsWith("/admin/galleries/") && !url.pathname.endsWith("/new"));
    const galleryId = page.url().split("/admin/galleries/")[1].split("/")[0].split("?")[0];
    expect(galleryId).not.toBe("new");

    // Select video file
    const videoInput = page.locator('input[data-testid="video-file-input"]');
    await videoInput.setInputFiles([videoPath]);

    // Wait for exact batch success message
    const batchSuccess = page.locator('p[role="status"]').filter({
      hasText: "Tous les fichiers ont été envoyés avec succès",
    });
    await expect(batchSuccess).toBeVisible({ timeout: 60000 });
    await expect(batchSuccess).toContainText("0 photo(s), 1 vidéo(s)");

    // Verify automatic analysis: 0 photo, 1 video
    await expect(page.getByText(/Photos valides\s*:\s*0/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Vidéos valides\s*:\s*1/i)).toBeVisible();

    // Confirm import
    const startImportBtn = page.getByRole("button", { name: "Démarrer l'import", exact: true });
    await expect(startImportBtn).toBeVisible({ timeout: 10000 });
    await startImportBtn.click();

    // Await completion
    await expect(page.getByText("Importation terminée avec succès.")).toBeVisible({ timeout: 60000 });

    // Verify in SQLite database
    const dbPath = process.env.GALLERY_DB_PATH!;
    const db = new DatabaseSync(dbPath);
    const mediaRow = db.prepare("SELECT media_type FROM gallery_media WHERE gallery_id = ?").get(galleryId) as {
      media_type: string;
    };
    expect(mediaRow).toBeDefined();
    expect(mediaRow.media_type).toBe("video");

    // Publish gallery
    await page.reload();
    const publishBtn = page.getByRole("button", { name: "Publier la galerie" });
    if (await publishBtn.isVisible()) {
      await publishBtn.click();
      await expect(page.getByText(/La galerie est maintenant publiée/i)).toBeVisible({ timeout: 10000 });
    }

    // Retrieve unique code
    await page.getByRole("button", { name: "Révéler" }).click();
    const codeDisplay = page.locator('[class*="codeDisplay"]');
    const clientCode = (await codeDisplay.textContent())?.trim();
    expect(clientCode).toBeTruthy();

    const galRow = db.prepare("SELECT public_id FROM galleries WHERE id = ?").get(galleryId) as { public_id: string };
    const publicId = galRow.public_id;
    db.close();

    // Connect to client gallery
    await page.goto("/fr/espace-client");
    await page.fill('input[name="code"]', clientCode!);
    await page.click('button[type="submit"]');

    // Verify video is displayed
    await page.waitForURL(new RegExp(`/fr/galerie/${publicId}`));
    await expect(page.locator('[class*="videoCard"]')).toHaveCount(1, { timeout: 15000 });
  });
});
