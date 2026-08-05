const statusEl = document.getElementById("status");
const keyInputEl = document.getElementById("keyInput");
const unlockBtnEl = document.getElementById("unlockBtn");
const viewerEl = document.getElementById("viewer");
const unlockPanelEl = document.getElementById("unlockPanel");
const docIdEl = document.getElementById("docId");

const textEncoder = new TextEncoder();
const url = new URL(window.location.href);
const rawDocId = url.searchParams.get("doc") || "default";
const docId = /^[a-zA-Z0-9_-]+$/.test(rawDocId) ? rawDocId : "default";
let activeBlobUrl = null;

if (docIdEl) docIdEl.textContent = docId;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#d33" : "";
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveAesKey(secret, saltBytes, iterations) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function loadPayload() {
  const payloadPath = `./payloads/${docId}.json`;
  let res = await fetch(payloadPath, { cache: "no-store" });
  if (!res.ok && docId === "default") {
    // Backward compatibility for legacy single-file mode.
    res = await fetch("./payload.json", { cache: "no-store" });
  }
  if (!res.ok) throw new Error(`payload load failed: ${res.status}`);
  return res.json();
}

async function tryUnlock() {
  const secret = keyInputEl.value;
  if (!secret) {
    setStatus("Please input KEY first.", true);
    return;
  }

  unlockBtnEl.disabled = true;
  setStatus(`Decrypting doc: ${docId} ...`);

  try {
    const payload = await loadPayload();
    if (payload.version !== 1) throw new Error("unsupported payload version");
    if (payload.kdf !== "PBKDF2-SHA256") throw new Error("unsupported kdf");

    const key = await deriveAesKey(
      secret,
      b64ToBytes(payload.salt),
      Number(payload.iterations)
    );
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(payload.iv) },
      key,
      b64ToBytes(payload.ciphertext)
    );
    const plaintextBytes = new Uint8Array(plaintextBuffer);
    if (
      Number.isInteger(payload.inputSize) &&
      plaintextBytes.byteLength !== payload.inputSize
    ) {
      throw new Error("size check failed");
    }
    if (payload.inputSha256) {
      const digest = await crypto.subtle.digest("SHA-256", plaintextBuffer);
      const digestHex = toHex(new Uint8Array(digest));
      if (digestHex !== String(payload.inputSha256).toLowerCase()) {
        throw new Error("sha256 check failed");
      }
    }

    if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    const blob = new Blob([plaintextBytes], {
      type: payload.mimeType || "text/html",
    });
    activeBlobUrl = URL.createObjectURL(blob);
    viewerEl.src = activeBlobUrl;
    viewerEl.style.display = "block";
    unlockPanelEl.style.display = "none";
    setStatus(`Unlocked: ${docId}`);
  } catch (err) {
    setStatus(`KEY invalid or doc unavailable: ${docId}`, true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    unlockBtnEl.disabled = false;
    keyInputEl.focus();
  }
}

unlockBtnEl.addEventListener("click", tryUnlock);
keyInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});
