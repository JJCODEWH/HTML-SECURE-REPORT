const statusEl = document.getElementById("status");
const keyInputEl = document.getElementById("keyInput");
const unlockBtnEl = document.getElementById("unlockBtn");
const docIdEl = document.getElementById("docId");
const docSelectEl = document.getElementById("docSelect");
const docStateEl = document.getElementById("docState");
const viewerEl = document.getElementById("viewer");
const viewerEmptyEl = document.getElementById("viewerEmpty");
const viewerPanelEl = document.getElementById("viewerPanel");
const fullscreenBtnEl = document.getElementById("fullscreenBtn");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const url = new URL(window.location.href);
const forceDesktop = url.searchParams.get("desktop") !== "0";
let activeBlobUrl = null;

function sanitizeDocId(raw) {
  return /^[a-zA-Z0-9_-]+$/.test(raw || "") ? raw : "default";
}

let docId = sanitizeDocId(url.searchParams.get("doc") || "default");

function setDocId(nextDocId) {
  docId = sanitizeDocId(nextDocId);
  if (docIdEl) docIdEl.textContent = docId;
  if (docSelectEl) docSelectEl.value = docId;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("doc", docId);
  window.history.replaceState({}, "", nextUrl.toString());
}

setDocId(docId);

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

function setDocState(msg) {
  if (docStateEl) docStateEl.textContent = msg;
}

function lockViewer(message) {
  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = null;
  }
  if (viewerEl) {
    viewerEl.style.display = "none";
    viewerEl.removeAttribute("src");
  }
  if (viewerEmptyEl) {
    viewerEmptyEl.style.display = "grid";
    viewerEmptyEl.innerHTML = `<div><strong>文档已加密</strong><br />${message}</div>`;
  }
}

function openViewer(blobUrl) {
  if (viewerEmptyEl) viewerEmptyEl.style.display = "none";
  if (viewerEl) {
    viewerEl.style.display = "block";
    viewerEl.src = blobUrl;
  }
}

function isViewerFullscreen() {
  return document.fullscreenElement === viewerPanelEl;
}

function setFullscreenButtonLabel() {
  if (!fullscreenBtnEl) return;
  fullscreenBtnEl.textContent = isViewerFullscreen() ? "退出全屏" : "全屏展开";
}

async function toggleViewerFullscreen() {
  if (!viewerPanelEl) return;
  try {
    if (isViewerFullscreen()) {
      await document.exitFullscreen();
    } else if (viewerPanelEl.requestFullscreen) {
      await viewerPanelEl.requestFullscreen();
    } else {
      setStatus("当前浏览器不支持全屏功能。", true);
      return;
    }
    setFullscreenButtonLabel();
  } catch (_err) {
    setStatus("全屏切换失败，请重试。", true);
  }
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function injectDesktopOverride(htmlText) {
  const override = `
<style id="secure-report-desktop-override">
html, body { min-width: 1280px !important; }
@media (max-width: 1120px) {
  .nav { display: flex !important; }
  .top { height: 78px !important; padding: 0 28px !important; flex-wrap: nowrap !important; }
  .brand { min-width: 280px !important; }
  .kpis { grid-template-columns: repeat(6, 1fr) !important; }
}
</style>`;
  if (htmlText.includes("</head>")) {
    return htmlText.replace("</head>", `${override}\n</head>`);
  }
  return `${override}\n${htmlText}`;
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

async function loadManifest() {
  const res = await fetch("./payloads/_manifest.json", { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data?.docs)) return [];
  return data.docs
    .map((x) => sanitizeDocId(x?.doc_id))
    .filter(Boolean);
}

async function initDocSelector() {
  let docIds = [];
  try {
    docIds = await loadManifest();
  } catch (_err) {
    docIds = [];
  }
  if (!docIds.includes(docId)) {
    docIds.unshift(docId);
  }
  const uniqueDocIds = [...new Set(docIds)];
  if (docSelectEl) {
    docSelectEl.innerHTML = uniqueDocIds
      .map((x) => `<option value="${x}">${x}</option>`)
      .join("");
    docSelectEl.value = docId;
  }
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
    setStatus("请先输入 KEY。", true);
    return;
  }

  unlockBtnEl.disabled = true;
  setDocState("解锁中");
  setStatus(`正在解密文档：${docId} ...`);

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

    let renderBytes = plaintextBytes;
    if (
      forceDesktop &&
      (payload.mimeType || "text/html").includes("text/html")
    ) {
      const html = textDecoder.decode(plaintextBytes);
      const patchedHtml = injectDesktopOverride(html);
      renderBytes = textEncoder.encode(patchedHtml);
    }

    if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    const blob = new Blob([renderBytes], {
      type: payload.mimeType || "text/html",
    });
    activeBlobUrl = URL.createObjectURL(blob);
    openViewer(activeBlobUrl);
    setDocState("已解锁");
    setStatus(`已解锁：${docId}`);
    unlockBtnEl.disabled = false;
  } catch (_err) {
    lockViewer("请在右侧输入正确 KEY 解锁。");
    setDocState("解锁失败");
    setStatus(`KEY 无效或文档不可用：${docId}`, true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    unlockBtnEl.disabled = false;
    keyInputEl.focus();
  }
}

function applySelectedDoc() {
  const selected = sanitizeDocId(docSelectEl?.value || docId);
  setDocId(selected);
  lockViewer(`当前文档：${selected}<br />请输入对应 KEY。`);
  setDocState("待解锁");
  setStatus(`已切换文档：${selected}`);
  keyInputEl.focus();
}

unlockBtnEl.addEventListener("click", tryUnlock);
keyInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});
if (docSelectEl) {
  docSelectEl.addEventListener("change", applySelectedDoc);
}
if (fullscreenBtnEl) {
  fullscreenBtnEl.addEventListener("click", toggleViewerFullscreen);
}
document.addEventListener("fullscreenchange", setFullscreenButtonLabel);

initDocSelector();
lockViewer(`当前文档：${docId}<br />请在右侧输入 KEY 访问。`);
setDocState("待解锁");
setStatus("页面已就绪，请输入 KEY。");
setFullscreenButtonLabel();
