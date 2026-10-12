// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as argon2 from "@node-rs/argon2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../scripts/admin-hash.js");

describe("admin-hash.js CLI tool", () => {
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

  it("produces valid Argon2id hash compatible with @node-rs/argon2 verify", async () => {
    const rawPass = "SafeAdminPassword2026!";
    const generatedHash = await argon2.hash(rawPass, {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    expect(generatedHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const isValid = await argon2.verify(generatedHash, rawPass);
    expect(isValid).toBe(true);
  });
});
