# This Herdr setup

This folder is the Herdr app's home and also a git repository of the owner's customizations.

**Read `AGENTS.md` in this folder in full before changing anything, unless it is already in your context.** It is Herdr's manual for the installed version. Herdr rewrites it on every start, so never edit it: notes about this setup belong in this file.

Why this file has this name: Codex reads one instruction file per folder and prefers `AGENTS.override.md`, so it gets these notes and the pointer above. Claude Code gets both files through the imports in `CLAUDE.md`.

## What is custom

Everything not listed here is Herdr's and is replaced on every start.

- **Layout `main-folders`** (`layouts/main-folders.json`): a clone of Herdr's `main` (from version 0.1.16). The only differences are that its `spaces` block shows the mod `space-folders` and its `agents` block shows the mod `agents-unread`.
- **Mod `space-folders`** (`mods/space-folders/`): a clone of Herdr's `spaces` sidebar (from version 0.1.16) with one level of named, foldable folders of spaces.
  - `main.js`: the sidebar. `arrange()` reconciles the model with the open spaces and syncs the real space order to it with `space.move`; `section()` draws; `row()`, `folderRow()`, `emptyRow()` and `tail()` carry the drag-and-drop handlers.
  - `model.js`: the folder state and every change to it. Always `load()`, change the copy, `save()`.
  - `menu.js`: the right-click menus (space, folder, root). `naming.js`: the new/rename dialog. The mod opens itself for both, with `props().menu` or `props().naming`.
  - State lives in shared `space.folders`: `{ root: [spaceId | { id, name, folded, spaces }], projects: { projectKey: folderId }, next }`.
  - `open.js`: opening a space's project in VS Code or Obsidian, from the space menu. The menu leaves a request in shared `space-folders.open`; the sidebar takes it and runs it.
  - Key commands: `space-folders.new-folder`, `space-folders.fold-all`, `space-folders.unfold-all`. None is bound.

- **Mod `agents-unread`** (`mods/agents-unread/`): a clone of Herdr's `agents` list (from version 0.1.16) where an idle agent can be marked unread. A marked agent is drawn as done: the done dot, and the Done section in the priority view.
  - `main.js`: the list. `settle()` drops the marks that have served; `render()` turns a marked idle agent's status into `done` before anything is drawn; `row()` wraps the status dot in the click target and opens the menu on right-click.
  - `unread.js`: the marks and every change to them. `menu.js`: a row's right-click menu (mark as unread or read, pin or unpin). The mod opens itself for it, with `props().menu`.
  - State lives in shared `agents.unread`: `{ address: { left } }`. `left` means another pane has had the focus since the mark.
  - Key command: `agents-unread.toggle`, for the agent being looked at. It is not bound.

## Behavior to preserve in `agents-unread`

- Unread is this mod's alone: Herdr's status is untouched, so the tab bar, the spaces sidebar and the sounds still treat a marked agent as idle.
- Only an idle agent can be marked. A mark goes when the agent is focused again after another pane had the focus, when the agent is no longer idle, or by hand. Marking the agent being looked at must not clear at once: that is what `left` is for.
- `left` turns true only while another pane is known to have the focus. With no focused pane (a popup, a terminal block) nothing changes.
- A mark whose agent is not listed is dropped only after its machine's layout has been readable for 10 seconds. Before that the agent may only be unlisted while a layout loads.
- The row's dot target takes the same room as the dot it wraps, so rows with and without it line up.

## Behavior to preserve in `space-folders`

- The sidebar's order is the truth: the real space order follows it, so `space.next` and `space.select:N` match what is drawn.
- Placement is by space id. `projects` remembers which folder a project (its repo, else its folder; never the home folder) was filed in, so a new space on that project lands there. A loose space that `cd`s into a filed project joins its folder; a filed space never moves by itself.
- A closed space is pruned only after its machine's layout has been readable for 5 seconds and still lists at least one space. Before that, a missing space may only be unlisted while a layout loads, and pruning would lose placement.
- A popup is as tall as its content, so the menu's root must not scroll (it collapses to nothing). Only the long folder list scrolls, inside a fixed height.
- A worktree space is drawn under its repo's space and follows it: it is clicked, never dragged.

## Working here

- The window is live: an edit applies to the running app within a second. After every change run `herdr-app check mods/<name>` and `herdr-app status`, and look with `herdr-app shot`.
- Pointer drags and typing cannot be driven from a shell. Say so when a change to those paths was not tried by hand.
- These clones do not receive Herdr's updates, so check them after Herdr updates. Each clone was made from the version named under "What is custom". When `herdr-app --version` is newer, see what Herdr changed in each original since then, port what matters into the clone, and update the version named here, in `README.md` and in `NOTICE`. Herdr's source is public at `github.com/herdrdev/herdr-app`, tagged per version (`v0.1.16`), with the shipped files under `defaults/`. The installed original is already the new version, so only the old one is fetched:

  ```sh
  diff <(gh api "repos/herdrdev/herdr-app/contents/defaults/mods/agents/main.js?ref=v0.1.16" -H "Accept: application/vnd.github.raw") mods/agents/main.js
  ```

  The originals: `defaults/mods/spaces/main.js` for `space-folders`, `defaults/mods/agents/main.js` for `agents-unread`, `defaults/layouts/main.json` for `main-folders`.

## Git

- `.gitignore` is an allowlist: everything is ignored unless listed. A new mod, layout, theme or root file needs a line there.
- **This repository is public. Before every commit, read the staged diff (`git diff --cached`) and make sure it holds nothing that should not be public:** no secrets, tokens, passwords, API or SSH keys; no personal information (names, email addresses, phone numbers, addresses); no home or project paths (`/Users/...`, `/Volumes/...`), machine or host names, client or project names; nothing else private or security-sensitive. This applies to every committed file, including settings, key bindings, notes, screenshots and commit messages. If something like that is needed locally, keep it in an ignored file. The deliberate exceptions: the owner's name in the `NOTICE` copyright line, and the author name and email that git takes from its own config for a commit. The owner's email address must never appear in any file. If you are unsure whether something is safe to publish, stop and ask before committing.
- Never track state: `shared.json`, `view.json`, `data/`, `layouts/.state/`, or anything Herdr ships. State holds space names, folder paths and project names.
- Commit messages follow Conventional Commits: `<type>(<scope>): <description>`, then an optional body and footers.
