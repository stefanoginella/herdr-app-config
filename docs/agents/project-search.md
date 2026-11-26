# `project-search`

Notes for agents on the mod in `mods/project-search/`. The index and what holds for every mod are in `AGENTS.override.md`.

Search and replace in every file of the project, in a panel that takes the place of Files and Changes. It is not a clone: Herdr ships nothing like it. ripgrep (`rg`) does the searching, on the project's own machine.

## What is where

- `main.js`: the panel. `place()` follows the focused pane to its project; `go()` searches, `halt()` stops the search under way and `take()` shows what it found; `rows()` is every row, `row()` draws one; `reach()` draws the next `PAGE` rows when the list is scrolled near its end; `open()` asks the tab's editor for a result and `step()` goes to the next one; `replace()`, `askAll()` and `unreplace()` write; `answer()` does what another mod asked for; `key()` is the list's keyboard; `summon()` is the whole job of the copy in `search-keys`.
- `search.js`: ripgrep's arguments (`args()`, `globs()`), its JSON answer as rows (`parse()`), and what a replace does to a text (`apply()`). Nothing in it touches the app, so it runs under `node`: test a change to it there, against real `rg` output.
- `ops.js` runs the search, replace and undo (`find()`, `replace()`, `restore()`) and holds the request channel. `external-apps.js` reads the [shared external app preferences](../external-apps.md) and launches a local result. Keep its copies in `file-explorer` and `space-folders` identical.
- `remote.js`: a copy of `file-editor`'s, since a mod can only import from its own folder. Keep the two the same. `fieldkeys.js`: the keys of `mod:project-search > Input`, a copy of `file-editor`'s too.
- `menu.js`: a result's right-click menu. `confirm.js`: the Replace All question. The mod opens itself for these, with `props().menu` or `props().confirm`.
- Props: the panel's block has `{ back: { stack, child } }`, what its header's Files button shows. The `search-keys` block has `{ keys: true, show: { stack, child, panel } }`. `{ root, on }` pins the folder searched, whatever pane has the focus: for a test window.
- State: the fields, the switches and the earlier queries, in the copy's `localStorage`. The results and what undo takes back are in the panel's memory only. Shared `project-search.ask` (`{ query?, to?, folder?, on?, focus?, at }`) and `project-search.request` hold something only until the panel takes it.
- Key commands: `open`, `next`, `prev` (bound in `global`: `cmd-shift-f`, `f4`, `shift-f4`), `older`, `newer` (in `mod:project-search`), `list`, `tab`, `back-tab` (in `mod:project-search > Input`), `undo` (not bound). `open` is in the command palette.

## Behavior to preserve

- `<mod>.<command>` reaches only the copies on screen, and the panel is not on screen while the stack shows Files or Changes, or the panel column is hidden. So `project-search.open` is taken by the copy in `search-keys`, which is always shown and draws nothing: it shows the panel and leaves an ask, and the panel takes the keyboard when it sees the ask. Whoever wants a search sets `project-search.ask`, then runs `project-search.open`.
- That copy also adds `search` to Herdr's shared `workspace.panels`. Herdr's tab bar remembers which panel each space shows only among the ids listed there, and would close the panel on coming back to a space that showed Search. The tab bar draws buttons for `files` and `changes` only, and the welcome screen keeps ids it doesn't know.
- A task begun while the panel is drawn (`place()`, `asked()`, a waiting request) starts with `after()`, which waits one step. Without it the task's first step runs inside the draw, where `cx.notify()` is refused: the task ends there without a word, and the search stayed on "searching…" for ever.
- One search at a time (`running`). Asked again while one runs, that one is stopped (`halt()`) and the next starts when it ends (`next`). Whatever `ops.find()` does, `running` is cleared.
- Herdr can't cancel an `exec`, and a search that matches little reads the whole project: about 2 s in a repository of 140,000 files, which the next search would wait for. So the search script writes its shell's number to `$TMPDIR/herdr-project-search.<token>` on the machine it runs on, and `ops.stop()` ends that shell's children there with `pkill -P` (tried here and on a Linux machine). A search that times out is stopped too: Herdr ends only the shell. Without `pkill` a search runs to its end, as before.
- An answer that was stopped, or overtaken by another search, another project or a cleared field, is not read (`stale()` in `go()`): reading is most of what a search costs here. Stopped and then wanted again as it was, it runs again.
- The typing wait (`TYPE_AFTER`) is 150 ms.
- Don't add `--sort path` to have the same matches listed every time a search is capped: it makes ripgrep single-threaded, and a search that matched nothing in a 588,000-file folder went from 32 s to over two minutes.
- The list can be replaced from only while it is of the search the fields say now (`fresh()`): typing in any field makes it stale until the next search comes back.
- What a match becomes is ripgrep's word (`--replace` with `--json`), never worked out in JavaScript: the two don't read a pattern the same way. An older ripgrep doesn't say; then only a replacement without `$` groups is known (`search.plain()`).
- A replace reads the file, checks that every match is still the same text at the same place of the same line (`search.apply()`), and writes only if the file is still the text it read (`writeTextFile`'s `expected`, or `remote.js`). One match that is not where it was leaves the whole file alone. Files open in the editor are written like any other: the editor's own check shows the new text or asks.
- Undo is one step, of the last replace, kept in memory (at most `UNDO_MOST` characters): a file goes back only if it is still the text the replace left.
- The query, the filters and the replacement are ripgrep's arguments, never part of the shell script's text (`FIND` in `ops.js`).
- The local result menu offers the desktop actions whose launchers are available. The request identifies the project and file. The panel supplies the match location to a launcher that accepts `at` arguments. The search command itself uses `sh` and Unix utilities.
- ripgrep is given the folder to search (`./`): with no path it may read its input instead and never answer.
- ripgrep's answer is cut short by `awk`, which keeps only the match records, at most `MOST` of them, and the `summary`, then by `head -c`; `--max-count` limits one file. The `summary` record at its end is what says the answer is whole. The begin, end and context records were most of an answer's bytes (2 MB for 2,000 matches, 0.83 MB without them).
- `search.parse()` decodes only the match records, and what a row shows of a line (`search.pieces()`) is worked out when the row is drawn, once. Timings of the script engine under `herdr-app check` are about five times those in the app: compare like with like.
- ripgrep counts in bytes, the editor in UTF-16: `search.units()` turns one into the other. It is not run on a line over `LONG` characters that is not plain ASCII (Herdr stops a task that runs too long), so such a match is listed but can't be replaced. ripgrep also leaves a byte order mark out of the first line: `apply()` steps over it.
- Dotfiles are searched (`--hidden`), git's own folder never. Closed, the filters and "ignored files too" don't count.
- The project's folder is spelled as the terminal spells its own (`top()`), not as git does behind a link: the editor and the Files panel know a file by that path.
- Setting an input's text from code (`set_value`) sends no `change`: whatever sets one searches itself.
- The rows are plain elements, of which only `limit` are drawn, not a virtual list: Herdr's virtual list takes one click handler for the whole list, so a row in it can't be dragged or have buttons of its own. `PAGE` more are drawn with each "Show more", and by themselves when the list is scrolled to within a screen of its end (`reach()`, on the list's wheel and its left mouse-up). It adds one page at a time: not again until the layout's height is no longer `grown`, the height it had when the last page was added. "Show more" stops its click there, so a click adds one page.
- A row's buttons show while the pointer is on it (`hot`, from `on_hover`): there is no hover of a parent to style a child by.
- No `escape`, `up`, `down` or `enter` in the section `mod:project-search`: the menu and the dialog are copies of this mod and take those keys in `on_key_down`, which runs only for a key no binding took. Escape in the panel is taken the same way (`key()` → `leave()`): a one-line input passes it on. `leave()` gives the editor's text the keyboard (`file-editor.focus`) when the editor is the focused pane; from a field, the field's `blur()` hands it to the focused pane (since 0.1.18, a terminal block too); from the list, `pane.focus`. Down, Tab and Shift+Tab are in `mod:project-search > Input` (installed by `fieldkeys.js`) because the input binds them and passes nothing on.
- The list's keys count only while the list itself has the keyboard (`this.handle`): Enter in a field reaches `key()` too.

## Trying it

- `project-search` can be tried in a window on a scratch folder: `openOverlay({ mod: "project-search", kind: "window", props: { root } })`, then an ask with `focus: false`.
