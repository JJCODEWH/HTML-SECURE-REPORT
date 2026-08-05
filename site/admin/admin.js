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
const statusEl = document.getElementById("status");
const repoLabelEl = document.getElementById("repoLabel");

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

async function listIncomingFiles() {
  const { owner, repo, branch, token } = mustGetConfig();
  setStatus("正在加载 incoming 文件...");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/incoming?ref=${encodeURIComponent(branch)}`;
  const { res, data } = await requestJson(url, "GET", token);
  if (!res.ok || !Array.isArray(data)) {
    const message = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`加载 incoming 失败：${message}`);
  }

  const files = data
    .filter((item) => item && item.type === "file" && /\.html?$/i.test(item.name))
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));

  incomingSelectEl.innerHTML = '<option value="">incoming/ 现有文件（可选）</option>';
  files.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    incomingSelectEl.appendChild(opt);
  });

  setStatus(`已加载 ${files.length} 个 HTML 文件。`);
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

async function getExistingSha({ owner, repo, branch, token, docId }) {
  const path = `incoming/${docId}.html`;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const { res, data } = await requestJson(url, "GET", token);
  if (res.status === 404) return null;
  if (!res.ok || !data?.sha) {
    const message = data && data.message ? data.message : `HTTP ${res.status}`;
    throw new Error(`检查已存在文件失败：${message}`);
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

async function viewKeyByDocId() {
  const { owner, repo, branch, token } = mustGetConfig();
  const selectedDocId = normalizeDocId(docIdEl.value || incomingSelectEl.value);
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
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${keyMapPath}?ref=${encodeURIComponent(branch)}`;
    const { res, data } = await requestJson(url, "GET", token);

    let csvText = "";
    if (res.ok && data?.content) {
      try {
        csvText = decodeBase64ToText(data.content);
      } catch (_err) {
        csvText = "";
      }
    }

    // Fallback: request raw csv text directly.
    if (!csvText) {
      const rawUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${keyMapPath}?ref=${encodeURIComponent(branch)}`;
      const rawResp = await requestText(rawUrl, "GET", token);
      if (!rawResp.res.ok || !rawResp.text) {
        const message =
          (data && data.message) || rawResp.text || `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `读取 key-map 失败：无权限（${message}）。请检查 PAT 是否有私有仓库 Contents: Read。`
          );
        }
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
    alert(`Doc ID: ${selectedDocId}\nKEY: ${hit.key}`);
  } finally {
    viewKeyBtnEl.disabled = false;
    viewKeyBtnEl.textContent = prevBtnText || "按 Doc ID 查 KEY";
  }
}

async function uploadAndTrigger() {
  const { owner, repo, branch, token } = mustGetConfig();
  const file = htmlFileEl.files && htmlFileEl.files[0];
  if (!file) {
    throw new Error("请先选择 HTML 文件。");
  }

  const fallbackDocId = normalizeDocId(file.name);
  const inputDocId = normalizeDocId(docIdEl.value);
  const selectedDocId = normalizeDocId(incomingSelectEl.value);
  const docId = inputDocId || selectedDocId || fallbackDocId;
  if (!docId) {
    throw new Error("Doc ID 无效。");
  }

  uploadBtnEl.disabled = true;
  setStatus(`正在上传 incoming/${docId}.html ...`);

  try {
    const content = await fileToBase64(file);
    const sha = await getExistingSha({ owner, repo, branch, token, docId });
    const path = `incoming/${docId}.html`;
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
    const publicUrl = `https://jjcodewh.github.io/HTML-SECURE-REPORT/?doc=${encodeURIComponent(docId)}`;
    setStatus(
      `上传成功，已触发自动流程。\n` +
        `doc: ${docId}\n` +
        `incoming: incoming/${docId}.html\n` +
        (commitUrl ? `commit: ${commitUrl}\n` : "") +
        `actions: ${actionsUrl}\n` +
        `public: ${publicUrl}`
    );
  } finally {
    uploadBtnEl.disabled = false;
  }
}

[ownerEl, repoEl, branchEl].forEach((el) => {
  el.addEventListener("input", syncRepoLabel);
});

htmlFileEl.addEventListener("change", () => {
  if (!docIdEl.value.trim() && htmlFileEl.files && htmlFileEl.files[0]) {
    docIdEl.value = normalizeDocId(htmlFileEl.files[0].name);
  }
});

incomingSelectEl.addEventListener("change", () => {
  if (incomingSelectEl.value) {
    docIdEl.value = normalizeDocId(incomingSelectEl.value);
  }
});

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
    alert(`查询失败：${error.message}`);
  }
});

uploadBtnEl.addEventListener("click", async () => {
  try {
    await uploadAndTrigger();
  } catch (error) {
    setStatus(error.message, true);
  }
});

keyOutputEl.addEventListener("focus", () => {
  keyOutputEl.select();
});

syncRepoLabel();
setStatus("页面已就绪，请输入 PAT 后操作。");
