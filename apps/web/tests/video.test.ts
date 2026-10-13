import { describe, it, expect } from "vitest";
import { parseVideoUrl, getCanonicalVideoUrl, getEmbedVideoUrl } from "../app/lib/video";

describe("Video URL Parser", () => {
  it("parses YouTube standard, short, and shorts URLs", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
  });

  it("parses Vimeo standard and player URLs", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      videoId: "123456789",
    });
    expect(parseVideoUrl("https://player.vimeo.com/video/987654321")).toEqual({
      provider: "vimeo",
      videoId: "987654321",
    });
  });

  it("rejects non-https, credentials, and invalid urls", () => {
    expect(parseVideoUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://evil.com/?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("not a url")).toBeNull();
    expect(parseVideoUrl("")).toBeNull();
    expect(parseVideoUrl(null)).toBeNull();
  });

  it("generates canonical and embed urls", () => {
    const yt = { provider: "youtube" as const, videoId: "dQw4w9WgXcQ" };
    expect(getCanonicalVideoUrl(yt)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(getEmbedVideoUrl(yt)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");

    const vimeo = { provider: "vimeo" as const, videoId: "123456789" };
    expect(getCanonicalVideoUrl(vimeo)).toBe("https://vimeo.com/123456789");
    expect(getEmbedVideoUrl(vimeo)).toBe("https://player.vimeo.com/video/123456789?autoplay=1");
  });
});
