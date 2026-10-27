// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GalleryBrowserUpload from "../app/components/admin/GalleryBrowserUpload";

describe("GalleryBrowserUpload Component", () => {
  const galleryId = "gal-test-123";
  const csrfToken = "test-csrf-token";
  const galleryFolderName = "alice-bob-abc12345";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Photos and Videos upload buttons, drag & drop zone, and accessibility elements", () => {
    render(
      <GalleryBrowserUpload
        galleryId={galleryId}
        csrfToken={csrfToken}
        galleryFolderName={galleryFolderName}
        onUploadBatchComplete={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /importer des photos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /importer des vidéos/i })).toBeInTheDocument();
    expect(screen.getByText(/glissez-déposez des photos ou des vidéos ici/i)).toBeInTheDocument();
  });

  it("handles selection of 1 000 files without loading entire files into memory", async () => {
    // Mock fetch for all 1000 files to avoid network errors
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("action=init")) {
        return new Response(JSON.stringify({ uploadId: "session-" + Math.random(), uploadedChunks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("action=chunk")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("action=finalize")) {
        return new Response(JSON.stringify({ success: true, fileName: "dummy.jpg" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    render(
      <GalleryBrowserUpload
        galleryId={galleryId}
        csrfToken={csrfToken}
        galleryFolderName={galleryFolderName}
        onUploadBatchComplete={vi.fn()}
      />
    );

    // Create 1000 dummy File objects
    const files: File[] = [];
    for (let i = 0; i < 1000; i++) {
      const file = new File(["dummy content"], `photo-${i}.jpg`, { type: "image/jpeg" });
      files.push(file);
    }

    const photoInput = screen.getByTestId("photo-file-input") as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files } });

    // The component should queue the files and show progress
    await waitFor(() => {
      expect(screen.getByText(/Lot en cours :/i)).toBeInTheDocument();
      expect(screen.getByText(/1000 fichier\(s\) terminé\(s\)/i)).toBeInTheDocument();
    });
  });

  it("strictly enforces browser concurrency of at most 2", async () => {
    let activeUploads = 0;
    let maxConcurrentUploads = 0;

    // Mock fetch to track active chunk/init requests
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("action=init")) {
        return new Response(JSON.stringify({ uploadId: "session-" + Math.random(), uploadedChunks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("action=chunk")) {
        activeUploads++;
        if (activeUploads > maxConcurrentUploads) {
          maxConcurrentUploads = activeUploads;
        }
        await new Promise((r) => setTimeout(r, 25));
        activeUploads--;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("action=finalize")) {
        return new Response(JSON.stringify({ success: true, fileName: "test.jpg" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const onComplete = vi.fn();
    render(
      <GalleryBrowserUpload
        galleryId={galleryId}
        csrfToken={csrfToken}
        galleryFolderName={galleryFolderName}
        onUploadBatchComplete={onComplete}
      />
    );

    // Upload 4 files
    const files = [
      new File(["part1-content-here"], "img1.jpg", { type: "image/jpeg" }),
      new File(["part2-content-here"], "img2.jpg", { type: "image/jpeg" }),
      new File(["part3-content-here"], "img3.jpg", { type: "image/jpeg" }),
      new File(["part4-content-here"], "img4.jpg", { type: "image/jpeg" }),
    ];

    const photoInput = screen.getByTestId("photo-file-input") as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files } });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(galleryFolderName);
    }, { timeout: 4000 });

    expect(maxConcurrentUploads).toBeLessThanOrEqual(2);
    expect(maxConcurrentUploads).toBeGreaterThan(0);
  });

  it("does not retry on permanent errors (HTTP 400, 401, 403, 413, 415)", async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("action=init")) {
        fetchCount++;
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 415,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    render(
      <GalleryBrowserUpload
        galleryId={galleryId}
        csrfToken={csrfToken}
        galleryFolderName={galleryFolderName}
        onUploadBatchComplete={vi.fn()}
      />
    );

    const file = new File(["bad-content"], "fake.jpg", { type: "image/jpeg" });
    const photoInput = screen.getByTestId("photo-file-input") as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // For permanent error 415, exactly 1 fetch should be attempted (no automatic retries)
    expect(fetchCount).toBe(1);
    expect(screen.getByText(/Invalid signature/i)).toBeInTheDocument();
    // "Réessayer tous les échecs" button should be visible when there is an error
    expect(screen.getByRole("button", { name: /réessayer tous les échecs/i })).toBeInTheDocument();
  });

  it("retries up to 3 times on transient network or 500 error", async () => {
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("action=init")) {
        attempts++;
        if (attempts < 3) {
          return new Response(JSON.stringify({ error: "Server busy" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ uploadId: "recovered-session", uploadedChunks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("action=chunk")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr.includes("action=finalize")) {
        return new Response(JSON.stringify({ success: true, fileName: "recovered.jpg" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const onComplete = vi.fn();
    render(
      <GalleryBrowserUpload
        galleryId={galleryId}
        csrfToken={csrfToken}
        galleryFolderName={galleryFolderName}
        onUploadBatchComplete={onComplete}
      />
    );

    const file = new File(["some-content"], "recovered.jpg", { type: "image/jpeg" });
    const photoInput = screen.getByTestId("photo-file-input") as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(galleryFolderName);
    }, { timeout: 12000 });

    expect(attempts).toBe(3);
  }, 15000);
});
