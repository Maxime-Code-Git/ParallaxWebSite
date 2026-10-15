// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VideoModal, parseVideoEmbedUrl } from "../app/components/public/VideoModal";
import { PRIVACY_COOKIE_NAME } from "../app/lib/privacy-preferences.shared";
import { setClientOneTimeConsent } from "../app/lib/privacy-client";

describe("Lot 7 - Video Player APD-Compliant Consent & Immediate Revocation", () => {
  beforeEach(() => {
    // Clear cookies
    document.cookie = `${PRIVACY_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    // Clear one-time in-memory consent
    setClientOneTimeConsent("youtube", false);
    setClientOneTimeConsent("vimeo", false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parseVideoEmbedUrl strictly validates YouTube and Vimeo domains and parameters", () => {
    // Valid YouTube
    expect(parseVideoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"
    );
    expect(parseVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"
    );

    // Valid Vimeo
    expect(parseVideoEmbedUrl("https://vimeo.com/123456789")).toBe(
      "https://player.vimeo.com/video/123456789?autoplay=1&dnt=1"
    );

    // Invalid URLs
    expect(parseVideoEmbedUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoEmbedUrl("https://malicious-youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoEmbedUrl("javascript:alert(1)")).toBeNull();
    expect(parseVideoEmbedUrl("")).toBeNull();
    expect(parseVideoEmbedUrl(null)).toBeNull();
  });

  it("renders consent prompt without iframe before user action, with unchecked remember option", () => {
    render(
      <VideoModal
        isOpen={true}
        onClose={vi.fn()}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );

    // No iframe in DOM before authorization
    expect(document.querySelector("iframe")).toBeNull();

    // Notice and buttons are visible
    expect(screen.getByText(/Lecture externe \(YouTube\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Cette vidéo est hébergée par YouTube/i)).toBeInTheDocument();

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(false); // Unchecked by default

    expect(screen.getByRole("button", { name: /Accepter et lire/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refuser/i })).toBeInTheDocument();
  });

  it("accepting without remember option enables player for this session without creating persistent cookie", () => {
    render(
      <VideoModal
        isOpen={true}
        onClose={vi.fn()}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );

    const acceptBtn = screen.getByRole("button", { name: /Accepter et lire/i });
    fireEvent.click(acceptBtn);

    // Iframe is now rendered with privacy-enhanced nocookie domain
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"
    );

    // Document cookie was NOT written
    expect(document.cookie).not.toContain(`${PRIVACY_COOKIE_NAME}=`);
  });

  it("accepting with remember option triggers persistence request", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <VideoModal
        isOpen={true}
        onClose={vi.fn()}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    const acceptBtn = screen.getByRole("button", { name: /Accepter et lire/i });
    await act(async () => {
      fireEvent.click(acceptBtn);
    });

    // Fetch was called with YouTube preference
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/privacy/preferences",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ youtube: true, vimeo: false }),
      })
    );

    // Iframe is rendered
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  it("revocation in current tab immediately removes active iframe from DOM", () => {
    render(
      <VideoModal
        isOpen={true}
        onClose={vi.fn()}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );

    // Accept one-time
    const acceptBtn = screen.getByRole("button", { name: /Accepter et lire/i });
    fireEvent.click(acceptBtn);

    // Verify iframe is active
    expect(document.querySelector("iframe")).not.toBeNull();

    // User revokes consent in preferences tab / window
    act(() => {
      window.dispatchEvent(
        new CustomEvent("parallax:privacy-updated", {
          detail: { youtube: false },
        })
      );
    });

    // Iframe is IMMEDIATELY removed from DOM!
    expect(document.querySelector("iframe")).toBeNull();
    // Reverts to consent prompt
    expect(screen.getByRole("button", { name: /Accepter et lire/i })).toBeInTheDocument();
  });

  it("closing modal with Refuser or Escape key does not grant consent", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <VideoModal
        isOpen={true}
        onClose={onClose}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );

    // Escape key
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();

    // Reopen modal: consent must STILL be false, no iframe
    rerender(
      <VideoModal
        isOpen={true}
        onClose={onClose}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: /Accepter et lire/i })).toBeInTheDocument();
  });

  it("ensures no inline style attribute exists on rendered DOM elements (strict CSP adherence)", () => {
    const { container } = render(
      <VideoModal
        isOpen={true}
        onClose={vi.fn()}
        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        lang="fr"
      />
    );

    const elementsWithInlineStyle = container.querySelectorAll("[style]");
    expect(elementsWithInlineStyle.length).toBe(0);
  });
});
