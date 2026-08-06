const ownerEl = document.getElementById("owner");
const repoEl = document.getElementById("repo");
const branchEl = document.getElementById("branch");
const tokenEl = document.getElementById("token");
const loadFilesBtnEl = document.getElementById("loadFilesBtn");
const checkRunsBtnEl = document.getElementById("checkRunsBtn");
const incomingSelectEl = document.getElementById("incomingSelect");
const docIdEl = document.getElementById("docId");
const viewKeyBtnEl = document.getElementById("viewKeyBtn");
const keyOutputEl = document.getElementById("keyOutput");
const htmlFileEl = document.getElementById("htmlFile");
const uploadBtnEl = document.getElementById("uploadBtn");
const deleteSelectEl = document.getElementById("deleteSelect");
const deleteDocIdEl = document.getElementById("deleteDocId");
const deleteBtnEl = document.getElementById("deleteBtn");
const statusEl = document.getElementById("status");
const repoLabelEl = document.getElementById("repoLabel");
const PUBLIC_SITE_OWNER = "JJCODEWH";
const PUBLIC_SITE_REPO = "HTML-SECURE-REPORT";
const PUBLIC_SITE_BRANCH = "main";
const READY_POLL_INTERVAL_MS = 4000;
const READY_POLL_TIMEOUT_MS = 120000;

function browserCompat() {
  const ua = navigator.userAgent || "";
  const isIE = /MSIE|Trident\//i.test(ua);
  const hasFetch = typeof fetch === "function";
  const hasPromise = typeof Promise === "function";
  const hasFileReader = typeof FileReader !== "undefined";
  const hasEncoder = typeof TextEncoder !== "undefined";
  const hasDecoder = typeof TextDecoder !== "undefined";
  return {
    ok: !isIE && hasFetch && hasPromise && hasFileReader && hasEncoder && hasDecoder,
    isIE,
  };
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#d33" : "";
}

function normalizeDocId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\.html?$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractDocIdFromIncomingName(name) {
  const base = String(name || "").split("/").pop() || "";
  const ext = base.replace(/^.*(\.[^.]+)$/, "$1");
  const noExt = ext !== base ? base.slice(0, -ext.length) : base;
  const marker = noExt.indexOf("__");
  const raw = marker > 0 ? noExt.slice(0, marker) : noExt;
  return normalizeDocId(raw);
}

function buildIncomingName(docId, originalName) {
  const cleanDocId = normalizeDocId(docId);
  const base = String(originalName || "upload.html").split("/").pop().split("\\").pop();
  const withExt = /\.html?$/i.test(base) ? base : `${base}.html`;
  return `${cleanDocId}__${withExt}`;
}

function parseIncomingDisplayMeta(name) {
  const base = String(name || "").split("/").pop() || "";
  const ext = base.replace(/^.*(\.[^.]+)$/, "$1");
  const noExt = ext !== base ? base.slice(0, -ext.length) : base;
  const marker = noExt.indexOf("__");
  if (marker > 0) {
    const prefix = noExt.slice(0, marker);
    const suffix = noExt.slice(marker + 2);
    const originalName = suffix ? `${suffix}${ext}` : base;
    return {
      docId: normalizeDocId(prefix),
      displayName: originalName,
    };
  }
  return {
    docId: extractDocIdFromIncomingName(base),
    displayName: base,
  };
}

function makeAutoDocId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `doc-${ts}-${rand}`;
}

function syncRepoLabel() {
  const owner = ownerEl.value.trim() || "owner";
  const repo = repoEl.value.trim() || "repo";
  const branch = branchEl.value.trim() || "branch";
  repoLabelEl.textContent = `${owner}/${repo}@${branch}`;
}

function mustGetConfig() {
  const owner = ownerEl.value.trim();
  const repo = repoEl.value.trim();
  const branch = branchEl.value.trim();
  const token = tokenEl.value.trim();
  if (!owner || !repo || !branch || !token) {
    throw new Error("请先填写 Owner / Repository / Branch / PAT。");
  }
  return { owner, repo, branch, token };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败。"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      if (idx < 0) {
        reject(new Error("文件编码失败。"));
        return;
      }
      resolve(result.slice(idx + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function requestJson(url, method, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_err) {
    data = null;
  }
  return { res, data };
}

async function requestText(url, method, token) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await res.text();
  return { res, text };
}

function parseCsvRow(line) {
  const cells = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === "," && !inQuote) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((x) => x.trim());
}

function parseKeyMapCsv(csvText) {
  const lines = String(csvText || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]);
  const docIdx = headers.indexOf("doc_id");
  const keyIdx = headers.indexOf("key");
  if (docIdx < 0 || keyIdx < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = parseCsvRow(line);
    return {
      doc_id: cols[docIdx] || "",
      key: cols[keyIdx] || "",
    };
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDocKeyFromKeyMap({ owner, repo, branch, token, docId }) {
  const keyMapFile = await getRepoTextFile({
    owner,
    repo,
    branch,
    token,
    path: "admin/key-map.csv",
  });
  if (!keyMapFile.exists || !keyMapFile.text) return "";
  const rows = parseKeyMapCsv(keyMapFile.text);
  const hit = rows.find((x) => normalizeDocId(x.doc_id) === docId);
  return hit && hit.key ? hit.key : "";
}

async function isDocInPublicManifest({ docId, token }) {
  const manifestFile = await getRepoTextFile({
    owner: PUBLIC_SITE_OWNER,
    repo: PUBLIC_SITE_REPO,
    branch: PUBLIC_SITE_BRANCH,
    token,
    path: "site/payloads/_manifest.json",
  });
  if (!manifestFile.exists || !manifestFile.text) return false;
  try {
    const obj = JSON.parse(manifestFile.text);
    if (!Array.isArray(obj?.docs)) return false;
    return obj.docs.some((item) => normalizeDocId(item?.doc_id) === docId);
  } catch (_err) {
    return false;
  }
}

async function waitForDocReady({ owner, repo, branch, token, docId }) {
  const started = Date.now();
  while (Date.now() - started < READY_POLL_TIMEOUT_MS) {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    setStatus(`已上传，等待自动加密与发布（${elapsed}s）...\nDoc: ${docId}`);

    let key = "";
    let payloadReady = false;
    let inManifest = false;

    try {
      key = await getDocKeyFromKeyMap({ owner, repo, branch, token, docId });
    } catch (_err) {
      key = "";
    }
    try {
      const payloadSha = await getFileSha({
        owner: PUBLIC_SITE_OWNER,
        repo: PUBLIC_SITE_REPO,
        branch: PUBLIC_SITE_BRANCH,
        token,
        path: `site/payloads/${docId}.json`,
      });
      payloadReady = Boolean(payloadSha);
    } catch (_err) {
      payloadReady = false;
    }
    try {
      inManifest = await isDocInPublicManifest({ docId, token });
    } catch (_err) {
      inManifest = false;
    }

    if (key && payloadReady && inManifest) {
      return { ready: true, key };
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  return { ready: false, key: "" };
}

function getUploadTargetDocId() {
  const inputDocId = normalizeDocId(docIdEl.value);
  const selectedDocId = extractDocIdFromIncomingName(incomingSelectEl.value);
  return inputDocId || selectedDocId || makeAutoDocId();
}

async function waitForDocRemoved({ owner, repo, branch, token, docId }) {
  const started = Date.now();
  while (Date.now() - started < READY_POLL_TIMEOUT_MS) {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    setStatus(`已提交删除，等待仓库状态同步（${elapsed}s）...\nDoc: ${docId}`);

    let payloadSha = "x";
    let inManifest = true;
    let key = "x";

    try {
      payloadSha = await getFileSha({
        owner: PUBLIC_SITE_OWNER,
        repo: PUBLIC_SITE_REPO,
        branch: PUBLIC_SITE_BRANCH,
        token,
        path: `site/payloads/${docId}.json`,
      });
    } catch (_err) {
      payloadSha = "x";
    }
    try {
      inManifest = await isDocInPublicManifest({ docId, token });
    } catch (_err) {
      inManifest = true;
    }
    try {
      key = await getDocKeyFromKeyMap({ owner, repo, branch, token, docId });
    } catch (_err) {
      key = "x";
    }

    if (!payloadSha && !inManifest && !key) {
      return { removed: true };
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  return { removed: false };
}

async function fetchIncomingHtmlFiles({ owner, repo, branch, token }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/incoming?ref=${encodeURIComponent(branch)}`;
  const { res, data } = await requestJson(url, "GET", token);
  if (!res.ok || !Array.isArray(data)) {
    const message = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`加载 incoming 失败：${message}`);
  }

  return data
    .filter((item) => item && item.type === "file" && /\.html?$/i.test(item.name))
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

async function listIncomingFiles(options = {}) {
  const { owner, repo, branch, token } = mustGetConfig();
  const silent = Boolean(options.silent);
  if (!silent) setStatus("正在加载 incoming 文件...");

  const files = await fetchIncomingHtmlFiles({ owner, repo, branch, token });

  incomingSelectEl.innerHTML = '<option value="">incoming/ 现有文件（可选）</option>';
  if (deleteSelectEl) {
    deleteSelectEl.innerHTML = '<option value="">删除区独立列表（可选）</option>';
  }
  files.forEach((name) => {
    const meta = parseIncomingDisplayMeta(name);
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${meta.displayName}（DocID: ${meta.docId}）`;
    incomingSelectEl.appendChild(opt);
    if (deleteSelectEl) {
      const deleteOpt = document.createElement("option");
      deleteOpt.value = name;
      deleteOpt.textContent = `${meta.displayName}（DocID: ${meta.docId}）`;
      deleteSelectEl.appendChild(deleteOpt);
    }
  });

  if (!silent) setStatus(`已加载 ${files.length} 个 HTML 文件。`);
}

async function checkLatestRuns() {
  const { owner, repo, branch, token } = mustGetConfig();
  setStatus("正在查询流程状态...");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`;
  const { res, data } = await requestJson(url, "GET", token);
  if (!res.ok || !Array.isArray(data?.workflow_runs)) {
    const message = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`读取流程失败：${message}`);
  }

  const lines = data.workflow_runs.slice(0, 3).map((run, idx) => {
    const name = run.name || "workflow";
    const status = run.status || "unknown";
    const result = run.conclusion || "-";
    const runUrl = run.html_url || "";
    return `${idx + 1}. ${name}\n   status=${status}, result=${result}\n   ${runUrl}`;
  });

  if (lines.length === 0) {
    setStatus("当前分支还没有 workflow 记录。");
    return;
  }
  setStatus(lines.join("\n"));
}

async function getFileSha({ owner, repo, branch, token, path }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const { res, data } = await requestJson(url, "GET", token);
  if (res.status === 404) return null;
  if (!res.ok || !data?.sha) {
    const message = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`读取文件信息失败：${message}`);
  }
  return data.sha;
}

function decodeBase64ToText(base64Text) {
  const clean = String(base64Text || "").replace(/\n/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeTextToBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function getRepoTextFile({ owner, repo, branch, token, path }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const { res, data } = await requestJson(url, "GET", token);
  if (res.status === 404) {
    return { exists: false, sha: null, text: "" };
  }
  if (!res.ok) {
    const message = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`读取 ${path} 失败：${message}`);
  }
  if (!data?.content || !data?.sha) {
    throw new Error(`读取 ${path} 失败：文件内容为空。`);
  }
  return {
    exists: true,
    sha: data.sha,
    text: decodeBase64ToText(data.content),
  };
}

async function upsertRepoTextFile({
  owner,
  repo,
  branch,
  token,
  path,
  message,
  text,
  sha,
}) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const body = {
    message,
    content: encodeTextToBase64(text),
    branch,
    ...(sha ? { sha } : {}),
  };
  return requestJson(url, "PUT", token, body);
}

async function deleteRepoFileIfExists({
  owner,
  repo,
  branch,
  token,
  path,
  message,
}) {
  const sha = await getFileSha({ owner, repo, branch, token, path });
  if (!sha) return { deleted: false };

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const body = { message, sha, branch };
  const { res, data } = await requestJson(url, "DELETE", token, body);
  if (!res.ok) {
    const detail = data && data.message ? data.message : `HTTP ${res.status}`;
    if (res.status === 403 && /Resource not accessible/i.test(detail)) {
      throw new Error(
        `删除 ${repo}/${path} 失败：公开仓库 PAT 权限不足。请使用可访问 ${PUBLIC_SITE_OWNER}/${PUBLIC_SITE_REPO} 且具备 Contents: Read and write 的 token。`
      );
    }
    throw new Error(`删除 ${repo}/${path} 失败：${detail}`);
  }
  return { deleted: true };
}

async function viewKeyByDocId() {
  const { owner, repo, branch, token } = mustGetConfig();
  const selectedDocId = normalizeDocId(docIdEl.value) || extractDocIdFromIncomingName(incomingSelectEl.value);
  if (!selectedDocId) {
    throw new Error("请先输入或选择 Doc ID。");
  }
  setStatus(`正在读取 key-map（doc: ${selectedDocId}）...`);
  keyOutputEl.value = "";
  viewKeyBtnEl.disabled = true;
  const prevBtnText = viewKeyBtnEl.textContent;
  viewKeyBtnEl.textContent = "查询中...";

  try {
    const keyMapPath = "admin/key-map.csv";
    const repoFile = await getRepoTextFile({
      owner,
      repo,
      branch,
      token,
      path: keyMapPath,
    });
    let csvText = repoFile.text;
    if (!csvText) {
      const rawUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${keyMapPath}?ref=${encodeURIComponent(branch)}`;
      const rawResp = await requestText(rawUrl, "GET", token);
      if (!rawResp.res.ok || !rawResp.text) {
        const message = rawResp.text || `HTTP ${rawResp.res.status}`;
        throw new Error(`读取 key-map 失败：${message}`);
      }
      csvText = rawResp.text;
    }

    const rows = parseKeyMapCsv(csvText);
    const hit = rows.find((x) => normalizeDocId(x.doc_id) === selectedDocId);
    if (!hit || !hit.key) {
      throw new Error(`未找到对应 KEY：${selectedDocId}`);
    }

    keyOutputEl.value = hit.key;
    setStatus(`已读取 KEY：${selectedDocId}`);
  } finally {
    viewKeyBtnEl.disabled = false;
    viewKeyBtnEl.textContent = prevBtnText || "按 Doc ID 查 KEY";
  }
}

async function uploadAndTrigger(docIdArg) {
  const { owner, repo, branch, token } = mustGetConfig();
  const file = htmlFileEl.files && htmlFileEl.files[0];
  if (!file) {
    throw new Error("请先选择 HTML 文件。");
  }

  const docId = normalizeDocId(docIdArg || getUploadTargetDocId());
  if (!docId) {
    throw new Error("Doc ID 无效。");
  }

  uploadBtnEl.disabled = true;
  setStatus(`正在上传文档（doc: ${docId}）...`);

  try {
    const content = await fileToBase64(file);
    const files = await fetchIncomingHtmlFiles({ owner, repo, branch, token });
    const existingName =
      files.find((name) => extractDocIdFromIncomingName(name) === docId) || "";
    const incomingName = buildIncomingName(docId, file.name);
    const oldPath = existingName ? `incoming/${existingName}` : "";
    const path = `incoming/${incomingName}`;
    let sha = null;

    if (existingName && existingName !== incomingName) {
      const oldSha = await getFileSha({ owner, repo, branch, token, path: oldPath });
      if (oldSha) {
        const delUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${oldPath}`;
        const delBody = {
          message: `chore: replace incoming html (${docId}) via public admin page`,
          sha: oldSha,
          branch,
        };
        const delResp = await requestJson(delUrl, "DELETE", token, delBody);
        if (!delResp.res.ok) {
          const msg = delResp.data && delResp.data.message ? delResp.data.message : `HTTP ${delResp.res.status}`;
          throw new Error(`删除旧 incoming 失败：${msg}`);
        }
      }
    } else if (existingName === incomingName) {
      sha = await getFileSha({ owner, repo, branch, token, path });
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
    const body = {
      message: `chore: upload incoming html (${docId}) via public admin page`,
      content,
      branch,
      ...(sha ? { sha } : {}),
    };

    const { res, data } = await requestJson(url, "PUT", token, body);
    if (!res.ok) {
      const message = data && data.message ? data.message : `HTTP ${res.status}`;
      throw new Error(`上传失败：${message}`);
    }

    const commitUrl = data?.commit?.html_url || "";
    const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
    const publicUrl = `https://jjcodewh.github.io/HTML-SECURE-REPORT/?doc=${encodeURIComponent(docId)}&desktop=1`;
    setStatus(
      `上传成功，已触发自动流程。\n` +
        `doc: ${docId}\n` +
        `source: ${file.name}\n` +
        `incoming: ${path}\n` +
        (commitUrl ? `commit: ${commitUrl}\n` : "") +
        `actions: ${actionsUrl}\n` +
        `public: ${publicUrl}`
    );
  } finally {
    uploadBtnEl.disabled = false;
  }
  return docId;
}

async function deleteIncomingByDocId() {
  const { owner, repo, branch, token } = mustGetConfig();
  const selectedFile = String(deleteSelectEl?.value || "").trim();
  const inputDocId = normalizeDocId(deleteDocIdEl?.value);
  const selectedDocId = extractDocIdFromIncomingName(deleteSelectEl?.value);
  const docId = inputDocId || selectedDocId;
  if (!selectedFile && !docId) {
    throw new Error("请先输入要删除的 Doc ID，或先选择 existing incoming 文件。");
  }

  deleteBtnEl.disabled = true;
  setStatus("正在匹配要删除的文件...");

  try {
    const files = await fetchIncomingHtmlFiles({ owner, repo, branch, token });
    let targetFile = "";

    if (selectedFile && files.includes(selectedFile)) {
      targetFile = selectedFile;
    } else if (docId) {
      targetFile =
        files.find((name) => extractDocIdFromIncomingName(name) === docId) || "";
    }

    if (!targetFile && docId) {
      const candidates = [`${docId}.html`, `${docId}.htm`];
      targetFile = files.find((name) => candidates.includes(name)) || "";
    }

    if (!targetFile) {
      throw new Error(
        `未匹配到可删除文件。请先点击“加载 incoming”，再从下拉框选中文件后删除。`
      );
    }

    const incomingPath = `incoming/${targetFile}`;
    const normalizedDocId = extractDocIdFromIncomingName(targetFile);
    setStatus(`正在删除 ${incomingPath} ...`);
    const sha = await getFileSha({ owner, repo, branch, token, path: incomingPath });
    if (!sha) {
      throw new Error(`文件不存在：${incomingPath}`);
    }

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${incomingPath}`;
    const body = {
      message: `chore: delete incoming html (${normalizedDocId}) via public admin page`,
      sha,
      branch,
    };
    const { res, data } = await requestJson(url, "DELETE", token, body);
    if (!res.ok) {
      const message = data && data.message ? data.message : `HTTP ${res.status}`;
      throw new Error(`删除失败：${message}`);
    }

    const commitUrl = data?.commit?.html_url || "";

    // Also remove key-map row for this doc, so "View KEY" no longer returns stale data.
    let keyMapUpdated = false;
    const keyMapPath = "admin/key-map.csv";
    const keyMapFile = await getRepoTextFile({
      owner,
      repo,
      branch,
      token,
      path: keyMapPath,
    });
    if (keyMapFile.exists) {
      const allLines = keyMapFile.text.replace(/\r/g, "").split("\n");
      if (allLines.length > 0) {
        const headers = parseCsvRow(allLines[0]);
        const docIdx = headers.indexOf("doc_id");
        if (docIdx >= 0) {
          const kept = [allLines[0]];
          for (let i = 1; i < allLines.length; i += 1) {
            const line = allLines[i];
            if (!line.trim()) continue;
            const cols = parseCsvRow(line);
            const lineDocId = normalizeDocId(cols[docIdx] || "");
            if (lineDocId !== normalizedDocId) {
              kept.push(line);
            }
          }
          if (kept.length !== allLines.filter((x) => x.trim()).length) {
            const csvOut = `${kept.join("\n")}\n`;
            const updateResp = await upsertRepoTextFile({
              owner,
              repo,
              branch,
              token,
              path: keyMapPath,
              message: `chore: remove key-map row (${normalizedDocId}) via public admin page`,
              text: csvOut,
              sha: keyMapFile.sha,
            });
            if (!updateResp.res.ok) {
              const message =
                updateResp.data && updateResp.data.message
                  ? updateResp.data.message
                  : `HTTP ${updateResp.res.status}`;
              throw new Error(`incoming 已删，但更新 key-map 失败：${message}`);
            }
            keyMapUpdated = true;
          }
        }
      }
    }

    // Best effort: remove admin/keys/<doc-id>.txt if present.
    let keyFileDeleted = false;
    const keyFilePath = `admin/keys/${normalizedDocId}.txt`;
    const keyFileSha = await getFileSha({
      owner,
      repo,
      branch,
      token,
      path: keyFilePath,
    });
    if (keyFileSha) {
      const delKeyUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${keyFilePath}`;
      const delKeyBody = {
        message: `chore: delete key file (${normalizedDocId}) via public admin page`,
        sha: keyFileSha,
        branch,
      };
      const delKeyResp = await requestJson(delKeyUrl, "DELETE", token, delKeyBody);
      if (!delKeyResp.res.ok) {
        const message =
          delKeyResp.data && delKeyResp.data.message
            ? delKeyResp.data.message
            : `HTTP ${delKeyResp.res.status}`;
        throw new Error(`incoming 已删，但删除 key 文件失败：${message}`);
      }
      keyFileDeleted = true;
    }

    // Remove public payload artifacts in JJCODEWH/HTML-SECURE-REPORT.
    let publicPayloadDeleted = false;
    let publicManifestUpdated = false;
    let publicLegacyPayloadDeleted = false;
    const publicOwner = PUBLIC_SITE_OWNER;

    const publicPayloadPath = `site/payloads/${normalizedDocId}.json`;
    const payloadDeleteResp = await deleteRepoFileIfExists({
      owner: publicOwner,
      repo: PUBLIC_SITE_REPO,
      branch: PUBLIC_SITE_BRANCH,
      token,
      path: publicPayloadPath,
      message: `chore: delete payload (${normalizedDocId}) via admin page`,
    });
    publicPayloadDeleted = payloadDeleteResp.deleted;

    // Legacy compatibility: delete site/payload.json when doc_id is default.
    if (normalizedDocId === "default") {
      const legacyResp = await deleteRepoFileIfExists({
        owner: publicOwner,
        repo: PUBLIC_SITE_REPO,
        branch: PUBLIC_SITE_BRANCH,
        token,
        path: "site/payload.json",
        message: "chore: delete legacy payload.json via admin page",
      });
      publicLegacyPayloadDeleted = legacyResp.deleted;
    }

    // Update site/payloads/_manifest.json docs list.
    const publicManifestPath = "site/payloads/_manifest.json";
    const manifestFile = await getRepoTextFile({
      owner: publicOwner,
      repo: PUBLIC_SITE_REPO,
      branch: PUBLIC_SITE_BRANCH,
      token,
      path: publicManifestPath,
    });
    if (manifestFile.exists && manifestFile.text) {
      let manifestObj = null;
      try {
        manifestObj = JSON.parse(manifestFile.text);
      } catch (_err) {
        manifestObj = null;
      }
      if (manifestObj && Array.isArray(manifestObj.docs)) {
        const prevCount = manifestObj.docs.length;
        manifestObj.docs = manifestObj.docs.filter(
          (item) => normalizeDocId(item && item.doc_id) !== normalizedDocId
        );
        const nextCount = manifestObj.docs.length;
        if (nextCount !== prevCount) {
          manifestObj.count = nextCount;
          manifestObj.generated_at = new Date().toISOString();
          const nextText = `${JSON.stringify(manifestObj, null, 2)}\n`;
          const updateManifestResp = await upsertRepoTextFile({
            owner: publicOwner,
            repo: PUBLIC_SITE_REPO,
            branch: PUBLIC_SITE_BRANCH,
            token,
            path: publicManifestPath,
            message: `chore: remove doc from manifest (${normalizedDocId}) via admin page`,
            text: nextText,
            sha: manifestFile.sha,
          });
          if (!updateManifestResp.res.ok) {
            const msg =
              updateManifestResp.data && updateManifestResp.data.message
                ? updateManifestResp.data.message
                : `HTTP ${updateManifestResp.res.status}`;
            throw new Error(
              `更新公开 manifest 失败：${msg}。请检查公开仓库 PAT 是否有 Contents: Read and write 权限。`
            );
          }
          publicManifestUpdated = true;
        }
      }
    }

    const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
    const publicRepoUrl = `https://github.com/${publicOwner}/${PUBLIC_SITE_REPO}`;
    setStatus(
      `删除成功。\n` +
        `doc: ${docId || normalizedDocId}\n` +
        `deleted: ${incomingPath}\n` +
        `key-map: ${keyMapUpdated ? "已移除对应记录" : "未找到对应记录"}\n` +
        `key-file: ${keyFileDeleted ? "已删除" : "未找到"}\n` +
        `public-payload: ${publicPayloadDeleted ? "已删除" : "未找到"}\n` +
        `public-manifest: ${publicManifestUpdated ? "已更新" : "未找到对应条目"}\n` +
        `public-legacy-payload: ${publicLegacyPayloadDeleted ? "已删除" : "未处理"}\n` +
        (commitUrl ? `commit: ${commitUrl}\n` : "") +
        `actions: ${actionsUrl}\n` +
        `public-repo: ${publicRepoUrl}`
    );

    if (docIdEl.value && normalizeDocId(docIdEl.value) === docId) {
      docIdEl.value = "";
    }
    if (deleteSelectEl && extractDocIdFromIncomingName(deleteSelectEl.value) === docId) {
      deleteSelectEl.value = "";
    }
    if (deleteDocIdEl) {
      deleteDocIdEl.value = "";
    }

    try {
      await listIncomingFiles({ silent: true });
    } catch (_err) {
      // Keep success status even if reload list fails.
    }
  } finally {
    deleteBtnEl.disabled = false;
  }
}

[ownerEl, repoEl, branchEl].forEach((el) => {
  el.addEventListener("input", syncRepoLabel);
});

htmlFileEl.addEventListener("change", () => {
  if (!docIdEl.value.trim()) {
    docIdEl.value = "";
  }
});

incomingSelectEl.addEventListener("change", () => {
  if (incomingSelectEl.value) {
    const normalized = extractDocIdFromIncomingName(incomingSelectEl.value);
    docIdEl.value = normalized;
  }
});

if (deleteSelectEl) {
  deleteSelectEl.addEventListener("change", () => {
    if (deleteSelectEl.value) {
      deleteDocIdEl.value = extractDocIdFromIncomingName(deleteSelectEl.value);
    }
  });
}

function bindAdminHandlers() {
loadFilesBtnEl.addEventListener("click", async () => {
  try {
    await listIncomingFiles();
  } catch (error) {
    setStatus(error.message, true);
  }
});

checkRunsBtnEl.addEventListener("click", async () => {
  try {
    await checkLatestRuns();
  } catch (error) {
    setStatus(error.message, true);
  }
});

viewKeyBtnEl.addEventListener("click", async () => {
  try {
    setStatus("开始查询 KEY...");
    await viewKeyByDocId();
  } catch (error) {
    keyOutputEl.value = "";
    setStatus(error.message, true);
  }
});

uploadBtnEl.addEventListener("click", async () => {
  try {
    const { owner, repo, branch, token } = mustGetConfig();
    const docId = getUploadTargetDocId();
    await uploadAndTrigger(docId);
    if (docId) {
      const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
      const publicUrl = `https://jjcodewh.github.io/HTML-SECURE-REPORT/?doc=${encodeURIComponent(docId)}&desktop=1`;
      const ready = await waitForDocReady({ owner, repo, branch, token, docId });
      if (ready.ready) {
        keyOutputEl.value = ready.key;
        setStatus(
          `上传并发布完成。\n` +
            `doc: ${docId}\n` +
            `key: 已生成并可查询\n` +
            `actions: ${actionsUrl}\n` +
            `public: ${publicUrl}`
        );
      } else {
        setStatus(
          `上传已提交，流程仍在进行中。\n` +
            `doc: ${docId}\n` +
            `actions: ${actionsUrl}\n` +
            `public: ${publicUrl}\n` +
            `提示：稍后可点“查看流程状态”。`
        );
      }
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

deleteBtnEl.addEventListener("click", async () => {
  try {
    const { owner, repo, branch, token } = mustGetConfig();
    const docId = normalizeDocId(deleteDocIdEl?.value || deleteSelectEl?.value);
    await deleteIncomingByDocId();
    if (docId) {
      const removed = await waitForDocRemoved({ owner, repo, branch, token, docId });
      if (removed.removed) {
        setStatus(`${statusEl.textContent}\n同步检查: 已确认删除完成`);
      } else {
        setStatus(`${statusEl.textContent}\n同步检查: 仓库删除已完成，页面缓存可能延迟 1-2 分钟`);
      }
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

keyOutputEl.addEventListener("focus", () => {
  keyOutputEl.select();
});
}

syncRepoLabel();
const compat = browserCompat();
if (!compat.ok) {
  const disabledMsg = compat.isIE
    ? "当前是 IE/IE 模式，管理页不支持。请改用 Chrome / Edge 或 Safari 15+。"
    : "当前浏览器能力不足，管理页不支持。请改用 Chrome / Edge 最新版，或 Safari 15+。";
  [
    ownerEl,
    repoEl,
    branchEl,
    tokenEl,
    loadFilesBtnEl,
    checkRunsBtnEl,
    incomingSelectEl,
    docIdEl,
    viewKeyBtnEl,
    htmlFileEl,
    uploadBtnEl,
    deleteSelectEl,
    deleteDocIdEl,
    deleteBtnEl,
    keyOutputEl,
  ].forEach((el) => {
    if (el) el.disabled = true;
  });
  setStatus(disabledMsg, true);
} else {
  bindAdminHandlers();
  setStatus("页面已就绪，请输入 PAT 后操作。");
}
