# HTML-SECURE-REPORT

Single private repository model:

- `site/` is public deployment output (GitHub Pages publishes only this folder).
- `admin/` stores administrator-only mapping files (`doc_id -> key`).
- `private/` stores source html files used for encryption.

## Access model

1. Visitor opens: `https://jjcodewh.github.io/HTML-SECURE-REPORT/?doc=<doc_id>`
2. Frontend loads `site/payloads/<doc_id>.json`
3. Visitor inputs KEY
4. Browser decrypts html and renders it

## Add or update one html document

```bash
node tools/add-doc.mjs <doc-id> <input-html>
```

Example:

```bash
node tools/add-doc.mjs finance-2026 private/report.template.html
```

This command will:

- generate `site/payloads/<doc-id>.json`
- upsert `admin/key-map.csv`

## Deploy

Workflow file: `.github/workflows/secure-report-pages.yml`

- Pages source should be `GitHub Actions`
- Only `site/**` changes trigger deployment

## Security notes

- Keep repository private if `admin/key-map.csv` contains real keys.
- Do not expose raw keys in public channels.
- Rotate keys and regenerate payloads if a key leaks.
