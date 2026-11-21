# This Herdr setup

This folder is the Herdr app's home and also a git repository of the owner's customizations.

**Read `AGENTS.md` in this folder in full before changing anything, unless it is already in your context.** It is Herdr's manual for the installed version. Herdr rewrites it on every start, so never edit it: notes about this setup belong in this file.

Why this file has this name: Codex reads one instruction file per folder and prefers `AGENTS.override.md`, so it gets these notes and the pointer above. Claude Code gets both files through the imports in `CLAUDE.md`.

## What is custom

Everything not listed here is Herdr's and is replaced on every start.

- **Layout `main-folders`** (`layouts/main-folders.json`): a clone of Herdr's `main`. The only difference is that its `spaces` block shows the mod `space-folders`.
- **Mod `space-folders`** (`mods/space-folders/`): a clone of Herdr's `spaces` sidebar (from version 0.1.16) with one level of named, foldable folders of spaces.
  - `main.js`: the sidebar. `arrange()` reconciles the model with the open spaces and syncs the real space order to it with `space.move`; `section()` draws; `row()`, `folderRow()`, `emptyRow()` and `tail()` carry the drag-and-drop handlers.
  - `model.js`: the folder state and every change to it. Always `load()`, change the copy, `save()`.
  - `menu.js`: the right-click menus (space, folder, root). `naming.js`: the new/rename dialog. The mod opens itself for both, with `props().menu` or `props().naming`.
  - State lives in shared `space.folders`: `{ root: [spaceId | { id, name, folded, spaces }], projects: { projectKey: folderId }, next }`.
  - Key commands: `space-folders.new-folder`, `space-folders.fold-all`, `space-folders.unfold-all`. None is bound.

## Behavior to preserve in `space-folders`

- The sidebar's order is the truth: the real space order follows it, so `space.next` and `space.select:N` match what is drawn.
- Placement is by space id. `projects` remembers which folder a project (its repo, else its folder; never the home folder) was filed in, so a new space on that project lands there. A loose space that `cd`s into a filed project joins its folder; a filed space never moves by itself.
- A closed space is pruned only after its machine's layout has been readable for 5 seconds and still lists at least one space. Before that, a missing space may only be unlisted while a layout loads, and pruning would lose placement.
- A popup is as tall as its content, so the menu's root must not scroll (it collapses to nothing). Only the long folder list scrolls, inside a fixed height.
- A worktree space is drawn under its repo's space and follows it: it is clicked, never dragged.

## Working here

- The window is live: an edit applies to the running app within a second. After every change run `herdr-app check mods/<name>` and `herdr-app status`, and look with `herdr-app shot`.
- Pointer drags and typing cannot be driven from a shell. Say so when a change to those paths was not tried by hand.
- These clones do not receive Herdr's updates. When Herdr changes `spaces` or `main`, compare the shipped file with the clone and port what matters.

## Git

- `.gitignore` is an allowlist: everything is ignored unless listed. A new mod, layout, theme or root file needs a line there.
- **This repository is public. Before every commit, read the staged diff (`git diff --cached`) and make sure it holds nothing that should not be public:** no secrets, tokens, passwords, API or SSH keys; no personal information (names, email addresses, phone numbers, addresses); no home or project paths (`/Users/...`, `/Volumes/...`), machine or host names, client or project names; nothing else private or security-sensitive. This applies to every committed file, including settings, key bindings, notes, screenshots and commit messages. If something like that is needed locally, keep it in an ignored file. The deliberate exceptions: the owner's name in the `NOTICE` copyright line, and the author name and email that git takes from its own config for a commit. The owner's email address must never appear in any file. If you are unsure whether something is safe to publish, stop and ask before committing.
- Never track state: `shared.json`, `view.json`, `data/`, `layouts/.state/`, or anything Herdr ships. State holds space names, folder paths and project names.
- Commit messages follow Conventional Commits: `<type>(<scope>): <description>`, then an optional body and footers.
