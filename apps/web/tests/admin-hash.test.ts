// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as argon2 from "@node-rs/argon2";
import {
  validatePasswordInput,
  hashAdminPassword,
} from "../scripts/admin-hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../scripts/admin-hash.js");

describe("admin-hash.js CLI tool and shared logic", () => {
  it("rejects command line arguments with exit code 1 for security", async () => {
    await new Promise<void>((resolve, reject) => {
      execFile("node", [scriptPath, "somePasswordArgument"], (error, _stdout, stderr) => {
        try {
          expect(error).not.toBeNull();
          expect(error?.code).toBe(1);
          expect(stderr).toContain("les arguments en ligne de commande sont strictement refuses");
          resolve();
        } catch (assertionErr) {
          reject(assertionErr);
        }
      });
    });
  });

  it("rejects execution without an interactive TTY with exit code 1", async () => {
    await new Promise<void>((resolve, reject) => {
      execFile("node", [scriptPath], (error, _stdout, stderr) => {
        try {
          expect(error).not.toBeNull();
          expect(error?.code).toBe(1);
          expect(stderr).toContain("ce script necessite un terminal interactif (TTY)");
          resolve();
        } catch (assertionErr) {
          reject(assertionErr);
        }
      });
    });
  });

  it("validates password length between 12 and 256 characters and matching confirmation", () => {
    // Empty
    expect(validatePasswordInput("", "").valid).toBe(false);

    // Too short (< 12)
    expect(validatePasswordInput("short123", "short123").valid).toBe(false);

    // Too long (> 256)
    const tooLong = "A".repeat(257);
    expect(validatePasswordInput(tooLong, tooLong).valid).toBe(false);

    // Mismatched confirmation
    expect(validatePasswordInput("ValidPassword2026!", "DifferentPassword!").valid).toBe(false);

    // Valid 12 to 256 characters with matching confirmation
    const valid = validatePasswordInput("ValidPassword2026!", "ValidPassword2026!");
    expect(valid.valid).toBe(true);
  });

  it("hashAdminPassword produces valid Argon2id hash that verifies correctly", async () => {
    const rawPass = "SafeAdminPassword2026!";
    const generatedHash = await hashAdminPassword(rawPass);

    expect(generatedHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const isValid = await argon2.verify(generatedHash, rawPass);
    expect(isValid).toBe(true);
  });
});
