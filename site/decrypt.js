const statusEl = document.getElementById("status");
const keyInputEl = document.getElementById("keyInput");
const unlockBtnEl = document.getElementById("unlockBtn");
const viewerEl = document.getElementById("viewer");
const unlockPanelEl = document.getElementById("unlockPanel");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
  const res = await fetch("./payload.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`payload load failed: ${res.status}`);
  return res.json();
}

async function tryUnlock() {
  const secret = keyInputEl.value;
  if (!secret) {
    setStatus("请先输入 KEY。", true);
    return;
  }

  unlockBtnEl.disabled = true;
  setStatus("正在解密...");

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

    viewerEl.srcdoc = textDecoder.decode(plaintextBuffer);
    viewerEl.style.display = "block";
    unlockPanelEl.style.display = "none";
    setStatus("解锁成功。");
  } catch (err) {
    setStatus("KEY 错误或内容不可用。", true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    unlockBtnEl.disabled = false;
    keyInputEl.focus();
  }
}

unlockBtnEl.addEventListener("click", tryUnlock);
keyInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});
