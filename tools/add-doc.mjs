import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

function bytesToB64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function nowIso() {
  return new Date().toISOString();
}

function isValidDocId(docId) {
  return /^[a-zA-Z0-9_-]+$/.test(docId);
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return rl.question(question).finally(() => rl.close());
}

function encryptHtml(html, secret) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 600000;
  const derived = pbkdf2Sync(secret, salt, iterations, 32, "sha256");

  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const encrypted = Buffer.concat([cipher.update(html, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payloadBytes = Buffer.concat([encrypted, tag]);

  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(payloadBytes),
    createdAt: nowIso(),
  };
}

function upsertKeyMap(docId, inputFile, keyValue) {
  const mapPath = resolve(process.cwd(), "admin/key-map.csv");
  const header = "doc_id,input_file,key,owner,updated_at,notes";
  const row = `${docId},${inputFile},${keyValue},admin,${nowIso()},`;

  if (!existsSync(mapPath)) {
    mkdirSync(dirname(mapPath), { recursive: true });
    writeFileSync(mapPath, `${header}\n${row}\n`, "utf8");
    return;
  }

  const content = readFileSync(mapPath, "utf8").trimEnd();
  const lines = content ? content.split(/\r?\n/) : [];
  const currentHeader = lines.length ? lines[0] : header;
  const dataRows = lines.slice(1).filter(Boolean);

  let replaced = false;
  const nextRows = dataRows.map((line) => {
    const parts = line.split(",");
    if (parts[0] === docId) {
      replaced = true;
      return row;
    }
    return line;
  });
  if (!replaced) nextRows.push(row);

  writeFileSync(mapPath, `${currentHeader}\n${nextRows.join("\n")}\n`, "utf8");
}

async function main() {
  const docId = process.argv[2];
  const inputHtmlPath = process.argv[3];
  if (!docId || !inputHtmlPath) {
    console.error("Usage: node tools/add-doc.mjs <doc-id> <input-html>");
    process.exit(1);
  }
  if (!isValidDocId(docId)) {
    console.error("Invalid doc-id. Use only: letters, numbers, _ and -");
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), inputHtmlPath);
  const html = readFileSync(inputPath, "utf8");
  const secret = process.env.REPORT_KEY || (await prompt("Input KEY (>=16 chars): "));
  if (!secret || secret.length < 16) {
    console.error("KEY too short. Need >= 16 chars.");
    process.exit(1);
  }

  const payload = encryptHtml(html, secret);
  const outputPath = resolve(process.cwd(), `site/payloads/${docId}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  upsertKeyMap(docId, inputHtmlPath, secret);

  console.log(`Doc created: ${docId}`);
  console.log(`Payload: ${outputPath}`);
  console.log("Open URL:");
  console.log(`https://jjcodewh.github.io/HTML-SECURE-REPORT/?doc=${docId}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
