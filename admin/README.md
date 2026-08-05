# Admin Files

This directory is for administrators only.

- `key-map.csv`: doc to key mapping for encrypted html payloads.
- Keep this repository private if `key-map.csv` contains real keys.

Recommended process:

1. Add source html to `private/`.
2. Run `node tools/add-doc.mjs <doc-id> <input-html>`.
3. Update `admin/key-map.csv` owner/notes if needed.
4. Commit and push. Only `site/` is deployed by Pages workflow.
