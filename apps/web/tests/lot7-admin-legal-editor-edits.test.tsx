// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { LegalDocument, LegalPageRecord } from "../app/lib/site-content.shared";

// Mock react-router
const mockSubmit = vi.fn();
let currentFetcherData: unknown = null;
let currentFetcherState: "idle" | "submitting" | "loading" = "idle";
const fetcherListeners = new Set<() => void>();

function updateFetcher(data: unknown, state: "idle" | "submitting" | "loading" = "idle") {
  currentFetcherData = data;
  currentFetcherState = state;
  fetcherListeners.forEach((l) => l());
}

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useFetcher: () => {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setTick((t) => t + 1);
        fetcherListeners.add(listener);
        return () => {
          fetcherListeners.delete(listener);
        };
      }, []);
      return {
        submit: mockSubmit,
        data: currentFetcherData,
        state: currentFetcherState,
        Form: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
          <form {...props}>{children}</form>
        ),
      };
    },
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [k: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import { useLoaderData } from "react-router";
import AdminLegalEditPage from "../app/routes/admin/legal-edit";

describe("Lot 7 - Admin Legal Editor Unsaved Edits Lifecycle", () => {
  const baseDocument: LegalDocument = {
    publicTitle: { fr: "Titre Initial", en: "Initial Title" },
    seoTitle: { fr: "SEO FR", en: "SEO EN" },
    seoDescription: { fr: "Desc FR", en: "Desc EN" },
    intro: { fr: "Intro FR", en: "Intro EN" },
    effectiveDate: "2026-10-15",
    version: 1,
    sections: [
      {
        id: "section-1",
        title: { fr: "Section 1", en: "Section 1" },
        paragraphs: [{ fr: "Paragraphe 1", en: "Paragraph 1" }],
      },
    ],
  };

  const initialRecord: LegalPageRecord = {
    draft: baseDocument,
    published: {
      ...baseDocument,
      version: 1,
    },
    lastUpdated: "2026-10-15T12:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentFetcherData = null;
    currentFetcherState = "idle";
    fetcherListeners.clear();
    // Default window.confirm to true
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("preserves unsaved edit B typed while saving A, and does not clobber B upon subsequent unpublish", async () => {
    vi.mocked(useLoaderData).mockReturnValue({
      csrfToken: "mock-csrf-token",
      pageKey: "privacy",
      pageRecord: initialRecord,
      revision: "rev-initial-1",
      isCorrupted: false,
    });

    render(<AdminLegalEditPage />);

    // Initially published
    expect(screen.getByText(/Publié \(v1 — 2026-10-15\)/i)).toBeInTheDocument();
    expect(screen.queryByTestId("unsaved-badge")).toBeNull();

    const titleInput = screen.getByLabelText(/Titre public affiché \(FR\)/i) as HTMLInputElement;
    expect(titleInput.value).toBe("Titre Initial");

    // 1. User edits A and clicks "Enregistrer le brouillon"
    fireEvent.change(titleInput, { target: { value: "Titre A" } });
    expect(titleInput.value).toBe("Titre A");
    expect(screen.getByTestId("unsaved-badge")).toBeInTheDocument();

    const saveDraftBtn = screen.getByRole("button", { name: /Enregistrer le brouillon/i });
    fireEvent.click(saveDraftBtn);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const submittedForm = mockSubmit.mock.calls[0][0] as URLSearchParams;
    expect(submittedForm.get("intent")).toBe("save_draft");
    expect(submittedForm.get("clientEditCount")).toBe("1");
    expect(submittedForm.get("draftData")).toContain("Titre A");

    // 2. While the request is in flight, user types B!
    fireEvent.change(titleInput, { target: { value: "Titre B" } });
    expect(titleInput.value).toBe("Titre B");

    // 3. Server response for save A arrives
    const serverDraftA: LegalDocument = {
      ...baseDocument,
      publicTitle: { fr: "Titre A", en: "Initial Title" },
    };
    const updatedRecordA: LegalPageRecord = {
      ...initialRecord,
      draft: serverDraftA,
    };

    await act(async () => {
      updateFetcher({
        success: true,
        action: "save_draft",
        newRevision: "rev-saved-a-2",
        pageRecord: updatedRecordA,
        clientEditCount: "1", // Response corresponds to snapshot 1
      });
    });

    // Verification:
    // - Input MUST still be "Titre B" (NOT clobbered by server's Titre A)
    // - Unsaved badge MUST still be present (because edit count 2 > last saved count 1)
    expect(titleInput.value).toBe("Titre B");
    expect(screen.getByTestId("unsaved-badge")).toBeInTheDocument();
    expect(screen.getByText(/Révision : rev-saved-a-2/i)).toBeInTheDocument();

    // 4. User clicks "Dépublier" and confirms
    const unpublishBtn = screen.getByRole("button", { name: /Dépublier/i });
    fireEvent.click(unpublishBtn);

    expect(mockSubmit).toHaveBeenCalledTimes(2);
    const unpublishForm = mockSubmit.mock.calls[1][0] as URLSearchParams;
    expect(unpublishForm.get("intent")).toBe("unpublish");

    // 5. Unpublish response arrives (server draft is still A, but document is unpublished)
    const unpublishedRecordA: LegalPageRecord = {
      ...updatedRecordA,
      published: null,
    };

    await act(async () => {
      updateFetcher({
        success: true,
        action: "unpublish",
        newRevision: "rev-unpublished-3",
        pageRecord: unpublishedRecordA,
        clientEditCount: unpublishForm.get("clientEditCount"),
      });
    });

    // Verification:
    // - Status badge reflects unpublish: "Brouillon non publié"
    // - Titre B is STILL preserved in the input (never clobbered by A!)
    // - Unsaved badge is STILL present
    expect(screen.getByText(/Brouillon non publié/i)).toBeInTheDocument();
    expect(titleInput.value).toBe("Titre B");
    expect(screen.getByTestId("unsaved-badge")).toBeInTheDocument();
  });
});
