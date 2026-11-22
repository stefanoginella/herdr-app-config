# This Herdr setup

This folder is the Herdr app's home and also a git repository of the owner's customizations.

**Read `AGENTS.md` in this folder in full before changing anything, unless it is already in your context.** It is Herdr's manual for the installed version. Herdr rewrites it on every start, so never edit it: notes about this setup belong in this file.

Why this file has this name: Codex reads one instruction file per folder and prefers `AGENTS.override.md`, so it gets these notes and the pointer above. Claude Code gets both files through the imports in `CLAUDE.md`.

## What is custom

Everything not listed here is Herdr's and is replaced on every start.

- **Layout `main-folders`** (`layouts/main-folders.json`): a clone of Herdr's `main` (from version 0.1.16). The differences: its `spaces` block shows the mod `space-folders`, its `agents` block shows the mod `agents-unread`, its `files` block shows the mod `files-actions` and its `changes` block shows the mod `git-panel` (the block keeps its id, so the tab bar's Changes button opens it); the panel's stack has a third child, `search`, which shows the mod `project-search`; and the `work` column ends with `search-keys`, a block 0 px tall with a second copy of `project-search` that only takes a key.
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
  - `main.js`: the panel. `open()` asks the tab's editor for a file, and splits one in when the tab has none; `location()` keeps the folder shown while an editor has the focus. `refresh()` also reads what git ignores, which folders have changes inside and Obsidian's vaults; `shown()` finds the row of the file the tab's editor shows; `rows()` draws, highlights that row and carries the drag and drop handlers; `follow()` and `watch()` notice a drag leaving the panel; `act()` runs a request and keeps how to take it back in `last`; `bring()` copies in files from outside; `moved()` / `gone()` keep the tree's open folders in step.
  - `ops.js`: every file operation, and the request channel. Its header lists the requests. `MOVE`, `COPY` and `MAKE` are the three shell scripts every change to a file goes through; the clipboard is reached through `osascript`.
  - `menu.js`: the right-click menu. `naming.js`: the dialog that asks for a name, for a rename or a new file or folder. `confirm.js`: the Trash question. The mod opens itself for these, with `props().menu`, `props().naming` or `props().confirm`.
  - `icons.js`: which icon a name gets. `icons/`: Material Icon Theme's SVGs and `map.js`, both written by `icons/build.py` from a release of that package (see its header). Never edit them by hand.
  - State: a request waits in shared `files-actions.request` only until the panel takes it. What undo takes back is in the panel's memory only. Nothing else is kept.
  - Key command: `files-actions.undo`, bound to `cmd-z` in the `global` section of `keys.json`.
  - The header's lens runs `project-search.open`; a folder's "Find in Folder…" (menu.js) leaves `project-search.ask` first.

- **Mod `file-editor`** (`mods/file-editor/`): a text editor that opens as a pane beside the terminals. It is not a clone: Herdr ships nothing like it. One editor a tab, its open files as a strip of tabs; wrapped lines, save, find and replace, Markdown shortcuts and a rendered preview, comment and line commands, and marks where a file differs from the last commit.
  - `main.js`: the pane. `load()` opens a file; `changed()` and `entered()` follow the typing; `look()` reads the file again and `take()` shows what it found; `save()`; `shut()` closes a tab; `search()`, `step()`, `replaceOne()`, `replaceAll()` are the find bar; `command()` runs a key command or a button; `requests()` takes what the Files panel asked for.
  - `remote.js`: saving a file on another machine. Its header says how. The script in it runs under any `sh`, so it is tested with a local one, and against a real machine through `hc exec --on`.
  - `diff.js`: which lines of a text differ from an earlier one (`compare()`), and where a mark's lines are (`range()`). Like `edit.js` it touches nothing of the app and runs under `node`. In `main.js`, `head()` reads the file as the last commit has it, `mark()` and `remark()` work the marks out, `ruler()` draws them and `change()` goes to one.
  - `edit.js`: what every command does to text, as functions of the text and the selection that return one edit. Nothing in it touches the app, so it runs under `node`: test a change to it there.
  - State: the open files and their unsaved text, in the copy's `localStorage` (one store for each tab, since the props are `{ tab }`). Shared `file-editor.open` (`{ tab, path, on, at }`) holds a request only until the tab's editor takes it; shared `file-editor.moved` (`{ from, to, on, at }`) is the last rename or move the Files panel made. Shared `file-editor.shown` (`{ tab: { path, on } }`) is the file each tab's editor shows, written by the editor (`tell()`, `say()`) and read by the Files panel; a tab whose editor shows no file has no entry.
  - `reveal()` shows what the Search panel found: a request in `file-editor.open` may carry `select` (`{ line, start, end }`). `travel()` is the three moves of the cursor it shares with `change()`. The command `search-project` hands the selection to the Search panel.
  - Key commands, bound in the `mod:file-editor` section of `keys.json`: `save`, `find` (also in `mod:file-editor > Input`, see below), `replace`, `find-next`, `find-prev`, `escape`, `preview`, `close` (not bound), `bold`, `italic`, `code`, `strike`, `link`, `bullets`, `numbers`, `tasks`, `comment`, `line-up`, `line-down`, `duplicate`, `next-same`, `next-change`, `prev-change`, `search-project` (also in `mod:file-editor > Input`).

- **Mod `project-search`** (`mods/project-search/`): search and replace in every file of the project, in a panel that takes the place of Files and Changes. It is not a clone: Herdr ships nothing like it. ripgrep (`rg`) does the searching, on the project's own machine.
  - `main.js`: the panel. `place()` follows the focused pane to its project; `go()` searches and `take()` shows what it found; `rows()` is every row, `row()` draws one; `open()` asks the tab's editor for a result and `step()` goes to the next one; `replace()`, `askAll()` and `unreplace()` write; `answer()` does what another mod asked for; `key()` is the list's keyboard; `summon()` is the whole job of the copy in `search-keys`.
  - `search.js`: ripgrep's arguments (`args()`, `globs()`), its JSON answer as rows (`parse()`), and what a replace does to a text (`apply()`). Nothing in it touches the app, so it runs under `node`: test a change to it there, against real `rg` output.
  - `ops.js`: what runs a program or writes a file (`find()`, `replace()`, `restore()`, `openIn()`), and the request channel of the menu and the dialog. Its header lists the requests.
  - `remote.js`: a copy of `file-editor`'s, since a mod can only import from its own folder. Keep the two the same.
  - `menu.js`: a result's right-click menu. `confirm.js`: the Replace All question. The mod opens itself for these, with `props().menu` or `props().confirm`.
  - Props: the panel's block has `{ back: { stack, child } }`, what its header's Files button shows. The `search-keys` block has `{ keys: true, show: { stack, child, panel } }`. `{ root, on }` pins the folder searched, whatever pane has the focus: for a test window.
  - State: the fields, the switches and the earlier queries, in the copy's `localStorage`. The results and what undo takes back are in the panel's memory only. Shared `project-search.ask` (`{ query?, to?, folder?, on?, focus?, at }`) and `project-search.request` hold something only until the panel takes it.
  - Key commands: `open`, `next`, `prev` (bound in `global`: `cmd-shift-f`, `f4`, `shift-f4`), `older`, `newer` (in `mod:project-search`), `list`, `tab`, `back-tab` (in `mod:project-search > Input`), `undo` (not bound).

- **Mod `git-panel`** (`mods/git-panel/`): the Git panel, in the place of Herdr's `changes`. It is not a clone. The history as a graph, branches, remotes, tags and stashes, what is not committed, and the everyday actions on them.
  - `main.js`: the panel. `refresh()` and `read()` read the repository, and the log again only when `stamp` changed; `history()` makes the graph's rows; `graph()`, `graphRow()` and `cell()` draw them; `refs()` is the other view; `detail()`, `work()` and `changed()` are the lower half; `act()` runs a request; `show()` asks the tab's `git-diff` pane for a file and `edit()` its editor; `visible()` says whether the panel is on screen; `survey()` finds the folder's other repositories and `choose()` shows one; `generate()` has the commit message written.
  - `lanes.js`: which column each commit is in and the lines between them. `git.js`: git's arguments and what its output means. Neither touches the app, so both run under `node`: test a change to them there, against a real `git`.
  - `ops.js`: every write, and the request channel of the menu and the dialogs. Its header lists the requests and what `expect` is. Also `below()` and `around()`, which find repositories under and around a folder. `hub.js`: what `gh` says about pull requests, workflow runs and releases.
  - `write.js`: the commit message writer. `WRITERS` is who can write and with which model; `gather()` reads the change and the earlier messages; `prompt()` is what is asked; `write()` runs `claude -p` or `codex exec`; `clean()` and `wrap()` make the answer a message. Only `write()` and `gather()` need the app: the rest runs under `node`.
  - `menu.js`: the right-click menus. `naming.js`: the name of a new branch or tag. `confirm.js`: the question before a delete, a drop or a discard. The mod opens itself for these, with `props().menu`, `props().naming` or `props().confirm`.
  - Props: none in the layout. `{ root, on, view }` pins the folder shown (and the view, `"refs"`), whatever pane has the focus: for a test window.
  - State: the view, the folded sections, the repository chosen for a folder (`choice`: `{ folder's key: top folder }`) and who writes messages (`writer`), in the copy's `localStorage`. Everything else is read from the repository. Shared `git-panel.request` holds a request only until the panel takes it.
  - Key commands: `fetch`, `pull`, `push`, `refresh`, `write`. None is bound.

- **Mod `git-diff`** (`mods/git-diff/`): the diff pane, beside the terminals. It is not a clone. One a tab (props `{ tab }`), opened by the Git panel.
  - `main.js`: the pane. `take()` is a request; `lists()` reads the files and `open()` one file's diff; `table()`, `unifiedRow()` and `splitRow()` draw it; `mark()` and `isViewed()` are the viewed ticks; `layout()` chooses side by side or one column.
  - `diff.js`: a diff as rows, and the words that changed in a line. It touches nothing of the app and runs under `node`.
  - State: shared `git-diff.open` (`{ tab, root, on, source, path, group, at }`) holds a request only until the tab's pane takes it. The copy's `localStorage` keeps the last request (so the pane shows it again after a restart), the view chosen, and the viewed ticks.
  - Key commands: `next`, `prev`, `viewed`, `mode`, `whole`, `edit`. None is bound: the pane takes J, K, V, S, W and O itself while it has the keyboard.

## Behavior to preserve in `git-panel`

- It never rebases, merges, cherry-picks, resets, forces a push or deletes an unmerged branch (`branch -d`, never `-D`). A pull is `--ff-only`. Those limits are the owner's choice: more is for a terminal.
- A menu or a dialog never runs a program itself: it leaves a request (`ops.request()`), as in `files-actions`. A request is taken only by the copy that shows its repository (`ops.take(mine)`), so a test window and the panel don't take each other's.
- Before a write, `ops.refused()` checks that nothing is under way (a rebase, a merge: then only `fetch` runs) and that what the request `expect`s is still true: the branch HEAD is on, and the commit a branch, a tag or a stash leads to. A stash is named by its place in the list (`stash@{1}`), which moves when another is made: without the check a drop could take the wrong one. Every new write gets its `expect`.
- Discard is `git stash push -- <path>`: the changes go to a stash, never away. Keep it that way, or ask the owner. It takes what is staged of the file too, and the dialog says so (`both`). Not `--keep-index`, which looks kinder: that stash can't be applied again over the staged part without a conflict.
- Every git command that is given a path runs with `--literal-pathspecs` (`write()` in `ops.js`, `READ` in `git-diff`): without it a file called `x*` or `foo[1].txt` is a pattern, and staging or discarding it takes other files with it.
- The branch HEAD is on is read with `symbolic-ref HEAD` and cut, never `--short`: that says `heads/main` when a tag is called `main` too, and every check of the branch would fail.
- "Commit all" and "Stage all" are refused while a file is in conflict (`ls-files --unmerged`): a stash applied over other changes leaves conflict marks with no merge under way, and they would be committed.
- Unstage is `git reset -q`, which also works before the first commit.
- The repository shown is the one the pane's folder is in, unless another was chosen for that folder (`choice`), which is part of `key()`: choosing is a change of context, and everything is read again. A chosen one that is gone goes back to the folder's own. A folder in no repository shows the first one under it. A repository that can't be read is not chosen twice (`bad`).
- Repositories are looked for with one `find`, by the `.git` they hold, not deeper than `DEPTH` and never in a home folder, in the folders of installed packages or in `uploads` (`BELOW`, `tooWide()` in `ops.js`): a search of a whole home would take minutes. `DEPTH` is `find`'s, so that of the `.git`: 6 finds a repository five folders down. It was 4, and a project folder that is no repository, with its only ones at `wordpress/wp-content/themes/<name>`, showed "Not a git repository". Without `uploads` left out, 6 takes five seconds in a site with half a million uploaded files; with it, under 50 ms. Time a change to either on the biggest project.
- Repositories are looked for under the pane's folder only, never from a folder above it. A space's `folder` is where the space was made, not its project (most spaces here have another project's). And the folder above a project holds the other projects: a pane in a folder with no repository would show a stranger's. So a pane in a plain folder with nothing under it says "Not a git repository", also when the folder beside it has one.
- The message writer runs on this Mac, also for a repository on another machine, in the home folder, with no tools (`--tools ""`, `--sandbox read-only`) and no session kept. The diff is in its prompt, fenced and said to be data: it can hold text that reads like an instruction. The prompt is one argument of the program: `DIFF_MOST` and `FILES_MOST` keep it far under what the system allows.
- What a writer answers is only put in the field. Nothing is committed without the button or Cmd+Enter.
- The message field is a `Textarea`: Enter is a new line, and its `submit` with `secondary` (Cmd+Enter) commits. `on_key_down` around it takes Cmd+Enter too, should the field pass it on. Neither was tried by hand when this was written.
- A name, a path, a message is always an argument of git, never part of a shell script. `PROBE` is the one script, and nothing is put into its text.
- Reads go through `git.READ`: without those flags `git status` refreshes the index, the folder watch sees it, and every read starts the next.
- The log is of `--branches --tags --remotes HEAD`, not `--all`: other tools' refs would show as tips that belong to nothing.
- The panel reads only while it is on screen (`shows()`; `visible()` walks `layout()`), at most once a tick, and not sooner than four times as long as the last read took. A copy pinned to a folder (a test window) always counts as on screen: `visible()` finds the layout's copy, not the window, and a window opened while the panel column showed Files read nothing.
- A commit's row has its author's initials in a circle before the date (`author()`, `git.initials()`): the name only, never the address, in a color of the theme picked by a number made from the name, so it is the same in every repository. The row for what is not committed has none. The date has a least width (`AGO`), so the circles are one column.
- The graph's rows are in a virtual list, so they have no handlers of their own: the list's `on_item_click` and `on_item_secondary_click` do it, by the commit's id. So a name in a row can't be clicked: the Refs view is for that.
- A line of the graph is a shape made once and kept (`path()`): the same few make every row. Making them again on every draw fills the memory all mods share.
- A lane that ends is left empty, never taken out (`lanes.js`): that is what keeps a line passing a row straight.
- A click on a branch in the Refs view stays in that view: its second click must find the same row, to switch. "Show in Graph" is in the menu.
- `props()` is read in `init` and kept (`pin`), and `localStorage` is written in `render` (`remember()`): after an `await`, `props()` was seen to answer for another copy, the one that drew last, and the panel reset itself. `localStorage` is treated the same way without having been caught at it.
- A request still marked as running after `BUSY_MOST` is let go: a reload of the mod cuts its task off, and nothing else would clear it.
- GitHub is asked through `gh` on the repository's own machine, and only for reading. No `gh`, no login or no GitHub remote means no marks and no message.
- Network commands run under `env GIT_TERMINAL_PROMPT=0`: a prompt for a password would wait for ever. Don't set `GIT_SSH_COMMAND`: it would replace the owner's own.

## Behavior to preserve in `git-diff`

- It only reads. Nothing in it changes a repository.
- One reading of the lists at a time (`listing`), and it always ends: `lists()` clears it whatever `read()` did, and starts again when it was asked to meanwhile (`relist`). The pane restores what it last showed when it opens, and the request that opened it arrives during that: left set, `listing` kept the pane on "Nothing changed here" for ever.
- A method of the view must not share its name with another: the second one wins without a word. `list()` draws the files, `read()` reads them.
- A file is listed only when `--numstat` lists it too: `--name-status` also names files that were only touched, since a read must not refresh the index.
- An uncommitted file's diff is read again with every reading of the lists: the same line edited twice leaves the lists as they were.
- A tick is kept with a number made from the added and removed lines only (`diff.changes()`), not from the whole diff: that one changes with the lines shown around a change, and the whole-file view would take every tick away.
- Which words changed is worked out when a file's diff is read (`open()`), not while drawing, and only as far as `WORDS` goes: Herdr's script engine takes about a quarter of a microsecond for a cell of that table (200 pairs of 230-character lines took 345 ms), and stops a task at 500 ms. Past the budget a changed line is all one color.
- Side by side clips a long line; one column scrolls sideways. So side by side is chosen only when the longest line fits in half the pane (`layout()`).
- A space in the text is drawn as a no-break space (`hard()`): a line is drawn in pieces, and a piece would lose the spaces at its ends.
- `on_size_change` reports the window's pixels: `width()` divides by the zoom before comparing with the pane's own lengths.
- A tick on an uncommitted file is kept with how many lines it added and removed and a number made from its diff: it goes when either changed (`prune()`, `open()`). A commit's tick stays.
- The rows of the diff are in a virtual list: the one click it takes is on the row between two changes, which shows the whole file.

## Behavior to preserve in `project-search`

- `<mod>.<command>` reaches only the copies on screen, and the panel is not on screen while the stack shows Files or Changes, or the panel column is hidden. So `project-search.open` is taken by the copy in `search-keys`, which is always shown and draws nothing: it shows the panel and leaves an ask, and the panel takes the keyboard when it sees the ask. Whoever wants a search sets `project-search.ask`, then runs `project-search.open`.
- That copy also adds `search` to Herdr's shared `workspace.panels`. Herdr's tab bar remembers which panel each space shows only among the ids listed there, and would close the panel on coming back to a space that showed Search. The tab bar draws buttons for `files` and `changes` only, and the welcome screen keeps ids it doesn't know.
- A task begun while the panel is drawn (`place()`, `asked()`, a waiting request) starts with `after()`, which waits one step. Without it the task's first step runs inside the draw, where `cx.notify()` is refused: the task ends there without a word, and the search stayed on "searching…" for ever.
- One search at a time (`running`). Asked again while one runs, the next starts when it ends (`next`). Whatever `ops.find()` does, `running` is cleared.
- The list can be replaced from only while it is of the search the fields say now (`fresh()`): typing in any field makes it stale until the next search comes back.
- What a match becomes is ripgrep's word (`--replace` with `--json`), never worked out in JavaScript: the two don't read a pattern the same way. An older ripgrep doesn't say; then only a replacement without `$` groups is known (`search.plain()`).
- A replace reads the file, checks that every match is still the same text at the same place of the same line (`search.apply()`), and writes only if the file is still the text it read (`writeTextFile`'s `expected`, or `remote.js`). One match that is not where it was leaves the whole file alone. Files open in the editor are written like any other: the editor's own check shows the new text or asks.
- Undo is one step, of the last replace, kept in memory (at most `UNDO_MOST` characters): a file goes back only if it is still the text the replace left.
- The query, the filters and the replacement are ripgrep's arguments, never part of the shell script's text (`FIND` in `ops.js`).
- ripgrep is given the folder to search (`./`): with no path it may read its input instead and never answer.
- ripgrep's answer is cut short by `head`, by lines then bytes, and `--max-count` limits one file. The `summary` record at its end is what says the answer is whole.
- ripgrep counts in bytes, the editor in UTF-16: `search.units()` turns one into the other. It is not run on a line over `LONG` characters that is not plain ASCII (Herdr stops a task that runs too long), so such a match is listed but can't be replaced. ripgrep also leaves a byte order mark out of the first line: `apply()` steps over it.
- Dotfiles are searched (`--hidden`), git's own folder never. Closed, the filters and "ignored files too" don't count.
- The project's folder is spelled as the terminal spells its own (`top()`), not as git does behind a link: the editor and the Files panel know a file by that path.
- Setting an input's text from code (`set_value`) sends no `change`: whatever sets one searches itself.
- The rows are plain elements, of which only `limit` are drawn (`PAGE` more with each "Show more"), not a virtual list: Herdr's virtual list takes one click handler for the whole list, so a row in it can't be dragged or have buttons of its own.
- A row's buttons show while the pointer is on it (`hot`, from `on_hover`): there is no hover of a parent to style a child by.
- No `escape`, `up`, `down` or `enter` in the section `mod:project-search`: the menu and the dialog are copies of this mod and take those keys in `on_key_down`, which runs only for a key no binding took. Escape in the panel is taken the same way (`key()`): a one-line input passes it on. Down, Tab and Shift+Tab are in `mod:project-search > Input` because the input binds them and passes nothing on.
- The list's keys count only while the list itself has the keyboard (`this.handle`): Enter in a field reaches `key()` too.

## Behavior to preserve in `file-editor`

- The editor writes `file-editor.shown` only when the file it shows is another one than the last it told (`tell()`), and takes its entry out when the pane closes. Setting shared state draws every mod again, the editor too: a write on every render, or one that depends on what another copy wrote, would never end.
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
- Herdr's editor has decorations and diagnostics of its own (`input/editor/decorations.rs`), but gives a mod none of them: nothing can be drawn beside a line. So the lines that differ from the last commit are marked on a strip that is a map of the whole file, right of the text, and shown by selecting them (`change()`). The strip is as tall as the file's lines would be without wrapping (`rowHeight()`: GPUI's line height, the font size times the golden ratio, rounded to a pixel of the zoomed window) and never taller than the pane. If marks in a short file stop being level with their lines after a Herdr update, that row height changed.
- The marks compare the editor's text, unsaved typing included, with the last commit (`HEAD`), not with the index: a staged change stays marked. A file git doesn't have, in a repository or outside one, has no marks, and neither has a read-only one. `head()` asks git for the file's object name (`rev-parse`) on every look, and reads the file itself (`cat-file`) only when that name changed.
- Herdr stops a script that runs too long: 50 ms in a render, 500 ms in an event handler or a task (`sandbox.rs`). It can't be caught. So `diff.compare()` never runs in `render()`, and it gives up on more than `MOST_EDITS` single-line edits, marking everything from the first difference to the last as one change: at 400 edits the search took 16 ms in Herdr, and its cost is the square of that. Time it in the app before raising it, with a throwaway mod: `node` is many times faster.
- Going to a change takes three moves of the cursor, a frame or two apart (`change()`): under the change, above it, then the change. The editor scrolls only as far as the start of a selection needs, which coming from above is the pane's last row, and of two moves made at once it follows the last only (`scroll_to_with_padding` in `input/base/state.rs`).
- The keys in `mod:file-editor` count only while the keyboard is inside the pane, and Herdr gives a mod pane no place for it. So the pane has its own (`this.handle`, on the root), and `focus()` puts the keyboard in the text or, when there is none to type in (the preview, no file), there. Whatever takes the text away must call `focus()`, or the keys stop until a click.
- A file asked for by the Files panel takes the keyboard twice: at once, and `REFOCUS` ms later, because Herdr focuses the pane after the click.
- What a search found is gone to (`reveal()`) `REFOCUS_SOON` ms after the file is asked for, never at once: the text may not be drawn yet, and Herdr focuses the pane after, which takes the keyboard from the text and with it the selection. If the file then turns out to have changed on disk, it is gone to again in the new text (`goal`). A file in preview goes back to its text: the rendered page shows no selection.
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
- The row of the file the tab's editor shows is highlighted (`shown()`), whichever pane has the focus: the file's own row, or the topmost closed folder it is in. Nothing is highlighted for a file outside the folder shown or on another machine, or when the tab has no `file-editor` pane: an entry in `file-editor.shown` can outlive its editor (a crash), so the pane is looked for. The panel never unfolds or scrolls to that row.
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
- `cx.spawn(body)` runs `body` up to its first `await` at once. Called from `render()`, that first step is inside the draw: `cx.notify()` there is refused and ends the task without a word. A task begun in `render()` that does more than read should `await` first.
- `herdr-app shot` shows no focus ring and no selection in the editor while Herdr is not the active app.
- Write a new mod's `mod.json` before anything else in its folder. A folder Herdr first sees without one is docked into the shown layout by itself, as a new block at the end of `layouts/main-folders.json`: take that block out again.
- Saving a file under `mods/` reloads mods and cuts off their running tasks, also those of a mod that was not saved. Wait a few seconds after a save before sending a request, or it is taken and never answered.
- After an `await`, `props()` may answer for another copy (the one that drew last). Read it in `init` or `render` and keep what it said.
- `exec` gives a program nothing to read on its input, which `codex exec` needs: with an input left open it waits for it. A test under `node` must close the child's input, or it hangs.
- `write.js` can be tried under `node` with a stub of `herdr` (`exec`, `home`): a real call costs a little of the owner's usage, so make few.
- `git-panel` and `git-diff` can be tried on a scratch repository in windows: `openOverlay({ mod: "git-panel", kind: "window", key, width: 380, height: 760, props: { root } })`, and `openOverlay({ mod: "git-diff", kind: "window", key, props: { tab: "probe" } })` with a `git-diff.open` for that `tab`. A request with the scratch `root` in `git-panel.request` is run by that window. A window is closed by opening another under its `key` and closing the id that returns: `overlay.close --id` with a guessed id answers `ok` whether or not it closed anything.
- An overlay opened for a test is closed with `herdr-app do overlay.close` (the top dialog or popup), or `--id o<n>` for a window: the ids count up from `o1`. `project-search` can be tried in a window on a scratch folder: `openOverlay({ mod: "project-search", kind: "window", props: { root } })`, then an ask with `focus: false`.
- When a question is about how Herdr delivers an event or a key, read its source at the installed version's tag instead of guessing: the GPUI fork is under `vendor/gpui-pre`, the script bridge under `vendor/gpui-kit/crates/shell`.
- These clones do not receive Herdr's updates, so check them after Herdr updates. Each clone was made from the version named under "What is custom". When `herdr-app --version` is newer, see what Herdr changed in each original since then, port what matters into the clone, and update the version named here, in `README.md` and in `NOTICE`. Herdr's source is public at `github.com/herdrdev/herdr-app`, tagged per version (`v0.1.16`), with the shipped files under `defaults/`. The installed original is already the new version, so only the old one is fetched:

  ```sh
  diff <(gh api "repos/herdrdev/herdr-app/contents/defaults/mods/agents/main.js?ref=v0.1.16" -H "Accept: application/vnd.github.raw") mods/agents/main.js
  ```

  The originals: `defaults/mods/spaces/main.js` for `space-folders`, `defaults/mods/agents/main.js` for `agents-unread`, `defaults/mods/files/main.js` for `files-actions`, `defaults/layouts/main.json` for `main-folders`.

- The diffs show only what changed in the cloned files, so read Herdr's changelog too: every entry after the version named under "What is custom", up to the installed one.

  ```sh
  gh api "repos/herdrdev/herdr-app/contents/CHANGELOG.md" -H "Accept: application/vnd.github.raw"
  ```

  Hold each entry against every custom mod, `file-editor`, `project-search`, `git-panel` and `git-diff` included (they have no original to diff), and sort it into one of four:
  - **Replaces a mod:** Herdr now does what one of them does (folders of spaces, unread agents, a text editor pane, a search in every file, the Files panel's menu, icons, drag or undo, a commit graph, branches and stashes, a diff viewer, pull requests or workflow runs). Tell the owner what switching would gain and lose. The owner decides: a mod stays until they say otherwise.
  - **Lifts a limit:** it gives a mod what this file says a mod can't have (more than one selection, a scroll position, a mark beside a line of the editor, word of a file drag leaving the panel, a place for the keyboard in a mod pane, a `writeTextFile` on another machine, a command that reaches a copy that is not on screen, handlers on the rows of a virtual list, an import from another mod's folder, a text element with runs of several colors, a syntax highlighter for any text, git's status as a function of `herdr`, a `props()` that is the copy's own after an `await`). Use it, then delete the workaround and its note here.
  - **Moves what a workaround stands on:** how a mod pane gets the keyboard, key sections and their order, Cmd+F and the menu bar, file drags, `exec`, `writeTextFile`, which copies a command reaches, the tab bar's `workspace.panels`, the tab bar's Changes button and the `changes` block's id, what `on_size_change` reports at a zoom, the time a script may run. Try again the behavior under the matching "Behavior to preserve" heading.
  - **Nothing for this setup.**

  Report every entry of the first three kinds to the owner, also when it needs no change.

- The icons in `mods/files-actions/icons/` are a release of Material Icon Theme (MIT), named in `icons/map.js` and in `NOTICE`. To update them, follow the header of `icons/build.py`, then update the version in `NOTICE`.

## Git

- `.gitignore` is an allowlist: everything is ignored unless listed. A new mod, layout, theme or root file needs a line there.
- **This repository is public. Before every commit, read the staged diff (`git diff --cached`) and make sure it holds nothing that should not be public:** no secrets, tokens, passwords, API or SSH keys; no personal information (names, email addresses, phone numbers, addresses); no home or project paths (`/Users/...`, `/Volumes/...`), machine or host names, client or project names; nothing else private or security-sensitive. This applies to every committed file, including settings, key bindings, notes, screenshots and commit messages. If something like that is needed locally, keep it in an ignored file. The deliberate exceptions: the owner's name in the `NOTICE` copyright line, and the author name and email that git takes from its own config for a commit. The owner's email address must never appear in any file. If you are unsure whether something is safe to publish, stop and ask before committing.
- Never track state: `shared.json`, `view.json`, `data/`, `layouts/.state/`, or anything Herdr ships. State holds space names, folder paths and project names.
- Commit messages follow Conventional Commits: `<type>(<scope>): <description>`, then an optional body and footers.
