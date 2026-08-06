const statusEl = document.getElementById("status");
document.title = "HTML 安全查看中心";
const keyInputEl = document.getElementById("keyInput");
const unlockBtnEl = document.getElementById("unlockBtn");
const docIdEl = document.getElementById("docId");
const docSelectEl = document.getElementById("docSelect");
const docStateEl = document.getElementById("docState");
const viewerEl = document.getElementById("viewer");
const viewerEmptyEl = document.getElementById("viewerEmpty");
const viewerPanelEl = document.getElementById("viewerPanel");
const fullscreenBtnEl = document.getElementById("fullscreenBtn");
const adminJumpBtnEl = document.getElementById("adminJumpBtn");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const url = new URL(window.location.href);
const hasDocQuery = url.searchParams.has("doc");
const forceDesktop = url.searchParams.get("desktop") !== "0";
let activeBlobUrl = null;

function browserCompat() {
  const ua = navigator.userAgent || "";
  const isIE = /MSIE|Trident\//i.test(ua);
  const hasCrypto = Boolean(window.crypto && window.crypto.subtle);
  const hasBlobUrl = Boolean(window.URL && URL.createObjectURL);
  const hasFetch = typeof fetch === "function";
  const hasPromise = typeof Promise === "function";
  return {
    ok: !isIE && hasCrypto && hasBlobUrl && hasFetch && hasPromise,
    isIE,
  };
}

function sanitizeDocId(raw) {
  return /^[a-zA-Z0-9_-]+$/.test(raw || "") ? raw : "default";
}

let docId = sanitizeDocId(url.searchParams.get("doc") || "default");

function setDocId(nextDocId, syncUrl = true) {
  docId = sanitizeDocId(nextDocId);
  if (docIdEl) docIdEl.textContent = docId;
  if (!syncUrl) return;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("doc", docId);
  window.history.replaceState({}, "", nextUrl.toString());
}

setDocId(docId, false);

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

function updateDocSelectPlaceholderState() {
  if (!docSelectEl) return;
  const noSelection = docSelectEl.selectedIndex < 0 || !String(docSelectEl.value || "").trim();
  docSelectEl.classList.toggle("select-placeholder", noSelection);
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
  const fullscreenElement =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement;
  return fullscreenElement === viewerPanelEl;
}

function setFullscreenButtonLabel() {
  if (!fullscreenBtnEl) return;
  fullscreenBtnEl.textContent = isViewerFullscreen() ? "退出全屏" : "全屏展开";
}

function jumpToAdmin() {
  window.location.href = "./admin/";
}

async function toggleViewerFullscreen() {
  if (!viewerPanelEl) return;
  try {
    if (isViewerFullscreen()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      } else {
        setStatus("当前浏览器不支持退出全屏。", true);
        return;
      }
    } else if (viewerPanelEl.requestFullscreen) {
      await viewerPanelEl.requestFullscreen();
    } else if (viewerPanelEl.webkitRequestFullscreen) {
      viewerPanelEl.webkitRequestFullscreen();
    } else if (viewerPanelEl.msRequestFullscreen) {
      viewerPanelEl.msRequestFullscreen();
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
  const manifestUrl = `./payloads/_manifest.json?t=${Date.now()}`;
  const res = await fetch(manifestUrl, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data?.docs)) return [];
  return data.docs
    .map((x) => {
      const id = sanitizeDocId(x?.doc_id);
      if (!id) return null;
      const inputFile = String(x?.input_file || "");
      const sourceName = inputFile.split("/").pop() || "";
      return {
        docId: id,
        label: sourceName || id,
      };
    })
    .filter(Boolean);
}

async function docPayloadExists(nextDocId) {
  const payloadPath = `./payloads/${nextDocId}.json?t=${Date.now()}`;
  const res = await fetch(payloadPath, { cache: "no-store" });
  if (res.ok) return true;
  if (nextDocId !== "default") return false;
  const legacy = await fetch(`./payload.json?t=${Date.now()}`, { cache: "no-store" });
  return legacy.ok;
}

async function filterAvailableDocs(docs) {
  const checks = await Promise.all(
    docs.map(async (x) => ((await docPayloadExists(x.docId)) ? x : null))
  );
  return checks.filter(Boolean);
}

async function initDocSelector() {
  let docs = [];
  try {
    docs = await loadManifest();
  } catch (_err) {
    docs = [];
  }
  const seen = new Set();
  let uniqueDocs = docs.filter((x) => {
    if (seen.has(x.docId)) return false;
    seen.add(x.docId);
    return true;
  });
  try {
    uniqueDocs = await filterAvailableDocs(uniqueDocs);
  } catch (_err) {
    uniqueDocs = [];
  }
  if (uniqueDocs.length === 0) {
    uniqueDocs.push({ docId: "default", label: "default" });
  }

  const hasMatchedDoc = uniqueDocs.some((x) => x.docId === docId);
  if (hasDocQuery && !hasMatchedDoc) {
    setDocId(uniqueDocs[0].docId, false);
  }

  if (!docSelectEl) return;

  docSelectEl.innerHTML = uniqueDocs
    .map((x) => `<option value="${x.docId}">${x.label}</option>`)
    .join("");

  if (hasDocQuery && hasMatchedDoc) {
    docSelectEl.value = docId;
  } else if (hasDocQuery) {
    docSelectEl.value = uniqueDocs[0].docId;
  } else {
    docSelectEl.selectedIndex = -1;
  }

  updateDocSelectPlaceholderState();
}

async function loadPayload() {
  const payloadPath = `./payloads/${docId}.json?t=${Date.now()}`;
  let res = await fetch(payloadPath, { cache: "no-store" });
  if (!res.ok && docId === "default") {
    // Backward compatibility for legacy single-file mode.
    res = await fetch(`./payload.json?t=${Date.now()}`, { cache: "no-store" });
  }
  if (!res.ok) throw new Error(`payload load failed: ${res.status}`);
  return res.json();
}

async function tryUnlock() {
  if (docSelectEl && (docSelectEl.selectedIndex < 0 || !String(docSelectEl.value || "").trim())) {
    updateDocSelectPlaceholderState();
    setStatus("请先选择文档。", true);
    return;
  }
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

    const key = await deriveAesKey(secret, b64ToBytes(payload.salt), Number(payload.iterations));
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(payload.iv) },
      key,
      b64ToBytes(payload.ciphertext)
    );
    const plaintextBytes = new Uint8Array(plaintextBuffer);
    if (Number.isInteger(payload.inputSize) && plaintextBytes.byteLength !== payload.inputSize) {
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
    if (forceDesktop && (payload.mimeType || "text/html").includes("text/html")) {
      const html = textDecoder.decode(plaintextBytes);
      const patchedHtml = injectDesktopOverride(html);
      renderBytes = textEncoder.encode(patchedHtml);
    }

    if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    const blob = new Blob([renderBytes], { type: payload.mimeType || "text/html" });
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

function handleDocSelection() {
  if (!docSelectEl) return;
  const selectedRaw = String(docSelectEl.value || "").trim();
  if (!selectedRaw) {
    updateDocSelectPlaceholderState();
    return;
  }
  const selected = sanitizeDocId(selectedRaw);
  setDocId(selected, true);
  updateDocSelectPlaceholderState();
  lockViewer(`当前文档：${selected}<br />请输入对应 KEY。`);
  setDocState("待解锁");
  setStatus(`已切换文档：${selected}`);
  keyInputEl.focus();
}

function attachViewerHandlers() {
  unlockBtnEl.addEventListener("click", tryUnlock);
  keyInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });
  if (docSelectEl) {
    docSelectEl.addEventListener("change", handleDocSelection);
  }
  if (fullscreenBtnEl) {
    fullscreenBtnEl.addEventListener("click", toggleViewerFullscreen);
  }
  if (adminJumpBtnEl) {
    adminJumpBtnEl.addEventListener("click", jumpToAdmin);
  }
  document.addEventListener("fullscreenchange", setFullscreenButtonLabel);
  document.addEventListener("webkitfullscreenchange", setFullscreenButtonLabel);
  document.addEventListener("MSFullscreenChange", setFullscreenButtonLabel);
}

function disableViewerControls() {
  if (unlockBtnEl) unlockBtnEl.disabled = true;
  if (keyInputEl) keyInputEl.disabled = true;
  if (docSelectEl) docSelectEl.disabled = true;
  if (fullscreenBtnEl) fullscreenBtnEl.disabled = true;
}

async function initViewerReadyState() {
  await initDocSelector();
  const selectedRaw = docSelectEl ? String(docSelectEl.value || "").trim() : "";
  if (!selectedRaw) {
    if (docIdEl) docIdEl.textContent = "-";
    lockViewer("请先选择文档，然后输入 KEY 访问。");
    setDocState("待选择");
    setStatus("请先选择文档，然后输入 KEY。");
  } else {
    lockViewer(`当前文档：${docId}<br />请在右侧输入 KEY 访问。`);
    setDocState("待解锁");
    setStatus("页面已就绪，请输入 KEY。");
  }
  setFullscreenButtonLabel();
}

const compat = browserCompat();
if (!compat.ok) {
  disableViewerControls();
  setDocState("浏览器不兼容");
  lockViewer("当前浏览器不支持解密能力，请使用 Chrome / Edge 最新版，或 Safari 15+。");
  setStatus(
    compat.isIE
      ? "当前是 IE/IE 模式，无法访问。请改用 Chrome / Edge 或 Safari 15+。"
      : "当前浏览器能力不足，无法访问。请改用 Chrome / Edge 最新版，或 Safari 15+。",
    true
  );
} else {
  attachViewerHandlers();
  initViewerReadyState();
}
