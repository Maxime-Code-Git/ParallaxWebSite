import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  createMemoryRouter,
  createStaticHandler,
  createStaticRouter,
  RouterProvider,
  StaticRouterProvider,
} from "react-router";
import AdminPortfolioPage from "../app/routes/admin/portfolio";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";

function createLoaderData() {
  const content = createDefaultPortfolioContent();
  content.projects = content.projects.slice(0, 3).map((project, index) => ({
    ...project,
    category: "documentary",
    order: index,
    title: { fr: `Navigation projet ${index + 1}`, en: `Navigation project ${index + 1}` },
    status: index === 2 ? "draft" as const : "published" as const,
    archived: false,
    coverImageId: null,
    video: null,
    presentationMode: "photo" as const,
  }));
  return { content, csrfToken: "test-navigation-csrf" };
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("Portfolio ordering filter navigation", () => {
  it("updates React Router's location when choosing category and status", async () => {
    window.history.replaceState(null, "", "/admin/portfolio?note=keep");
    const router = createMemoryRouter([{
      path: "/admin/portfolio",
      Component: AdminPortfolioPage,
      loader: createLoaderData,
    }], { initialEntries: ["/admin/portfolio?note=keep"] });
    const view = render(<RouterProvider router={router} />);
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Documentaire \(/ }));
      await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("category")).toBe("documentary"));
      fireEvent.click(screen.getByRole("button", { name: "Publiés" }));
      await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("status")).toBe("published"));
      expect(new URLSearchParams(router.state.location.search).get("note")).toBe("keep");
      await waitFor(() => expect(screen.queryByText("Navigation projet 3")).toBeNull());
    } finally {
      view.unmount();
      router.dispose();
    }
  });

  it("keeps selected filters in the real form action URL and after revalidation", async () => {
    window.history.replaceState(null, "", "/admin/portfolio?note=keep");
    let submitted: { url: string; statusFilter: FormDataEntryValue | null } | undefined;
    const router = createMemoryRouter([{
      path: "/admin/portfolio",
      Component: AdminPortfolioPage,
      loader: createLoaderData,
      action: async ({ request }) => {
        const form = await request.formData();
        submitted = { url: request.url, statusFilter: form.get("statusFilter") };
        return Response.json({ success: "Ordre mis à jour." });
      },
    }], { initialEntries: ["/admin/portfolio?note=keep"] });
    const view = render(<RouterProvider router={router} />);
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Documentaire \(/ }));
      await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("category")).toBe("documentary"));
      fireEvent.click(screen.getByRole("button", { name: "Publiés" }));
      await waitFor(() => expect(screen.queryByText("Navigation projet 3")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Descendre le projet Navigation projet 1" }));
      await screen.findByText("Ordre mis à jour.");
      const submittedUrl = new URL(submitted!.url);
      expect(submittedUrl.searchParams.get("category")).toBe("documentary");
      expect(submittedUrl.searchParams.get("status")).toBe("published");
      expect(submittedUrl.searchParams.get("note")).toBe("keep");
      expect(submitted?.statusFilter).toBe("published");
      expect(new URLSearchParams(router.state.location.search).get("status")).toBe("published");
      expect(screen.queryByText("Navigation projet 3")).toBeNull();
    } finally {
      view.unmount();
      router.dispose();
    }
  });

  it("renders the selected status in server HTML without reading window", async () => {
    const handler = createStaticHandler([{
      path: "/admin/portfolio",
      Component: AdminPortfolioPage,
      loader: createLoaderData,
    }]);
    const context = await handler.query(new Request("http://localhost/admin/portfolio?category=documentary&status=published"));
    if (context instanceof Response) throw new Error("Unexpected redirect");
    const router = createStaticRouter(handler.dataRoutes, context);
    let html: string;
    vi.stubGlobal("window", undefined);
    try {
      html = renderToString(<StaticRouterProvider router={router} context={context} />);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(html).toContain('aria-label="Monter le projet Navigation projet 1"');
    expect(html).toContain('aria-label="Monter le projet Navigation projet 2"');
    expect(html).not.toContain('aria-label="Monter le projet Navigation projet 3"');
  });
});
