import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContactPage from "../app/routes/public/contact";
import AdminContactPage from "../app/routes/admin/contact";
import { DEFAULT_CONTACT_PAGE_CONTENT } from "../app/lib/site-content.shared";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    Form: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
      <form {...props}>{children}</form>
    ),
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [key: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import { useLoaderData, useActionData, useNavigation } from "react-router";

describe("Contact UI Components", () => {
  const mockCommon = {
    brandName: "Parallax",
    navigation: {
      portfolio: { fr: "Portfolio", en: "Portfolio" },
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
  };

  const mockContent = {
    schemaVersion: 2,
    revision: "mockrevision12345678901234567890",
    updatedAt: "2026-10-15T12:00:00.000Z",
    common: mockCommon,
    home: {
      seo: { title: { fr: "Accueil", en: "Home" }, description: { fr: "", en: "" } },
      hero: { badge: { fr: "", en: "" }, title: { fr: "", en: "" }, subtitle: { fr: "", en: "" } },
      showreel: { title: { fr: "", en: "" }, coverImageId: "showreel-cover", coverImageAlt: { fr: "", en: "" }, videoUrl: "" },
      duo: { title: { fr: "", en: "" }, text: { fr: "", en: "" }, imageId: "duo-portrait", imageAlt: { fr: "", en: "" } },
      savoirFaire: { title: { fr: "", en: "" }, photoTitle: { fr: "", en: "" }, photoItems: [], videoTitle: { fr: "", en: "" }, videoItems: [] },
      contact: {
        title: { fr: "Contact", en: "Contact" },
        emailLabel: { fr: "Email", en: "Email" },
        email: "hello@parallax.test",
        socialLabel: { fr: "Réseaux", en: "Social" },
        instagramUrl: "https://instagram.com/parallax",
        youtubeUrl: "https://youtube.com/parallax",
      },
      sempra: { badge: { fr: "", en: "" }, title: { fr: "", en: "" }, buttonText: { fr: "", en: "" }, buttonUrl: "#" },
    },
    studio: {
      seo: { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      hero: { title: { fr: "", en: "" }, text: { fr: "", en: "" } },
      team: { title: { fr: "", en: "" }, members: [] },
      approach: { title: { fr: "", en: "" }, headline: { fr: "", en: "" }, text: { fr: "", en: "" } },
    },
    contactPage: {
      ...DEFAULT_CONTACT_PAGE_CONTENT,
      card: {
        ...DEFAULT_CONTACT_PAGE_CONTENT.card,
        phone: "+32 470 12 34 56",
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNavigation).mockReturnValue({
      state: "idle",
      location: undefined,
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
      json: undefined,
      text: undefined,
    });
  });

  describe("Public ContactPage", () => {
    it("renders hero title, accessible form fields, and Coordonnées card", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        content: mockContent,
        token: "mock.token.123",
        prefillType: "",
        flashSuccess: false,
        smtpAvailable: true,
      });
      vi.mocked(useActionData).mockReturnValue(undefined);
      vi.mocked(useNavigation).mockReturnValue({
        state: "idle",
        location: undefined,
        formMethod: undefined,
        formAction: undefined,
        formEncType: undefined,
        formData: undefined,
        json: undefined,
        text: undefined,
      });

      render(<ContactPage />);

      // Hero
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        mockContent.contactPage.hero.title.fr
      );

      // Form fields
      expect(screen.getByLabelText(/Nom \/ société/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Téléphone \(optionnel\)/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Échéance souhaitée/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Type de projet/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Votre message/i)).toBeInTheDocument();

      // Submit button
      const submitBtn = screen.getByRole("button", { name: /Envoyer/i });
      expect(submitBtn).toBeInTheDocument();
      expect(submitBtn).not.toBeDisabled();

      // Coordonnées card
      expect(screen.getByRole("heading", { level: 2, name: /Coordonnées/i })).toBeInTheDocument();
      expect(screen.getByText("hello@parallax.test")).toBeInTheDocument();
      expect(screen.getByText("+32 470 12 34 56")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute(
        "href",
        "https://instagram.com/parallax"
      );
      expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute(
        "href",
        "https://youtube.com/parallax"
      );
      expect(screen.getByText(/Nous répondons sous 48h/i)).toBeInTheDocument();
    });

    it("pre-fills project type select when prefillType is set in loader data", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        content: mockContent,
        token: "mock.token.123",
        prefillType: "documentary",
        flashSuccess: false,
        smtpAvailable: true,
      });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<ContactPage />);

      const select = screen.getByLabelText(/Type de projet/i) as HTMLSelectElement;
      expect(select.value).toBe("documentary");
    });

    it("renders flash success banner when flashSuccess is true", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        content: mockContent,
        token: "mock.token.123",
        prefillType: "",
        flashSuccess: true,
        smtpAvailable: true,
      });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<ContactPage />);

      const banner = screen.getByRole("status");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(mockContent.contactPage.messages.successTitle.fr);
      expect(banner).toHaveTextContent(mockContent.contactPage.messages.successMessage.fr);
    });

    it("renders field-level errors and error summary when actionData contains errors", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        content: mockContent,
        token: "mock.token.123",
        prefillType: "",
        flashSuccess: false,
        smtpAvailable: true,
      });
      vi.mocked(useActionData).mockReturnValue({
        ok: false,
        error: "Veuillez corriger les erreurs indiquées ci-dessous.",
        fieldErrors: {
          name: "Le nom ou société est requis.",
          email: "Format d'adresse e-mail invalide.",
        },
        values: {
          name: "",
          email: "bad-email",
        },
      });

      render(<ContactPage />);

      // Summary alert
      expect(screen.getByText("Veuillez corriger les erreurs indiquées ci-dessous.")).toBeInTheDocument();

      // Field error messages
      expect(screen.getByText("Le nom ou société est requis.")).toBeInTheDocument();
      expect(screen.getByText("Format d'adresse e-mail invalide.")).toBeInTheDocument();

      // Aria invalid
      const nameInput = screen.getByLabelText(/Nom \/ société/i);
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
    });

    it("disables submit button and shows loading state during form submission", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        content: mockContent,
        token: "mock.token.123",
        prefillType: "",
        flashSuccess: false,
        smtpAvailable: true,
      });
      vi.mocked(useActionData).mockReturnValue(undefined);
      vi.mocked(useNavigation).mockReturnValue({
        state: "submitting",
        location: {
          pathname: "/fr/contact",
          search: "",
          hash: "",
          state: null,
          key: "test",
        },
        formMethod: "POST",
        formAction: "/fr/contact",
        formEncType: "application/x-www-form-urlencoded",
        formData: new FormData(),
        json: undefined,
        text: undefined,
      });

      render(<ContactPage />);

      const submitBtn = screen.getByRole("button", { name: /Envoi en cours…/i });
      expect(submitBtn).toBeInTheDocument();
      expect(submitBtn).toBeDisabled();
    });

    it("resets all form fields and project type select when mounted instance receives flashSuccess", () => {
      let loaderDataState = {
        lang: "fr" as const,
        content: mockContent,
        token: "mock.token.123",
        prefillType: "",
        flashSuccess: false,
        smtpAvailable: true,
      };
      vi.mocked(useLoaderData).mockImplementation(() => loaderDataState);
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { rerender } = render(<ContactPage />);

      const nameInput = screen.getByLabelText(/Nom \/ société/i) as HTMLInputElement;
      const emailInput = screen.getByLabelText(/^Email$/i) as HTMLInputElement;
      const phoneInput = screen.getByLabelText(/Téléphone \(optionnel\)/i) as HTMLInputElement;
      const timelineInput = screen.getByLabelText(/Échéance souhaitée/i) as HTMLInputElement;
      const typeSelect = screen.getByLabelText(/Type de projet/i) as HTMLSelectElement;
      const messageTextarea = screen.getByLabelText(/Votre message/i) as HTMLTextAreaElement;

      // User fills the form
      fireEvent.change(nameInput, { target: { value: "Maxime Studio" } });
      fireEvent.change(emailInput, { target: { value: "maxime@example.com" } });
      fireEvent.change(phoneInput, { target: { value: "+32 470 11 22 33" } });
      fireEvent.change(timelineInput, { target: { value: "Juin 2027" } });
      fireEvent.change(typeSelect, { target: { value: "music-video" } });
      fireEvent.change(messageTextarea, { target: { value: "Tournage prévu à Bruxelles." } });

      expect(nameInput.value).toBe("Maxime Studio");
      expect(emailInput.value).toBe("maxime@example.com");
      expect(phoneInput.value).toBe("+32 470 11 22 33");
      expect(timelineInput.value).toBe("Juin 2027");
      expect(typeSelect.value).toBe("music-video");
      expect(messageTextarea.value).toBe("Tournage prévu à Bruxelles.");

      // Form is submitted, server accepts and PRG redirects back with flashSuccess: true
      // Component remains mounted across navigation
      loaderDataState = {
        ...loaderDataState,
        token: "new.token.456",
        flashSuccess: true,
      };
      rerender(<ContactPage />);

      // All fields including project type select MUST be reset to empty / placeholder
      expect(nameInput.value).toBe("");
      expect(emailInput.value).toBe("");
      expect(phoneInput.value).toBe("");
      expect(timelineInput.value).toBe("");
      expect(typeSelect.value).toBe("");
      expect(messageTextarea.value).toBe("");
    });

    it("does not wipe new typing if loader revalidates while flashSuccess remains true", () => {
      let loaderDataState = {
        lang: "fr" as const,
        content: mockContent,
        token: "mock.token.123",
        prefillType: "",
        flashSuccess: true,
        smtpAvailable: true,
      };
      vi.mocked(useLoaderData).mockImplementation(() => loaderDataState);
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { rerender } = render(<ContactPage />);

      const nameInput = screen.getByLabelText(/Nom \/ société/i) as HTMLInputElement;
      expect(nameInput.value).toBe("");

      // User starts typing a second message
      fireEvent.change(nameInput, { target: { value: "Second message draft" } });
      expect(nameInput.value).toBe("Second message draft");

      // Loader revalidation occurs with a new token
      loaderDataState = {
        ...loaderDataState,
        token: "refreshed.token.789",
      };
      rerender(<ContactPage />);

      // Saisie must NOT be wiped
      expect(nameInput.value).toBe("Second message draft");
    });
  });

  describe("Admin ContactPage", () => {
    it("renders heading, revision tag, live SMTP status badge, and project type toggles", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        csrfToken: "mock-csrf-token",
        contactPage: mockContent.contactPage,
        coordinates: {
          email: "admin-contact@parallax.test",
          instagramUrl: "https://instagram.com/parallax",
          youtubeUrl: "https://youtube.com/parallax",
        },
        revision: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        isCorrupted: false,
        smtpDiagnostic: {
          status: "configured",
          missing: [],
        },
      });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<AdminContactPage />);

      // Heading and revision
      expect(screen.getByRole("heading", { level: 1, name: /Administration - Contact/i })).toBeInTheDocument();
      expect(screen.getByText(/Révision: a1b2c3d4…/i)).toBeInTheDocument();

      // Live SMTP status
      expect(screen.getByText(/●\s*Configuré/)).toBeInTheDocument();

      // Project types toggles
      expect(screen.getByText("music-video")).toBeInTheDocument();
      expect(screen.getByText("advertising")).toBeInTheDocument();
      expect(screen.getByText("portrait")).toBeInTheDocument();
      expect(screen.getByText("documentary")).toBeInTheDocument();
      expect(screen.getByText("other")).toBeInTheDocument();

      // Save button
      const saveBtn = screen.getByRole("button", { name: /Enregistrer les modifications/i });
      expect(saveBtn).toBeInTheDocument();
      expect(saveBtn).not.toBeDisabled();
    });

    it("displays incomplete SMTP status badge with missing variables", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        csrfToken: "mock-csrf-token",
        contactPage: mockContent.contactPage,
        coordinates: {
          email: "admin-contact@parallax.test",
          instagramUrl: "https://instagram.com/parallax",
          youtubeUrl: "https://youtube.com/parallax",
        },
        revision: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        isCorrupted: false,
        smtpDiagnostic: {
          status: "incomplete",
          missing: ["SMTP_HOST", "SMTP_PASSWORD"],
        },
      });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<AdminContactPage />);

      expect(screen.getByText(/●\s*Incomplet/)).toBeInTheDocument();
      expect(screen.getByText("SMTP_HOST")).toBeInTheDocument();
      expect(screen.getByText("SMTP_PASSWORD")).toBeInTheDocument();
    });

    it("renders admin contact without any inline style attributes", () => {
      vi.mocked(useLoaderData).mockReturnValue({
        csrfToken: "mock-csrf-token",
        contactPage: mockContent.contactPage,
        coordinates: {
          email: "admin-contact@parallax.test",
          instagramUrl: "https://instagram.com/parallax",
          youtubeUrl: "https://youtube.com/parallax",
        },
        revision: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        isCorrupted: false,
        smtpDiagnostic: {
          status: "configured",
          missing: [],
        },
      });
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { container } = render(<AdminContactPage />);
      const styledElements = container.querySelectorAll("[style]");
      expect(styledElements.length).toBe(0);
    });
  });
});
