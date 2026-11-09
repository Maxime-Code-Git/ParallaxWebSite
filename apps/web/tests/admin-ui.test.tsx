import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminLoginPage from "../app/routes/admin/login";
import AdminPortfolioEditPage from "../app/routes/admin/portfolio-edit";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import AdminDashboardPage from "../app/routes/admin/dashboard";

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

describe("Admin UI Components", () => {
  describe("AdminLoginPage", () => {
    it("renders login form with password input and current-password autocomplete", () => {
      vi.mocked(useLoaderData).mockReturnValue({ csrfToken: "mock-csrf-token-123" });
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

      render(<AdminLoginPage />);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Administration");
      const passwordInput = screen.getByLabelText(/Mot de passe administrateur/i);
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute("type", "password");
      expect(passwordInput).toHaveAttribute("autocomplete", "current-password");

      const submitBtn = screen.getByRole("button", { name: /Se connecter/i });
      expect(submitBtn).toBeInTheDocument();
      expect(submitBtn).not.toBeDisabled();
    });

    it("displays accessible error message with role='alert' when action data contains an error", () => {
      vi.mocked(useLoaderData).mockReturnValue({ csrfToken: "mock-csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue({ error: "Identifiants invalides." });

      render(<AdminLoginPage />);

      const alertEl = screen.getByRole("alert");
      expect(alertEl).toBeInTheDocument();
      expect(alertEl).toHaveTextContent("Identifiants invalides.");
    });

    it("shows loading state when submitting", () => {
      vi.mocked(useLoaderData).mockReturnValue({ csrfToken: "mock-csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);
      vi.mocked(useNavigation).mockReturnValue({
        state: "submitting",
        location: {
          pathname: "/admin",
          search: "",
          hash: "",
          state: null,
          key: "default",
        },
        formMethod: "POST",
        formAction: "/admin",
        formEncType: "application/x-www-form-urlencoded",
        formData: new FormData(),
        json: undefined,
        text: undefined,
      });

      render(<AdminLoginPage />);

      const submitBtn = screen.getByRole("button", { name: /Connexion en cours\.\.\./i });
      expect(submitBtn).toBeInTheDocument();
      expect(submitBtn).toBeDisabled();
    });
  });

  it("adds, reorders and removes extra project videos while keeping the main video", () => {
    const content = createDefaultPortfolioContent();
    const project = content.projects[0];
    project.video = { provider: "youtube", videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
    vi.mocked(useLoaderData).mockReturnValue({
      project, categories: content.categories, contentRevision: content.revision, media: {}, csrfToken: "test-csrf",
    });
    vi.mocked(useActionData).mockReturnValue(undefined);
    vi.mocked(useNavigation).mockReturnValue({ state: "idle" } as ReturnType<typeof useNavigation>);
    const { container } = render(<AdminPortfolioEditPage />);
    fireEvent.click(screen.getByRole("button", { name: "+ Ajouter une vidéo" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Ajouter une vidéo" }));
    fireEvent.change(screen.getByLabelText("Vidéo supplémentaire 1"), { target: { value: "https://vimeo.com/123456701" } });
    fireEvent.change(screen.getByLabelText("Vidéo supplémentaire 2"), { target: { value: "https://vimeo.com/123456702" } });
    fireEvent.click(screen.getByRole("button", { name: "Monter la vidéo supplémentaire 2" }));
    const submittedVideos = () => JSON.parse(container.querySelector<HTMLInputElement>('input[name="additionalVideos"]')!.value);
    expect(submittedVideos().map(({ url }: { url: string }) => url)).toEqual(["https://vimeo.com/123456702", "https://vimeo.com/123456701"]);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vidéo supplémentaire 2" }));
    expect(submittedVideos().map(({ url }: { url: string }) => url)).toEqual(["https://vimeo.com/123456702"]);
    expect(screen.getByLabelText("Lien YouTube ou Vimeo")).toHaveValue(project.video.url);
  });

  describe("AdminDashboardPage", () => {
    it("renders dashboard header, logout button, and 8 unavailable module cards", () => {
      vi.mocked(useLoaderData).mockReturnValue({ csrfToken: "dash-token-456" });
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

      render(<AdminDashboardPage />);

      expect(screen.getByText("Administration Parallax")).toBeInTheDocument();
      expect(screen.getByText("Session active")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Se deconnecter/i })).toBeInTheDocument();

      const expectedModules = [
        "Accueil",
        "Projets et portfolio",
        "Studio",
        "Passerelle StudioLM",
        "Contact",
        "Paramètres de l'entreprise",
        "Galeries clients",
        "Conservation et suppression",
        "Pages légales et cookies",
      ];

      for (const modTitle of expectedModules) {
        expect(screen.getByRole("heading", { level: 3, name: modTitle })).toBeInTheDocument();
      }

      const activeBadges = screen.getAllByText("Actif");
      expect(activeBadges.length).toBe(9);

      const nextLotBadges = screen.queryAllByText("Lot suivant");
      expect(nextLotBadges.length).toBe(0);
    });
  });
});
