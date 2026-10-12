import { describe, it, expect } from "vitest";
import { APP_NAME } from "@parallax/shared";

describe("Tooling smoke test", () => {
  it("imports shared package correctly", () => {
    expect(APP_NAME).toBe("Parallax");
  });

  it("verifies DOM assertion capability in jsdom", () => {
    const el = document.createElement("div");
    el.textContent = "Parallax - socle technique";
    expect(el).toHaveTextContent("Parallax - socle technique");
  });
});
