# HTML-SECURE-REPORT

静态加密发布方案：仓库和 GitHub Pages 只保存密文，访问者输入 KEY 后在浏览器端解密并查看报告。

## 目录

- `site/`: 公开部署目录（可直接用于 GitHub Pages）
- `tools/`: 本地加密脚本
- `private/`: 本地明文目录（不会提交）

## 使用步骤

1. 把 `private/report.template.html` 复制为 `private/report.html` 并替换内容。
2. 在本目录执行：

```bash
node tools/encrypt-report.mjs private/report.html site/payload.json
```

3. 按提示输入 KEY（至少 16 位，建议 20+）。
4. 提交并推送 `site/` 目录，发布到 GitHub Pages。

## GitHub Pages

仓库已提供工作流：`.github/workflows/secure-report-pages.yml`，会自动发布 `HTML-SECURE-REPORT/site`。
首次使用需要在仓库 `Settings -> Pages` 里把 Source 设为 `GitHub Actions`。

## 安全边界

- 这是“前端解密”，不是服务端鉴权。
- 未知 KEY 的访问者无法直接拿到明文内容。
- KEY 泄露后，内容会被读取；请定期轮换 KEY 并重新加密。
