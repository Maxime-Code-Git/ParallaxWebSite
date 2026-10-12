import { createInterface } from "node:readline";
import * as argon2 from "@node-rs/argon2";

if (process.argv.length > 2) {
  console.error("Erreur : les arguments en ligne de commande sont strictement refuses par securite.");
  process.exit(1);
}

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error("Erreur : ce script necessite un terminal interactif (TTY).");
  process.exit(1);
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

let isMuted = true;
const defaultWrite = rl._writeToOutput.bind(rl);
rl._writeToOutput = function customWrite(stringToWrite) {
  if (isMuted) {
    if (stringToWrite === "\r" || stringToWrite === "\n" || stringToWrite === "\r\n") {
      process.stdout.write(stringToWrite);
    } else {
      process.stdout.write("*");
    }
  } else {
    defaultWrite(stringToWrite);
  }
};

function askQuestion(query) {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });
}

function restoreTerminal() {
  isMuted = false;
  rl.close();
}

process.on("SIGINT", () => {
  restoreTerminal();
  console.log("\nOperation annulee.");
  process.exit(130);
});

async function run() {
  try {
    const password = await askQuestion("Veuillez saisir le mot de passe administrateur : ");
    console.log("");

    if (!password) {
      console.error("\nErreur : le mot de passe est obligatoire.");
      restoreTerminal();
      process.exit(1);
    }

    if (password.length < 12) {
      console.error("\nErreur : le mot de passe doit comporter au moins 12 caracteres.");
      restoreTerminal();
      process.exit(1);
    }

    const confirmation = await askQuestion("Veuillez confirmer le mot de passe : ");
    console.log("");

    if (password !== confirmation) {
      console.error("\nErreur : les mots de passe ne correspondent pas.");
      restoreTerminal();
      process.exit(1);
    }

    restoreTerminal();

    const hash = await argon2.hash(password, {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    console.log("\nADMIN_PASSWORD_HASH genere avec succes (Argon2id) :\n");
    console.log(hash);
    console.log("\nCopiez cette valeur dans votre fichier .env.local prive.");
  } catch {
    restoreTerminal();
    console.error("\nUne erreur inattendue est survenue.");
    process.exit(1);
  }
}

run();
