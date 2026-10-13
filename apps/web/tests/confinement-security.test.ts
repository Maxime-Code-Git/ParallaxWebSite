import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { LoaderFunctionArgs } from "react-router";
import { loader as mediaLoader } from "../app/routes/media/site-variant";
import {
  cleanupMediaDirectory,
  cleanupUnreferencedMedia,
  ensureStrictDirectoryCreated,
  verifySecurePathChain,
  SafeImageError,
} from "../app/lib/media-image.server";
import { saveSiteMediaUpdate, getRawSiteContent } from "../app/lib/site-content.server";

describe("Confinement & Symlink Traversal Protection", () => {
  let tempDir: string;
  let mediaDir: string;
  let externalDir: string;
  let contentFile: string;
  const originalEnv = process.env;

  const makeLoaderArgs = (params: Record<string, string | undefined>): LoaderFunctionArgs =>
    ({
      request: new Request(`http://localhost:3000/media/site/${params.location}/${params.imageId}/${params.variant}/${params.ext}`),
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-confinement-test-"));
    mediaDir = path.join(tempDir, "site-media");
    externalDir = path.join(tempDir, "external-target");
    contentFile = path.join(tempDir, "site-content.json");

    fs.mkdirSync(mediaDir, { mode: 0o700, recursive: true });
    fs.mkdirSync(externalDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: contentFile,
      SITE_MEDIA_PATH: mediaDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("media route symlink traversal defense", () => {
    it("returns 404 and serves 0 bytes when location component under site is a symlink", async () => {
      const imageId = "11111111-2222-4333-8444-555555555555";
      const { content } = getRawSiteContent();
      saveSiteMediaUpdate(
        "duo",
        {
          imageId,
          location: "duo",
          originalWidth: 1920,
          originalHeight: 1080,
          variants: [
            {
              name: "640p",
              width: 640,
              height: 360,
              sizeBytesWebp: 10,
              sizeBytesAvif: 10,
              fileId: `${imageId}-640p`,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        content.revision
      );

      // Create external fixture with target file
      const externalDuo = path.join(externalDir, "fake-duo");
      const externalVariantDir = path.join(externalDuo, imageId, "640p");
      fs.mkdirSync(externalVariantDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(externalVariantDir, `${imageId}-640p.webp`), "EXTERNAL_SECRET_DATA");

      // Replace site/duo with a symlink to externalDuo
      const siteDir = path.join(mediaDir, "site");
      fs.mkdirSync(siteDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(externalDuo, path.join(siteDir, "duo"));

      const res = await mediaLoader(makeLoaderArgs({
        location: "duo",
        imageId,
        variant: "640p",
        ext: "webp",
      }));

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain("EXTERNAL_SECRET_DATA");
    });

    it("returns 404 and serves 0 bytes when UUID component is a symlink", async () => {
      const imageId = "22222222-3333-4444-8555-666666666666";
      const { content } = getRawSiteContent();
      saveSiteMediaUpdate(
        "duo",
        {
          imageId,
          location: "duo",
          originalWidth: 1920,
          originalHeight: 1080,
          variants: [
            {
              name: "640p",
              width: 640,
              height: 360,
              sizeBytesWebp: 10,
              sizeBytesAvif: 10,
              fileId: `${imageId}-640p`,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        content.revision
      );

      const externalUuid = path.join(externalDir, "fake-uuid", "640p");
      fs.mkdirSync(externalUuid, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(externalUuid, `${imageId}-640p.webp`), "EXTERNAL_CONFIDENTIAL_CONTENT");

      const duoDir = path.join(mediaDir, "site", "duo");
      fs.mkdirSync(duoDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(path.join(externalDir, "fake-uuid"), path.join(duoDir, imageId));

      const res = await mediaLoader(makeLoaderArgs({
        location: "duo",
        imageId,
        variant: "640p",
        ext: "webp",
      }));

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain("EXTERNAL_CONFIDENTIAL_CONTENT");
    });

    it("returns 404 and serves 0 bytes when variant component is a symlink", async () => {
      const imageId = "33333333-4444-4555-8666-777777777777";
      const { content } = getRawSiteContent();
      saveSiteMediaUpdate(
        "duo",
        {
          imageId,
          location: "duo",
          originalWidth: 1920,
          originalHeight: 1080,
          variants: [
            {
              name: "640p",
              width: 640,
              height: 360,
              sizeBytesWebp: 10,
              sizeBytesAvif: 10,
              fileId: `${imageId}-640p`,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        content.revision
      );

      const externalVariant = path.join(externalDir, "fake-variant");
      fs.mkdirSync(externalVariant, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(externalVariant, `${imageId}-640p.webp`), "EXTERNAL_VARIANT_LEAK");

      const mediaUuidDir = path.join(mediaDir, "site", "duo", imageId);
      fs.mkdirSync(mediaUuidDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(externalVariant, path.join(mediaUuidDir, "640p"));

      const res = await mediaLoader(makeLoaderArgs({
        location: "duo",
        imageId,
        variant: "640p",
        ext: "webp",
      }));

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain("EXTERNAL_VARIANT_LEAK");
    });

    it("returns 404 and serves 0 bytes when leaf file is a symlink to external file", async () => {
      const imageId = "44444444-5555-4666-8777-888888888888";
      const { content } = getRawSiteContent();
      saveSiteMediaUpdate(
        "duo",
        {
          imageId,
          location: "duo",
          originalWidth: 1920,
          originalHeight: 1080,
          variants: [
            {
              name: "640p",
              width: 640,
              height: 360,
              sizeBytesWebp: 10,
              sizeBytesAvif: 10,
              fileId: `${imageId}-640p`,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        content.revision
      );

      const externalTargetFile = path.join(externalDir, "secret.webp");
      fs.writeFileSync(externalTargetFile, "OUTSIDE_FILE_BYTES");

      const variantDir = path.join(mediaDir, "site", "duo", imageId, "640p");
      fs.mkdirSync(variantDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(externalTargetFile, path.join(variantDir, `${imageId}-640p.webp`));

      const res = await mediaLoader(makeLoaderArgs({
        location: "duo",
        imageId,
        variant: "640p",
        ext: "webp",
      }));

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain("OUTSIDE_FILE_BYTES");
    });
  });

  describe("cleanup and deletion symlink traversal defense", () => {
    it("refuses to follow a symlink location under site and never modifies or deletes external directory", () => {
      const unreferencedUuid = "99999999-9999-4999-8999-999999999999";
      const externalLocation = path.join(externalDir, "external-duo");
      const externalUuidDir = path.join(externalLocation, unreferencedUuid);
      fs.mkdirSync(externalUuidDir, { recursive: true, mode: 0o700 });
      const externalSampleFile = path.join(externalUuidDir, "sample.webp");
      fs.writeFileSync(externalSampleFile, "PRESERVE_ME_IMPORTANT");

      // Replace site/duo with a symlink to externalLocation
      const siteDir = path.join(mediaDir, "site");
      fs.mkdirSync(siteDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(externalLocation, path.join(siteDir, "duo"));

      const { content } = getRawSiteContent();
      cleanupUnreferencedMedia(content, mediaDir, contentFile);

      // Verify external target was untouched and NOT deleted
      expect(fs.existsSync(externalUuidDir)).toBe(true);
      expect(fs.existsSync(externalSampleFile)).toBe(true);
      expect(fs.readFileSync(externalSampleFile, "utf-8")).toBe("PRESERVE_ME_IMPORTANT");
    });

    it("cleanupMediaDirectory unlinks a symlink itself without deleting the external target", () => {
      const externalTargetDir = path.join(externalDir, "real-data");
      fs.mkdirSync(externalTargetDir, { recursive: true, mode: 0o700 });
      const sensitiveFile = path.join(externalTargetDir, "data.txt");
      fs.writeFileSync(sensitiveFile, "DO_NOT_DELETE");

      const siteDir = path.join(mediaDir, "site", "duo");
      fs.mkdirSync(siteDir, { recursive: true, mode: 0o700 });
      const symlinkTarget = path.join(siteDir, "symlinked-media");
      fs.symlinkSync(externalTargetDir, symlinkTarget);

      cleanupMediaDirectory(symlinkTarget, mediaDir);

      // Symlink is removed, but real external target and its files must remain intact!
      expect(fs.existsSync(symlinkTarget)).toBe(false);
      expect(fs.existsSync(externalTargetDir)).toBe(true);
      expect(fs.existsSync(sensitiveFile)).toBe(true);
      expect(fs.readFileSync(sensitiveFile, "utf-8")).toBe("DO_NOT_DELETE");
    });
  });

  describe("verifySecurePathChain and ensureStrictDirectoryCreated validation", () => {
    it("verifySecurePathChain throws SafeImageError on any intermediate symlink", () => {
      const siteDir = path.join(mediaDir, "site");
      fs.mkdirSync(siteDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(externalDir, path.join(siteDir, "duo"));

      expect(() => {
        verifySecurePathChain(mediaDir, ["site", "duo", "child"], "directory");
      }).toThrow(SafeImageError);
    });

    it("ensureStrictDirectoryCreated throws SafeImageError if an intermediate directory is a symlink", () => {
      const siteDir = path.join(mediaDir, "site");
      fs.mkdirSync(siteDir, { recursive: true, mode: 0o700 });
      fs.symlinkSync(externalDir, path.join(siteDir, "duo"));

      expect(() => {
        ensureStrictDirectoryCreated(path.join(siteDir, "duo", "sub"), mediaDir);
      }).toThrow(SafeImageError);
    });
  });
});
