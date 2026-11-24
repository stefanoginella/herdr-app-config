# Herdr update checks

Newest first. Each entry is written by the `herdr-update` skill (see its step 7 for the format).

## 2026-11-24: 0.1.17 → 0.1.18

Open:
- None.

Settled:
- 1. editor-links: take `link.line` / `link.column`; strip line ranges and `#L` anchors for remote paths — made
- 2. files-actions: fix the duplicated `watch()` (the folder watch never ran) and port Files' CPU work (own shared scan, `refreshIfDue`, per-context watch, pause while inactive) — made
- 3. space-folders: port the emoji avatar and the emoji-aware `gitTail()`; `window()?.active` — made
- 4. git-panel: pause reads and GitHub polling while the window is inactive — made
- 5. git-diff: back off after slow reads and pause while the window is inactive — made
- 6. file-editor: pause `look()` / `head()` while the window is inactive — made
- 7. Share one git scan between files-actions and git-panel through `globalThis` (undocumented contract) — declined
- 8. files-actions: end drags with `on_window_mouse_move` / `on_window_mouse_up` — made
- 9. `palette` entries in mod.json for unbound mod commands — made
- 10. Keys for `agent.select:1..9` — made
- 11. file-editor: highlight find matches in the preview; keep the preview selection when going back to the text — made
- 12. file-editor: detect tab width; a soft wrap toggle — made
- 13. main-folders: `veil` and divider hover color — made
- 14. git-panel and project-search: load more when the list is scrolled to its end — made
- 15. Smaller ideas: pickFiles "Add Files…", mouse back/forward, `raw_html(false)`, `blur()` on Escape, explicit Markdown syntax colors — made
- 16. Try again the `exec` paths after the `setsid` change (no edit) — no change needed: nothing broke in use
