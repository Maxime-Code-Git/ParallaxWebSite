import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminGalleryEditPage from "../app/routes/admin/galleries-edit";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useRevalidator: vi.fn(() => ({ revalidate: vi.fn(), state: "idle" })),
    Form: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
      <form {...props}>{children}</form>
    ),
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [key: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import { useLoaderData, useActionData } from "react-router";

describe("AdminGalleryEditPage UI Component Rendering", () => {
  const baseGallery = {
    id: "gal-123",
    public_id: "pub-123",
    title: "Galerie Test UI",
    client_name: "Client Test",
    project_date: "2026-06-15",
    location: "Bruxelles",
    intro_fr: "Intro FR",
    intro_en: "Intro EN",
    signature_fr: "Sig FR",
    signature_en: "Sig EN",
    status: "published" as const,
    expires_at: Date.now() + 86400000,
    cover_media_id: null,
    revision: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  it("renders accessible code controls when code is available", () => {
    vi.mocked(useLoaderData).mockReturnValue({
      gallery: baseGallery,
      accessCode: "PARALLAX-ABCDE-12345",
      codeVersion: 1,
      codeStatus: "available",
      codeWarning: null,
      folders: [],
      importRootPath: "/test/import",
      csrfToken: "csrf-token-test",
      media: [],
      activeImportJob: null,
    });
    vi.mocked(useActionData).mockReturnValue(undefined);

    render(<AdminGalleryEditPage />);

    expect(screen.getByText("Code d'accès unique client")).toBeInTheDocument();
    expect(screen.getByText("Version : v1")).toBeInTheDocument();

    // Initial masked display
    expect(screen.getByText("•••••••••••••••••••••")).toBeInTheDocument();

    // Buttons must be enabled
    const revealBtn = screen.getByRole("button", { name: "Révéler" });
    const copyBtn = screen.getByRole("button", { name: "Copier" });
    const regenerateBtn = screen.getByRole("button", { name: "Régénérer le code" });

    expect(revealBtn).not.toBeDisabled();
    expect(copyBtn).not.toBeDisabled();
    expect(regenerateBtn).not.toBeDisabled();

    // Clicking Révéler toggles plain code
    fireEvent.click(revealBtn);
    expect(screen.getByText("PARALLAX-ABCDE-12345")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Masquer" })).toBeInTheDocument();

    // No error alert for unavailable code
    expect(screen.queryByText(/Code indisponible/)).not.toBeInTheDocument();
  });

  it("renders explicit warning, disables reveal/copy buttons and shows no fake code when code is unavailable", () => {
    const warningText =
      "Le code d'accès actuel ne peut pas être déchiffré avec la clé active (clé de chiffrement différente ou données altérées).";

    vi.mocked(useLoaderData).mockReturnValue({
      gallery: { ...baseGallery, status: "draft" },
      accessCode: null,
      codeVersion: 2,
      codeStatus: "unavailable",
      codeWarning: warningText,
      folders: [],
      importRootPath: "/test/import",
      csrfToken: "csrf-token-test",
      media: [],
      activeImportJob: null,
    });
    vi.mocked(useActionData).mockReturnValue(undefined);

    render(<AdminGalleryEditPage />);

    // Warning alert is visible with role="alert"
    const alerts = screen.getAllByRole("alert");
    const codeAlert = alerts.find((a) => a.textContent?.includes("Code indisponible"));
    expect(codeAlert).toBeInTheDocument();
    expect(codeAlert?.textContent).toContain(warningText);

    // Displays "Code indisponible" in code display element
    expect(screen.getByText("Code indisponible")).toBeInTheDocument();

    // Never displays plain code or fake bullets
    expect(screen.queryByText("•••••••••••••••••••••")).not.toBeInTheDocument();
    expect(screen.queryByText(/PARALLAX-/)).not.toBeInTheDocument();

    // Révéler and Copier buttons are strictly disabled
    const revealBtn = screen.getByRole("button", { name: "Révéler" });
    const copyBtn = screen.getByRole("button", { name: "Copier" });
    expect(revealBtn).toBeDisabled();
    expect(copyBtn).toBeDisabled();

    // Régénérer le code button remains active
    const regenerateBtn = screen.getByRole("button", { name: "Régénérer le code" });
    expect(regenerateBtn).not.toBeDisabled();

    // Draft warning is also present
    const draftAlert = alerts.find((a) => a.textContent?.includes("Code inactif"));
    expect(draftAlert).toBeInTheDocument();
  });
});
