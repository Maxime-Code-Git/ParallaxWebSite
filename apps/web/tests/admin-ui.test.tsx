import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    fireEvent.change(screen.getByLabelText("Titre de la vidéo principale (FR) · facultatif"), { target: { value: "Film principal" } });
    fireEvent.change(screen.getByLabelText("Titre de la vidéo supplémentaire 2 (FR) · facultatif"), { target: { value: "Les coulisses" } });
    fireEvent.click(screen.getByRole("button", { name: "Monter la vidéo supplémentaire 2" }));
    const submittedVideos = () => JSON.parse(container.querySelector<HTMLInputElement>('input[name="additionalVideos"]')!.value);
    expect(submittedVideos().map(({ url }: { url: string }) => url)).toEqual(["https://vimeo.com/123456702", "https://vimeo.com/123456701"]);
    expect(submittedVideos()[0].title).toEqual({ fr: "Les coulisses", en: "" });
    expect(container.querySelector<HTMLInputElement>('input[name="videoTitleFr"]')?.value).toBe("Film principal");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vidéo supplémentaire 2" }));
    expect(submittedVideos().map(({ url }: { url: string }) => url)).toEqual(["https://vimeo.com/123456702"]);
    expect(screen.getByLabelText("Lien YouTube ou Vimeo")).toHaveValue(project.video.url);
  });

  it("uploads an independent cover to each extra video and retains it when videos are reordered", async () => {
    const content = createDefaultPortfolioContent();
    const project = content.projects[0];
    const primaryCover = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const firstCover = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const secondCover = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    project.video = { provider: "youtube", videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", coverImageId: primaryCover };
    project.additionalVideos = [
      { provider: "vimeo", videoId: "123456701", url: "https://vimeo.com/123456701" },
      { provider: "vimeo", videoId: "123456702", url: "https://vimeo.com/123456702" },
    ];
    vi.mocked(useLoaderData).mockReturnValue({
      project, categories: content.categories, contentRevision: content.revision, media: {}, csrfToken: "test-csrf",
    });
    vi.mocked(useActionData).mockReturnValue(undefined);
    vi.mocked(useNavigation).mockReturnValue({ state: "idle" } as ReturnType<typeof useNavigation>);
    const fetchMock = vi.fn();
    for (const imageId of [firstCover, secondCover]) {
      fetchMock.mockResolvedValueOnce(Response.json({
        imageId, newRevision: imageId.replaceAll("-", ""),
        metadata: {
          imageId, ownerType: "project", ownerId: project.id, mediaSlot: "video_cover",
          originalFormat: "webp", originalWidth: 640, originalHeight: 360,
          variants: [{ name: "640p", width: 640, height: 360, webpSize: 100 }],
        },
      }));
    }
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { container } = render(<AdminPortfolioEditPage />);
      const submitted = () => JSON.parse(container.querySelector<HTMLInputElement>('input[name="additionalVideos"]')!.value);
      const file = new File(["webp"], "poster.webp", { type: "image/webp" });
      fireEvent.change(screen.getByLabelText("Fichier de couverture de la vidéo supplémentaire 1"), { target: { files: [file] } });
      await waitFor(() => expect(submitted()[0].coverImageId).toBe(firstCover));
      expect(submitted()[1].coverImageId).toBeUndefined();
      expect(container.querySelector<HTMLInputElement>('input[name="videoCoverImageId"]')?.value).toBe(primaryCover);
      fireEvent.change(screen.getByLabelText("Fichier de couverture de la vidéo supplémentaire 2"), { target: { files: [file] } });
      await waitFor(() => expect(submitted()[1].coverImageId).toBe(secondCover));
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-portfolio-video-target": "additional" });
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ "x-portfolio-revision": firstCover.replaceAll("-", "") });
      fireEvent.click(screen.getByRole("button", { name: "Monter la vidéo supplémentaire 2" }));
      expect(submitted().map(({ coverImageId }: { coverImageId: string }) => coverImageId)).toEqual([secondCover, firstCover]);
      fireEvent.click(screen.getByRole("button", { name: "Supprimer la couverture de la vidéo supplémentaire 2" }));
      expect(submitted().map(({ coverImageId }: { coverImageId: string }) => coverImageId)).toEqual([secondCover, null]);
      expect(container.querySelector<HTMLInputElement>('input[name="videoCoverImageId"]')?.value).toBe(primaryCover);
    } finally {
      vi.unstubAllGlobals();
    }
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
