// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

describe("env-loader isolation in test mode", () => {
  const originalEnv = process.env;
  const SENTINEL = "DUMMY_PARALLAX_SECRET_MUST_NOT_APPEAR";

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();

    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.includes(".env.local")) {
        return true;
      }
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.includes(".env.local")) {
        return `ADMIN_SESSION_SECRET=${SENTINEL}\n`;
      }
      if (typeof filePath === "string" && filePath.includes("package.json")) {
        return JSON.stringify({ name: "parallax" });
      }
      throw new Error(`Unexpected readFileSync call: ${String(filePath)}`);
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should NOT load .env.local when NODE_ENV=test", async () => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    process.env.NODE_ENV = "test";

    await import("../../../scripts/env-loader.js");

    const readCalls = vi.mocked(fs.readFileSync).mock.calls;
    for (const call of readCalls) {
      const pathArg = String(call[0]);
      expect(pathArg).not.toContain(".env.local");
    }

    for (const value of Object.values(process.env)) {
      if (typeof value === "string") {
        expect(value).not.toContain(SENTINEL);
      }
    }
  });

  it("should export loadEnvLocal as a callable function without auto-executing in test mode", async () => {
    process.env.NODE_ENV = "test";
    const loader = await import("../../../scripts/env-loader.js");
    expect(typeof loader.loadEnvLocal).toBe("function");

    const readCalls = vi.mocked(fs.readFileSync).mock.calls;
    for (const call of readCalls) {
      const pathArg = String(call[0]);
      expect(pathArg).not.toContain(".env.local");
    }
  });

  it("should preserve already set process.env values when loadEnvLocal is called", async () => {
    process.env.NODE_ENV = "test";
    process.env.ADMIN_SESSION_SECRET = "EXISTING_SECRET";

    const loader = await import("../../../scripts/env-loader.js");
    loader.loadEnvLocal();

    expect(process.env.ADMIN_SESSION_SECRET).toBe("EXISTING_SECRET");
  });

  it("should throw descriptive error on read failure of existing .env.local", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_SESSION_SECRET;

    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.includes(".env.local")) {
        throw new Error("EACCES permission denied");
      }
      if (typeof filePath === "string" && filePath.includes("package.json")) {
        return JSON.stringify({ name: "parallax" });
      }
      throw new Error(`Unexpected read: ${String(filePath)}`);
    });

    const loader = await import("../../../scripts/env-loader.js");
    expect(() => loader.loadEnvLocal()).toThrow("CRITICAL: Impossible de lire le fichier");
  });
});
