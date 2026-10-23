import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getRawSiteContent,
  getSiteContent,
  saveContactPageContent,
  migrateSiteContentV1ToV2,
  RevisionConflictError,
  ValidationError,
} from "../app/lib/site-content.server";
import {
  type SiteContentV1,
  type ContactPageContent,
} from "../app/lib/site-content.shared";

describe("Admin Contact Content & Migration V1->V2", () => {
  let tempDir: string;
  let testContentFile: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-admin-contact-test-"));
    testContentFile = path.join(tempDir, "site-content.json");

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: testContentFile,
      PUBLIC_SITE_URL: "https://parallax.test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("V1 to V2 Migration", () => {
    it("purely and immutably migrates a V1 content structure to V2", () => {
      const v1Content: SiteContentV1 = {
        schemaVersion: 1,
        revision: "a".repeat(32),
        updatedAt: "2026-10-14T10:00:00.000Z",
        common: {
          brandName: "Parallax Test",
          navigation: {
            portfolio: { fr: "Projets", en: "Projects" },
            studio: { fr: "Studio", en: "Studio" },
            contact: { fr: "Contact", en: "Contact" },
            sempra: { fr: "SEMPRA", en: "SEMPRA" },
            clientArea: { fr: "Espace client", en: "Client area" },
          },
          footer: {
            copyright: { fr: "© 2026", en: "© 2026" },
            legalNotice: { fr: "Mentions", en: "Legal" },
            privacy: { fr: "Vie privée", en: "Privacy" },
            terms: { fr: "CGV", en: "Terms" },
            cookies: { fr: "Cookies", en: "Cookies" },
          },
        },
        home: {
          seo: { title: { fr: "FR", en: "EN" }, description: { fr: "FR", en: "EN" } },
          hero: { badge: { fr: "FR", en: "EN" }, title: { fr: "FR", en: "EN" }, subtitle: { fr: "FR", en: "EN" } },
          showreel: { title: { fr: "FR", en: "EN" }, coverImageId: "showreel-cover", coverImageAlt: { fr: "FR", en: "EN" }, videoUrl: "" },
          duo: { title: { fr: "FR", en: "EN" }, text: { fr: "FR", en: "EN" }, imageId: "duo-portrait", imageAlt: { fr: "FR", en: "EN" } },
          savoirFaire: {
            title: { fr: "FR", en: "EN" },
            photoTitle: { fr: "FR", en: "EN" },
            photoItems: [{ fr: "Photo 1", en: "Photo 1" }],
            videoTitle: { fr: "FR", en: "EN" },
            videoItems: [{ fr: "Video 1", en: "Video 1" }],
          },
          contact: {
            title: { fr: "Contact", en: "Contact" },
            emailLabel: { fr: "Email", en: "Email" },
            email: "orig@parallax.test",
            socialLabel: { fr: "Réseaux", en: "Social" },
            instagramUrl: "https://instagram.com/parallax",
            youtubeUrl: "https://youtube.com/parallax",
          },
          sempra: { badge: { fr: "FR", en: "EN" }, title: { fr: "FR", en: "EN" }, buttonText: { fr: "FR", en: "EN" }, buttonUrl: "#" },
        },
        studio: {
          seo: { title: { fr: "FR", en: "EN" }, description: { fr: "FR", en: "EN" } },
          hero: { title: { fr: "FR", en: "EN" }, text: { fr: "FR", en: "EN" } },
          team: { title: { fr: "FR", en: "EN" }, members: [] },
          approach: { title: { fr: "FR", en: "EN" }, headline: { fr: "FR", en: "EN" }, text: { fr: "FR", en: "EN" } },
        },
        media: {
          "00000000-0000-0000-0000-000000000001": {
            imageId: "00000000-0000-0000-0000-000000000001",
            location: "showreel_cover",
            originalWidth: 1920,
            originalHeight: 1080,
            variants: [{ name: "1920p", width: 1920, height: 1080, sizeBytesWebp: 1000, sizeBytesAvif: 800, fileId: "test-var" }],
            createdAt: "2026-10-14T10:00:00.000Z",
          },
        },
      };

      const v2 = migrateSiteContentV1ToV2(v1Content);

      expect(v2.schemaVersion).toBe(2);
      expect(v2.revision).toBe(v1Content.revision);
      expect(v2.updatedAt).toBe(v1Content.updatedAt);
      expect(v2.common.brandName).toBe("Parallax Test");
      expect(v2.home.contact.email).toBe("orig@parallax.test");
      expect(v2.media).toBeDefined();
      expect(v2.media!["00000000-0000-0000-0000-000000000001"].location).toBe("showreel_cover");

      // Verify contactPage defaults
      expect(v2.contactPage).toBeDefined();
      expect(v2.contactPage.form.projectTypes.length).toBe(5);
      expect(v2.contactPage.form.submitButton.fr).toBe("Envoyer");
      expect(v2.contactPage.form.submitButton.en).toBe("Send");

      // Ensure v1Content is not mutated
      expect(v1Content.schemaVersion).toBe(1);
    });

    it("automatically upgrades V1 file to V2 on disk and validates seamlessly", () => {
      // Write raw V1 content to testContentFile
      const initialContent = getSiteContent();
      const v1Content = {
        schemaVersion: 1,
        revision: "0123456789abcdef0123456789abcdef",
        updatedAt: new Date().toISOString(),
        common: initialContent.common,
        home: initialContent.home,
        studio: initialContent.studio,
        media: {},
      };
      fs.writeFileSync(testContentFile, JSON.stringify(v1Content));

      const { content, isCorrupted } = getRawSiteContent();
      expect(isCorrupted).toBe(false);
      expect(content.schemaVersion).toBe(3);
      expect(content.contactPage).toBeDefined();

      // Ensure file on disk was upgraded to current schema (V3)
      const onDisk = JSON.parse(fs.readFileSync(testContentFile, "utf-8"));
      expect(onDisk.schemaVersion).toBe(3);
      expect(onDisk.contactPage).toBeDefined();
    });
  });

  describe("Contact Page Content Mutations & Coordinates Sync", () => {
    it("saves contactPage updates and updates revision atomically", () => {
      const initial = getSiteContent();
      const updatedContact: ContactPageContent = {
        ...initial.contactPage,
        hero: {
          title: {
            fr: "Parlez-nous de votre projet.",
            en: "Tell us about your project.",
          },
        },
      };

      const newRevision = saveContactPageContent(updatedContact, initial.revision);
      expect(newRevision).toMatch(/^[0-9a-f]{32}$/);
      expect(newRevision).not.toBe(initial.revision);

      const reloaded = getSiteContent();
      expect(reloaded.revision).toBe(newRevision);
      expect(reloaded.contactPage.hero.title.fr).toBe("Parlez-nous de votre projet.");
      expect(reloaded.contactPage.hero.title.en).toBe("Tell us about your project.");
    });

    it("synchronizes public coordinates canonically between Contact and Home", () => {
      const initial = getSiteContent();
      const updatedContact: ContactPageContent = {
        ...initial.contactPage,
        card: {
          ...initial.contactPage.card,
          phone: "+32 470 99 88 77",
          responseTimeNotice: {
            fr: "Réponse sous 24h ouvrées.",
            en: "Reply within 24 business hours.",
          },
        },
      };

      const newRevision = saveContactPageContent(updatedContact, initial.revision, {
        email: "canonical-contact@parallax.be",
        instagramUrl: "https://instagram.com/parallax_official",
        youtubeUrl: "https://youtube.com/@parallax_official",
      });

      const reloaded = getSiteContent();
      expect(reloaded.revision).toBe(newRevision);

      // Verify Contact card
      expect(reloaded.contactPage.card.phone).toBe("+32 470 99 88 77");
      expect(reloaded.contactPage.card.responseTimeNotice.fr).toBe("Réponse sous 24h ouvrées.");

      // Verify Home contact section has the EXACT same canonical values
      expect(reloaded.home.contact.email).toBe("canonical-contact@parallax.be");
      expect(reloaded.home.contact.instagramUrl).toBe("https://instagram.com/parallax_official");
      expect(reloaded.home.contact.youtubeUrl).toBe("https://youtube.com/@parallax_official");
    });

    it("refuses revision conflict when saving with a stale revision", () => {
      const initial = getSiteContent();
      const staleRevision = "00000000000000000000000000000000";

      expect(() =>
        saveContactPageContent(initial.contactPage, staleRevision)
      ).toThrow(RevisionConflictError);
    });

    it("rejects invalid canonical coordinates format", () => {
      const initial = getSiteContent();

      expect(() =>
        saveContactPageContent(initial.contactPage, initial.revision, {
          email: "invalid-email-format",
        })
      ).toThrow(ValidationError);

      expect(() =>
        saveContactPageContent(initial.contactPage, initial.revision, {
          instagramUrl: "not-a-valid-http-url",
        })
      ).toThrow(ValidationError);
    });

    it("rejects invalid privacy policy URL (e.g. javascript pseudo-protocol)", () => {
      const initial = getSiteContent();
      const maliciousContact = {
        ...initial.contactPage,
        form: {
          ...initial.contactPage.form,
          privacyPolicyUrl: "javascript:alert(1)",
        },
      };

      expect(() =>
        saveContactPageContent(maliciousContact, initial.revision)
      ).toThrow(ValidationError);
    });
  });
});
