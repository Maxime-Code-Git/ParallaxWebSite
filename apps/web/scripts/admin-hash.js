import { createInterface } from "node:readline";
import * as argon2 from "@node-rs/argon2";

export const ARGON2_HASH_OPTIONS = {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function validatePasswordInput(password, confirmation) {
  if (!password || typeof password !== "string") {
    return { valid: false, error: "Le mot de passe est obligatoire." };
  }
  if (password.length < 12) {
    return { valid: false, error: "Le mot de passe doit comporter au moins 12 caracteres." };
  }
  if (password.length > 256) {
    return { valid: false, error: "Le mot de passe ne doit pas depasser 256 caracteres." };
  }
  if (password !== confirmation) {
    return { valid: false, error: "Les mots de passe ne correspondent pas." };
  }
  return { valid: true };
}

export async function hashAdminPassword(password) {
  return argon2.hash(password, ARGON2_HASH_OPTIONS);
}

function askMasked(rl, query) {
  return new Promise((resolve) => {
    rl.muted = false;
    process.stdout.write(query);
    rl.muted = true;
    rl.question("", (answer) => {
      rl.muted = false;
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

export async function runCLI(input = process.stdin, output = process.stdout) {
  if (process.argv.length > 2) {
    console.error("Erreur : les arguments en ligne de commande sont strictement refuses par securite.");
    process.exit(1);
  }

  if (!input.isTTY || !output.isTTY) {
    console.error("Erreur : ce script necessite un terminal interactif (TTY).");
    process.exit(1);
  }

  const rl = createInterface({
    input,
    output,
  });

  rl.muted = false;
  const originalWrite = rl._writeToOutput.bind(rl);
  rl._writeToOutput = function customWrite(stringToWrite) {
    if (rl.muted) {
      if (stringToWrite === "\r" || stringToWrite === "\n" || stringToWrite === "\r\n") {
        output.write(stringToWrite);
      } else {
        output.write("*");
      }
    } else {
      originalWrite(stringToWrite);
    }
  };

  const cleanup = () => {
    rl.muted = false;
    rl.close();
  };

  process.once("SIGINT", () => {
    cleanup();
    console.log("\nOperation annulee.");
    process.exit(130);
  });

  try {
    const password = await askMasked(rl, "Veuillez saisir le mot de passe administrateur : ");
    const confirmation = await askMasked(rl, "Veuillez confirmer le mot de passe : ");

    const validation = validatePasswordInput(password, confirmation);
    if (!validation.valid) {
      console.error(`\nErreur : ${validation.error}`);
      cleanup();
      process.exit(1);
    }

    cleanup();

    const hash = await hashAdminPassword(password);

    console.log("\nADMIN_PASSWORD_HASH genere avec succes (Argon2id) :\n");
    console.log(hash);
    console.log("\nCopiez cette valeur dans votre fichier .env.local prive.");
  } catch {
    cleanup();
    console.error("\nUne erreur inattendue est survenue.");
    process.exit(1);
  }
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Only auto-run if executed directly as a script
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  runCLI();
}
