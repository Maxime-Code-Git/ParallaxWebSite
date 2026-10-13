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

  it("ensures a single unified React instance across router and server renderer", async () => {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const react = req.resolve("react");
    const routerReact = createRequire(req.resolve("react-router")).resolve("react");
    const domServerReact = createRequire(req.resolve("react-dom/server")).resolve("react");

    expect(routerReact).toBe(react);
    expect(domServerReact).toBe(react);
  });
});
