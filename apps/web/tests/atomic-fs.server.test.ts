import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { atomicWriteJson, atomicWrite, getBackups } from "../app/lib/atomic-fs.server";

describe("atomic-fs.server", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-atomic-fs-test-"));
    testFile = path.join(tempDir, "test.json");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes valid JSON successfully", () => {
    atomicWriteJson(testFile, { test: true });
    expect(JSON.parse(fs.readFileSync(testFile, "utf-8"))).toEqual({ test: true });
  });

  it("writes a Buffer successfully", () => {
    const content = Buffer.from("Buffer content", "utf-8");
    atomicWrite(testFile, content);
    expect(fs.readFileSync(testFile, "utf-8")).toBe("Buffer content");
  });

  it("resists multiple backups in the same millisecond without overwriting", () => {
    fs.writeFileSync(testFile, "v0");
    vi.spyOn(Date, "now").mockReturnValue(1234567890);
    atomicWrite(testFile, "v1");
    atomicWrite(testFile, "v2");

    const backups = getBackups(testFile);
    expect(backups.length).toBe(2);
    expect(backups[0]).not.toBe(backups[1]);
    const contents = backups.map((b) => fs.readFileSync(path.join(tempDir, b), "utf-8")).sort();
    expect(contents).toEqual(["v0", "v1"]);
  });

  it("maintains exactly 5 backups maximum and rotates oldest", () => {
    fs.writeFileSync(testFile, "v0");
    for (let i = 1; i <= 7; i++) {
      vi.spyOn(Date, "now").mockReturnValue(1000000 + i * 1000);
      atomicWrite(testFile, `v${i}`);
    }
    const backups = getBackups(testFile);
    expect(backups.length).toBe(5);
    const contents = backups.map((b) => fs.readFileSync(path.join(tempDir, b), "utf-8")).sort();
    expect(contents).toEqual(["v2", "v3", "v4", "v5", "v6"]);
  });

  it("handles writeSync returning 0 and throws without modifying original", () => {
    fs.writeFileSync(testFile, "original");
    const writeSpy = vi.spyOn(fs, "writeSync").mockImplementation((() => 0) as typeof fs.writeSync);
    expect(() => atomicWriteJson(testFile, { updated: true })).toThrow("Wrote 0 bytes");
    expect(fs.readFileSync(testFile, "utf-8")).toBe("original");
    expect(fs.readdirSync(tempDir).filter((f) => f.includes(".tmp."))).toHaveLength(0);
    writeSpy.mockRestore();
  });

  it("leaves no temp files and deletes new backup on rename failure", () => {
    fs.writeFileSync(testFile, "v0");
    for (let i = 1; i <= 5; i++) {
      vi.spyOn(Date, "now").mockReturnValue(1000000 + i * 1000);
      atomicWrite(testFile, `v${i}`);
    }

    const beforeBackups = getBackups(testFile);
    expect(beforeBackups.length).toBe(5);

    vi.spyOn(Date, "now").mockReturnValue(2000000);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("Rename failed");
    });

    expect(() => atomicWrite(testFile, "v6")).toThrow("Rename failed");
    expect(fs.readFileSync(testFile, "utf-8")).toBe("v5");
    expect(fs.readdirSync(tempDir).filter((f) => f.includes(".tmp."))).toHaveLength(0);

    const afterBackups = getBackups(testFile);
    expect(afterBackups).toEqual(beforeBackups);

    renameSpy.mockRestore();
  });

  it("ensures file mode is 0600 on unix systems", () => {
    atomicWriteJson(testFile, { test: true });
    const stat = fs.statSync(testFile);
    if (os.platform() !== "win32") {
      expect((stat.mode & parseInt("777", 8)).toString(8)).toBe("600");
    }
  });
});
