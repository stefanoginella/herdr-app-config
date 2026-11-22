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

- **Mod `files-actions`** (`mods/files-actions/`): a clone of Herdr's `files` panel (from version 0.1.16), without its preview (a click on a file opens it in `file-editor`), with file type icons, a dot on folders with git changes inside, a right-click menu (open in VS Code, Obsidian or TextEdit, reveal in Finder, new file and new folder, rename, duplicate, copy and paste through the clipboard, move to the Trash), drag to move or to paste a path in a terminal, files dropped from Finder, and undo.
  - `main.js`: the panel. `open()` asks the tab's editor for a file, and splits one in when the tab has none; `location()` keeps the folder shown while an editor has the focus. `refresh()` also reads what git ignores, which folders have changes inside and Obsidian's vaults; `rows()` draws and carries the drag and drop handlers; `follow()` and `watch()` notice a drag leaving the panel; `act()` runs a request and keeps how to take it back in `last`; `bring()` copies in files from outside; `moved()` / `gone()` keep the tree's open folders in step.
  - `ops.js`: every file operation, and the request channel. Its header lists the requests. `MOVE`, `COPY` and `MAKE` are the three shell scripts every change to a file goes through; the clipboard is reached through `osascript`.
  - `menu.js`: the right-click menu. `naming.js`: the dialog that asks for a name, for a rename or a new file or folder. `confirm.js`: the Trash question. The mod opens itself for these, with `props().menu`, `props().naming` or `props().confirm`.
  - `icons.js`: which icon a name gets. `icons/`: Material Icon Theme's SVGs and `map.js`, both written by `icons/build.py` from a release of that package (see its header). Never edit them by hand.
  - State: a request waits in shared `files-actions.request` only until the panel takes it. What undo takes back is in the panel's memory only. Nothing else is kept.
  - Key command: `files-actions.undo`, bound to `cmd-z` in the `global` section of `keys.json`.

- **Mod `file-editor`** (`mods/file-editor/`): a text editor that opens as a pane beside the terminals. It is not a clone: Herdr ships nothing like it. One editor a tab, its open files as a strip of tabs; wrapped lines, save, find and replace, Markdown shortcuts and a rendered preview, comment and line commands.
  - `main.js`: the pane. `load()` opens a file; `changed()` and `entered()` follow the typing; `look()` reads the file again and `take()` shows what it found; `save()`; `shut()` closes a tab; `search()`, `step()`, `replaceOne()`, `replaceAll()` are the find bar; `command()` runs a key command or a button; `requests()` takes what the Files panel asked for.
  - `remote.js`: saving a file on another machine. Its header says how. The script in it runs under any `sh`, so it is tested with a local one, and against a real machine through `hc exec --on`.
  - `edit.js`: what every command does to text, as functions of the text and the selection that return one edit. Nothing in it touches the app, so it runs under `node`: test a change to it there.
  - State: the open files and their unsaved text, in the copy's `localStorage` (one store for each tab, since the props are `{ tab }`). Shared `file-editor.open` (`{ tab, path, on, at }`) holds a request only until the tab's editor takes it; shared `file-editor.moved` (`{ from, to, on, at }`) is the last rename or move the Files panel made.
  - Key commands, bound in the `mod:file-editor` section of `keys.json`: `save`, `find` (also in `mod:file-editor > Input`, see below), `replace`, `find-next`, `find-prev`, `escape`, `preview`, `close` (not bound), `bold`, `italic`, `code`, `strike`, `link`, `bullets`, `numbers`, `tasks`, `comment`, `line-up`, `line-down`, `duplicate`, `next-same`.

## Behavior to preserve in `file-editor`

- Nothing is saved until asked. A save passes the text last read from the file (`base`) to `writeTextFile`, which refuses when the file is no longer that: the editor then asks, and never writes over a change it has not shown. `base` is `null` only when there is no file, and a save then creates it.
- A change on disk replaces the text only when nothing is unsaved (`take()`). With unsaved text it becomes a question (`notice: "changed"`), and "Keep my text" only moves `base` to what is on disk: the text stays unsaved.
- Unsaved text is put in `localStorage` as it is typed (`stash()`) and when the pane closes (`close()`), with the `base` it began from. `close()` can't ask anything, so this is what keeps a closed pane from losing text. A restored draft whose file changed meanwhile becomes the same question.
- Only whole files are edited: one cut short at `MOST` characters is read-only.
- A file on another machine is saved by `remote.js`, since `writeTextFile` is local: a shell script run there with `sh` through `exec`, the text as its arguments, in pieces of `PIECE` characters (one argument holds about 128 KB on Linux). Nothing is installed there. It keeps the same promise as a local save: it reads the file's checksum (`cksum`) and text in one call, refuses when the text is not `base`, and with the last piece refuses when the checksum is no longer that (`Stale`). The check and the write are not one step: a change landing in between is lost.
- The remote script writes into the file (`cat > file`), never moves a new file over it: a script stays executable, a symlink stays a link. Don't change that to `mv` for atomicity.
- The script's values are its arguments (`$1`…`$6`), never part of its text: a path or a file's content must not be put into the script string.
- A save that is cut off (the pane closes between two pieces) leaves a hidden `.<name>.herdr-<random>` file next to the file on that machine. Nothing clears it.
- A file from another machine with a character that could not be decoded (`\ufffd`) is read-only: it is not UTF-8, and a save would write it back as something else.
- An edit is `set_selected_range`, then one `replace`: one undo step. `set_value` is only for text read from disk, since it drops the undo history.
- The editor's own keys win over the `mod:file-editor` section while the text has the keyboard: undo, redo, Enter, Tab, Cmd+Alt+Up/Down, Cmd+[ and Cmd+], and Cmd+F and Cmd+Shift+F, which Herdr's code editor takes for a search of its own that draws no bar (`searchable` in its source). Escape passes when there is one cursor.
- A key the editor binds is given to a command from the section `mod:file-editor > Input` of `keys.json`: Cmd+F is there. Herdr turns a section `mod:<x>` into the key context `mod == <x>`, so this one is "the editor's text, in this mod": as deep as the editor's own bindings, and bound after them, so it wins. Cmd+F stays in `mod:file-editor` too, for when the keyboard is in the pane and not in the text. This form of section is not in Herdr's manual: after a Herdr update, look for `keys.error`.
- List continuation happens in `entered()`, on the editor's `submit` event, which comes after the line break is in: `edit.continued()` compares the text before and after. It must not run on `change` alone: an undo that brings a line break back looks the same.
- The editor paints a selection only while it has the keyboard, so a match is not highlighted while the find field has it. The find bar says its line instead, and that line is a button (`goTo()`, also Cmd+Enter in the field) that moves the keyboard to the text with the match selected. Don't do that on a plain Enter: the next key would type over the match.
- Herdr exposes one selection and no scroll position to a mod. So `next-same` moves the selection instead of adding a cursor, the find bar can't highlight every match, and nothing can stay pinned while the text scrolls.
- The keys in `mod:file-editor` count only while the keyboard is inside the pane, and Herdr gives a mod pane no place for it. So the pane has its own (`this.handle`, on the root), and `focus()` puts the keyboard in the text or, when there is none to type in (the preview, no file), there. Whatever takes the text away must call `focus()`, or the keys stop until a click.
- A file asked for by the Files panel takes the keyboard twice: at once, and `REFOCUS` ms later, because Herdr focuses the pane after the click.
- The pane also takes the keyboard when it becomes the focused pane (`arrived()`: its header was clicked, `pane.focus`), since Herdr hands a mod pane none. With the keyboard outside the pane, Cmd+F is the menu bar's Find, which fails on a pane without a terminal.
- The strip gives the keyboard to the text on the click, not on the press: the press gives it to the pane itself (`track_focus` on the root), after any handler of the press.
- A character typed over a selection wraps it (`typed()`, `edit.surround()`). It is caught in `on_key_down` on the element around the editor, which runs only for a key no binding took, before the character is typed, and stops it. It must stay there and not move to `change`: an undo can leave the same trace as typing a character over a selection. A character made by a dead key or an input method never comes this way, and is typed as usual.
- A new item in a numbered list counts the items under it on (`edit.continued()`), in the same edit. A list numbered `1.` all the way down stays so.
- A wrapped line starts under its line's own leading spaces: that is Herdr's editor, which offers a mod no other choice.

## Behavior to preserve in `files-actions`

- A menu or a dialog never runs a program itself: its copy closes at once, and what it started is cancelled before it answers. It calls `ops.request()`, and the panel runs it. The same holds for `space-folders`' `open.js`.
- Nothing is overwritten. A rename or a move goes through the one `MOVE` script in `ops.js`, which refuses a name that exists (except a change of case of the same file). A copy goes through the one `COPY` script, which claims its name (`mkdir`, or a no-clobber create) before it copies: a duplicate takes the first free "copy" name, and a file from outside keeps its name or is refused. A new file or folder goes through the one `MAKE` script, which refuses a name that exists and creates with `mkdir` or a no-clobber create.
- The Trash, opening in an app, Finder and the clipboard are for files on this Mac (`ops.canOpen`, `ops.canTrash`, `ops.canShare`). On another machine the menu offers New File, New Folder, Rename and Duplicate only, and drag still moves.
- Undo is one step, of the last request that changed a file. A move or a rename goes back through `MOVE`, so it is refused when the old name has been taken. A trashed file comes back from the path `trash -v` printed. After a duplicate, a paste, a drop from Finder or a new file or folder there is nothing to undo, rather than something older: the record is cleared when a change begins, not when it ends. An undo is not itself undone. The key is global, so a stale record must find nothing: it is dropped when the panel shows another folder, and ignored after five minutes (`UNDO_FOR`).
- Files from Finder are copied, never moved.
- Pointer positions come in window pixels: multiply a length of the panel's by `settings().zoom` before comparing the two.
- Obsidian opens a folder only as a vault: a folder or a project gets "Open in Obsidian" only inside a registered vault. A Markdown, canvas or base file gets it anywhere.
- A drag is over the folder of the row under the pointer (a folder row: itself). It can't land where the entry already is, or inside itself.
- One press on a row begins two things: Herdr's file drag (`drag_paths`: the name that follows the pointer, and a path pasted where a terminal takes it) and this panel's own move, which lands on the release over a row or under the list. The panel is not told when Herdr's drag leaves the list or ends on a terminal: while that drag is under way GPUI reports no hover at all. So `this.drag` can be left behind, and **a release must never be able to use a drag left behind**. What ends one: the pointer coming into the list once Herdr's drag is over (the tree's `on_hover`; it ends a drag that was seen moving, and any drag pressed more than `FRESH` ms ago, since one can leave too fast to be seen moving), and every press that didn't begin it, in the panel (`on_mouse_down` on the root) or anywhere else in the window (`on_mouse_down_out`). Keep all of them.
- Every element with a left mouse-up handler also has its own `on_drop`: a drop from Finder is a mouse-up too, and only the element's own drop handler runs before it.
- `watch()` only decides what is drawn (nothing aimed at or faded once the drag has left the panel). It guesses, from the last pointer position seen, and must never be what protects a file.
- The Trash is `/usr/bin/trash`, by its path: another `trash` on the `PATH` may read `-v` differently.
- Left-click: a folder folds, a file opens in the tab's editor. The panel never runs the editor: it leaves the file in shared `file-editor.open` and focuses the tab's `file-editor` pane, or splits one in with props `{ tab }` beside the focused pane. After a move or a rename it leaves `file-editor.moved`, so an open file goes on under its new name. A new file is opened the same way once it is made (`act()`), when the panel still shows the folder it was asked from; the folder it is in unfolds (`made()`).
- While a mod pane (the editor) has the focus the panel keeps the folder of the terminal that had it before, in that tab (`held` in `location()`): a mod pane is in no folder, and the tree must not jump to the space's folder when a file is clicked.

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
- `file-editor`'s key commands run from a shell (`herdr-app do file-editor.save`), on the editor of the tab shown. Its selection and what is typed can't be set from there.
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
