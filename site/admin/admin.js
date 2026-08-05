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
const deleteDocIdEl = document.getElementById("deleteDocId");
const deleteBtnEl = document.getElementById("deleteBtn");
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
  files.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    incomingSelectEl.appendChild(opt);
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
    const path = `incoming/${docId}.html`;
    const sha = await getFileSha({ owner, repo, branch, token, path });
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

async function deleteIncomingByDocId() {
  const { owner, repo, branch, token } = mustGetConfig();
  const selectedFile = String(incomingSelectEl.value || "").trim();
  const inputDocId = normalizeDocId(deleteDocIdEl?.value);
  const selectedDocId = normalizeDocId(docIdEl.value || incomingSelectEl.value);
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
        files.find((name) => normalizeDocId(name) === docId) || "";
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
    const normalizedDocId = normalizeDocId(targetFile);
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

    const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
    setStatus(
      `删除成功。\n` +
        `doc: ${docId || normalizedDocId}\n` +
        `deleted: ${incomingPath}\n` +
        `key-map: ${keyMapUpdated ? "已移除对应记录" : "未找到对应记录"}\n` +
        `key-file: ${keyFileDeleted ? "已删除" : "未找到"}\n` +
        (commitUrl ? `commit: ${commitUrl}\n` : "") +
        `actions: ${actionsUrl}`
    );

    if (incomingSelectEl.value === `${docId}.html`) {
      incomingSelectEl.value = "";
    }
    if (docIdEl.value && normalizeDocId(docIdEl.value) === docId) {
      docIdEl.value = "";
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
  if (!docIdEl.value.trim() && htmlFileEl.files && htmlFileEl.files[0]) {
    docIdEl.value = normalizeDocId(htmlFileEl.files[0].name);
  }
});

incomingSelectEl.addEventListener("change", () => {
  if (incomingSelectEl.value) {
    const normalized = normalizeDocId(incomingSelectEl.value);
    docIdEl.value = normalized;
    if (deleteDocIdEl && !deleteDocIdEl.value.trim()) {
      deleteDocIdEl.value = normalized;
    }
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
  }
});

uploadBtnEl.addEventListener("click", async () => {
  try {
    await uploadAndTrigger();
  } catch (error) {
    setStatus(error.message, true);
  }
});

deleteBtnEl.addEventListener("click", async () => {
  try {
    await deleteIncomingByDocId();
  } catch (error) {
    setStatus(error.message, true);
  }
});

keyOutputEl.addEventListener("focus", () => {
  keyOutputEl.select();
});

syncRepoLabel();
setStatus("页面已就绪，请输入 PAT 后操作。");
