import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import process from "node:process";
import readline from "node:readline/promises";

function bytesToB64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return rl.question(question).finally(() => rl.close());
}

async function main() {
  const inputPathArg = process.argv[2];
  const outputPathArg = process.argv[3];
  if (!inputPathArg || !outputPathArg) {
    console.error(
      "Usage: node tools/encrypt-report.mjs <input-html> <output-json>"
    );
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), inputPathArg);
  const outputPath = resolve(process.cwd(), outputPathArg);
  const html = readFileSync(inputPath, "utf8");

  const secret =
    process.env.REPORT_KEY || (await prompt("Input KEY (>=16 chars): "));
  if (!secret || secret.length < 16) {
    console.error("KEY too short. Need >= 16 chars.");
    process.exit(1);
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 600000;
  const derived = pbkdf2Sync(secret, salt, iterations, 32, "sha256");

  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const encrypted = Buffer.concat([cipher.update(html, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payloadBytes = Buffer.concat([encrypted, tag]);

  const payload = {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(payloadBytes),
    createdAt: new Date().toISOString(),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Encrypted payload written: ${outputPath}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
