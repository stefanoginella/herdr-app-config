# This Herdr setup

This folder is the Herdr app's home and also a git repository of the owner's customizations.

**Read `AGENTS.md` in this folder in full before changing anything, unless it is already in your context.** It is Herdr's manual for the installed version. Herdr rewrites it on every start, so never edit it: notes about this setup belong in this file.

Why this file has this name: Codex reads one instruction file per folder and prefers `AGENTS.override.md`, so it gets these notes and the pointer above. Claude Code gets both files through the imports in `CLAUDE.md`.

## What is custom

Everything not listed here is Herdr's and is replaced on every start.

- **Layout `main-folders`** (`layouts/main-folders.json`): a clone of Herdr's `main` (from version 0.1.16). The only differences are that its `spaces` block shows the mod `space-folders`, its `agents` block shows the mod `agents-unread` and its `files` block shows the mod `files-actions`.
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

- **Mod `files-actions`** (`mods/files-actions/`): a clone of Herdr's `files` panel (from version 0.1.16) with file type icons, a dot on folders with git changes inside, a right-click menu (open in VS Code, Obsidian or TextEdit, reveal in Finder, rename, duplicate, copy and paste through the clipboard, move to the Trash), drag to move or to paste a path in a terminal, files dropped from Finder, and undo.
  - `main.js`: the panel. `refresh()` also reads what git ignores, which folders have changes inside and Obsidian's vaults; `rows()` draws and carries the drag and drop handlers; `follow()` and `watch()` notice a drag leaving the panel; `act()` runs a request and keeps how to take it back in `last`; `bring()` copies in files from outside; `moved()` / `gone()` keep the tree's open folders in step.
  - `ops.js`: every file operation, and the request channel. Its header lists the requests. `MOVE` and `COPY` are the two shell scripts every change to a file goes through; the clipboard is reached through `osascript`.
  - `menu.js`: the right-click menu. `naming.js`: the rename dialog. `confirm.js`: the Trash question. The mod opens itself for these, with `props().menu`, `props().naming` or `props().confirm`.
  - `icons.js`: which icon a name gets. `icons/`: Material Icon Theme's SVGs and `map.js`, both written by `icons/build.py` from a release of that package (see its header). Never edit them by hand.
  - State: a request waits in shared `files-actions.request` only until the panel takes it. What undo takes back is in the panel's memory only. Nothing else is kept.
  - Key command: `files-actions.undo`, bound to `cmd-z` in the `global` section of `keys.json`.

## Behavior to preserve in `files-actions`

- A menu or a dialog never runs a program itself: its copy closes at once, and what it started is cancelled before it answers. It calls `ops.request()`, and the panel runs it. The same holds for `space-folders`' `open.js`.
- Nothing is overwritten. A rename or a move goes through the one `MOVE` script in `ops.js`, which refuses a name that exists (except a change of case of the same file). A copy goes through the one `COPY` script, which claims its name (`mkdir`, or a no-clobber create) before it copies: a duplicate takes the first free "copy" name, and a file from outside keeps its name or is refused.
- The Trash, opening in an app, Finder and the clipboard are for files on this Mac (`ops.canOpen`, `ops.canTrash`, `ops.canShare`). On another machine the menu offers Rename and Duplicate only, and drag still moves.
- Undo is one step, of the last request that changed a file. A move or a rename goes back through `MOVE`, so it is refused when the old name has been taken. A trashed file comes back from the path `trash -v` printed. After a duplicate, a paste or a drop from Finder there is nothing to undo, rather than something older: the record is cleared when a change begins, not when it ends. An undo is not itself undone. The key is global, so a stale record must find nothing: it is dropped when the panel shows another folder, and ignored after five minutes (`UNDO_FOR`).
- Files from Finder are copied, never moved.
- Pointer positions come in window pixels: multiply a length of the panel's by `settings().zoom` before comparing the two.
- Obsidian opens a folder only as a vault: a folder or a project gets "Open in Obsidian" only inside a registered vault. A Markdown, canvas or base file gets it anywhere.
- A drag is over the folder of the row under the pointer (a folder row: itself). It can't land where the entry already is, or inside itself.
- One press on a row begins two things: Herdr's file drag (`drag_paths`: the name that follows the pointer, and a path pasted where a terminal takes it) and this panel's own move, which lands on the release over a row or under the list. The panel is not told when Herdr's drag leaves the list or ends on a terminal: while that drag is under way GPUI reports no hover at all. So `this.drag` can be left behind, and **a release must never be able to use a drag left behind**. What ends one: the pointer coming into the list once Herdr's drag is over (the tree's `on_hover`; it ends a drag that was seen moving, and any drag pressed more than `FRESH` ms ago, since one can leave too fast to be seen moving), and every press that didn't begin it, in the panel (`on_mouse_down` on the root) or anywhere else in the window (`on_mouse_down_out`). Keep all of them.
- Every element with a left mouse-up handler also has its own `on_drop`: a drop from Finder is a mouse-up too, and only the element's own drop handler runs before it.
- `watch()` only decides what is drawn (nothing aimed at or faded once the drag has left the panel). It guesses, from the last pointer position seen, and must never be what protects a file.
- The Trash is `/usr/bin/trash`, by its path: another `trash` on the `PATH` may read `-v` differently.
- Left-click is Herdr's: a file opens the preview, a folder folds.

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
- A menu, a dialog or a request can be driven from a shell with a throwaway mod: `mod.json` `{ "place": "none", "overlay": { "width": 60, "height": 30 } }`, opened with `herdr-app do mod.open --name <mod>`, whose `init` reads a JSON file and calls `openOverlay(...)` or `setShared("files-actions.request", ...)`, then closes itself. A request carries its own `root`, so the live panel runs it against a scratch folder. A mod can only import from its own folder: copy the modules it needs into it. Every overlay takes the keyboard from the owner while it is open, so keep these runs few and short, and delete the mod afterwards (`.gitignore` never tracks it).
- When a question is about how Herdr delivers an event or a key, read its source at the installed version's tag instead of guessing: the GPUI fork is under `vendor/gpui-pre`, the script bridge under `vendor/gpui-kit/crates/shell`.
- These clones do not receive Herdr's updates, so check them after Herdr updates. Each clone was made from the version named under "What is custom". When `herdr-app --version` is newer, see what Herdr changed in each original since then, port what matters into the clone, and update the version named here, in `README.md` and in `NOTICE`. Herdr's source is public at `github.com/herdrdev/herdr-app`, tagged per version (`v0.1.16`), with the shipped files under `defaults/`. The installed original is already the new version, so only the old one is fetched:

  ```sh
  diff <(gh api "repos/herdrdev/herdr-app/contents/defaults/mods/agents/main.js?ref=v0.1.16" -H "Accept: application/vnd.github.raw") mods/agents/main.js
  ```

  The originals: `defaults/mods/spaces/main.js` for `space-folders`, `defaults/mods/agents/main.js` for `agents-unread`, `defaults/mods/files/main.js` for `files-actions`, `defaults/layouts/main.json` for `main-folders`.

- The icons in `mods/files-actions/icons/` are a release of Material Icon Theme (MIT), named in `icons/map.js` and in `NOTICE`. To update them, follow the header of `icons/build.py`, then update the version in `NOTICE`.

## Git

- `.gitignore` is an allowlist: everything is ignored unless listed. A new mod, layout, theme or root file needs a line there.
- **This repository is public. Before every commit, read the staged diff (`git diff --cached`) and make sure it holds nothing that should not be public:** no secrets, tokens, passwords, API or SSH keys; no personal information (names, email addresses, phone numbers, addresses); no home or project paths (`/Users/...`, `/Volumes/...`), machine or host names, client or project names; nothing else private or security-sensitive. This applies to every committed file, including settings, key bindings, notes, screenshots and commit messages. If something like that is needed locally, keep it in an ignored file. The deliberate exceptions: the owner's name in the `NOTICE` copyright line, and the author name and email that git takes from its own config for a commit. The owner's email address must never appear in any file. If you are unsure whether something is safe to publish, stop and ask before committing.
- Never track state: `shared.json`, `view.json`, `data/`, `layouts/.state/`, or anything Herdr ships. State holds space names, folder paths and project names.
- Commit messages follow Conventional Commits: `<type>(<scope>): <description>`, then an optional body and footers.
