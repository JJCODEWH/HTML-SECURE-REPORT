const ownerEl = document.getElementById("owner");
const repoEl = document.getElementById("repo");
const branchEl = document.getElementById("branch");
const tokenEl = document.getElementById("token");
const loadFilesBtnEl = document.getElementById("loadFilesBtn");
const checkRunsBtnEl = document.getElementById("checkRunsBtn");
const incomingSelectEl = document.getElementById("incomingSelect");
const docIdEl = document.getElementById("docId");
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
    throw new Error("请先填写 Owner/Repository/Branch/PAT。");
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
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data };
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
    setStatus("当前分支还没有 workflow run。");
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
    throw new Error(`检查文件失败：${message}`);
  }
  return data.sha;
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
    throw new Error("无效 Doc ID。");
  }

  uploadBtnEl.disabled = true;
  setStatus(`正在上传：incoming/${docId}.html ...`);

  try {
    const content = await fileToBase64(file);
    const sha = await getExistingSha({ owner, repo, branch, token, docId });
    const path = `incoming/${docId}.html`;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
    const body = {
      message: `chore: upload incoming html (${docId}) via public admin page`,
      content,
      branch,
      ...(sha ? { sha } : {})
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
      `上传成功，已触发自动加密。\n` +
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

uploadBtnEl.addEventListener("click", async () => {
  try {
    await uploadAndTrigger();
  } catch (error) {
    setStatus(error.message, true);
  }
});

syncRepoLabel();
