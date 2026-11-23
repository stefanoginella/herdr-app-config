# Herdr App Configuration

My personal setup for the [Herdr](https://herdr.dev) desktop app. It is opinionated: everything here follows my own preferences and the way I work. Feel free to fork it or use it as inspiration.

This repository is the app's home folder, `~/.config/herdr-app`, with only the customized files tracked. Everything Herdr writes there itself is ignored.

## What's here

| Path | What it is |
|---|---|
| `mods/space-folders/` | [The Spaces sidebar, with folders](#space-folders) |
| `mods/agents-unread/` | [The Agents list, with "mark as unread"](#unread-agents) |
| `mods/files-actions/` | [The Files panel, with file type icons, a right-click menu, drag to move and undo](#file-actions) |
| `mods/file-editor/` | [A text editor that opens as a pane, from the Files panel](#file-editor) |
| `mods/project-search/` | [Search and replace in every file of the project, in a panel](#project-search) |
| `mods/go-to-file/` | [Go to a file of the project by its name, in a popup](#go-to-file) |
| `mods/git-panel/` | [A Git panel: the history as a graph, branches, remotes, tags, stashes, and everyday actions](#git-panel) |
| `mods/git-diff/` | [A diff pane beside the terminals, side by side, with the changed words marked](#git-diff) |
| `layouts/main-folders.json` | Herdr's default layout, showing the first three, the search panel and the Git panel: see [Install](#install) |
| `keys.json`, `settings.json` | Personal key bindings and settings |
| `AGENTS.override.md`, `CLAUDE.md` | Notes for coding agents working in this folder |

## Space folders

Groups spaces into named folders in the sidebar. Folders are one level deep, and a space doesn't need one: it can stay at the root.

- **Add a folder:** the folder button next to `+` in the Spaces header, or right-click the header or the empty area under the list.
- **Move a space:** drag it onto a folder to put it in, onto a row to place it before or after that row, or under the list to take it out of every folder. Or right-click it: Move to, Out of folder, New folder.
- **Move a folder:** drag its header.
- **Rename or remove a folder:** right-click it. Removing a folder leaves its spaces at the root. Nothing is closed.
- **Fold:** click the header. A folded folder shows how many spaces it holds, and a dot when one of them needs you.

Placement survives restarts. It is also remembered by project (the repo, else the folder), so the next space opened on a filed project lands in the same folder.

The real order of spaces follows the sidebar, so `space.next`, `space.prev` and `space.select:N` match what is drawn.

A space's menu also opens its project in VS Code, and in Obsidian when the project is inside one of its vaults. The project is the repo's top folder, else the folder the space is in. Both are for spaces on this Mac.

Three commands can be bound in `keys.json`: `space-folders.new-folder`, `space-folders.fold-all` and `space-folders.unfold-all`.

## Unread agents

Marks an idle agent as unread: it goes back under Done, with the done dot, as a reminder to look at it later.

- **Mark as unread:** click the empty ring at the end of an idle agent's row, or right-click the row.
- **Mark as read:** click the same spot again, or right-click the row. It also happens by itself: when you open the agent again after having been somewhere else, and when the agent starts working.

Marking the agent you are looking at keeps it marked until you leave and come back. The mark lives in the list only: the tab bar and the spaces sidebar still show the agent as idle.

One command can be bound in `keys.json`: `agents-unread.toggle` marks the agent you are looking at, or clears its mark.

## File actions

The Files panel, with more to look at and more to do. A click on a file opens it in the [file editor](#file-editor).

- **Icons:** every file and folder has its type's icon, from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme); a folder's changes when it opens. What git ignores is faded.
- **The file in the editor:** the file the tab's editor shows is highlighted in the tree. When it is inside a closed folder, that folder is highlighted instead.
- **Changes in folders:** a folder with modified, added or removed files anywhere inside it shows a dot, so a change is seen without opening the folder. The dot is green when everything inside is new, red when everything is removed or something is in conflict, and otherwise the color of a modified file.
- **Open elsewhere:** right-click a file or a folder to open it in VS Code or Obsidian, and a file in TextEdit. A file opens in VS Code inside its repo's window. Obsidian is offered for Markdown, canvas and base files anywhere, and for anything inside one of its vaults: it opens a folder only as a vault. Reveal in Finder shows it in its folder.
- **Open the project:** the same menu ends with the project, and right-clicking the header or the room under the list shows the project and what the folder shown takes: a new file, a new folder, a paste.
- **New file or folder:** right-click, New File or New Folder, and name it. It is made in the folder you clicked, next to the file you clicked, or in the top folder when you clicked the header or the room under the list. A new file opens in the editor.
- **Rename:** right-click, Rename. The name is selected without its extension.
- **Duplicate:** right-click, Duplicate. The copy is named as Finder names it: `notes copy.md`, then `notes copy 2.md`.
- **Delete:** right-click, Move to Trash. It asks first, and the file can be put back from the Trash.
- **Move:** drag a file or a folder onto a folder to put it in, onto a file to put it next to that file, or under the list for the top folder. Its name follows the pointer while you drag, and a toast says where it went.
- **To a terminal:** drag a file or a folder onto a terminal to paste its path there, quoted and without Enter: a quick way to hand a file to an agent. Nothing is moved.
- **Undo:** Cmd+Z takes back the last move, rename or Trash, once, and a toast says what it did. A trashed file comes back out of the Trash. It is for slips: it works for five minutes, while the panel still shows the same folder. After a duplicate, a copy or a new file or folder there is nothing to take back.
- **From Finder:** drop files or folders from Finder onto a folder, onto a file for that file's folder, or under the list for the top folder. They are copied: the originals stay where they are.
- **Search:** the lens in the header goes to the [search panel](#project-search), and right-clicking a folder offers Find in Folder.
- **To and from the clipboard:** right-click, Copy puts a file or a folder on the clipboard, for Cmd+V in Finder; Paste copies in what was copied in Finder, or here. Dragging out to Finder is not possible: Herdr's file drag stays inside its window.

Nothing is ever overwritten: a new file or folder, a rename, a move, a copy or a paste onto a name that exists is refused.

Opening in an app, Finder, the clipboard and the Trash are for files on this Mac. For a folder on another machine the menu offers New File, New Folder, Rename and Duplicate, drag still moves, and undo takes back a move or a rename.

Undo is the command `files-actions.undo`, bound in `keys.json` under `global` so that it works while the keyboard is in a terminal, which is where it is after a drag. It works while the Files panel is shown. Two things follow from binding it there: terminal programs no longer receive Cmd+Z, and a Cmd+Z pressed by habit within those five minutes takes back the last file action. Text fields, such as the rename dialog, keep their own undo.

## File editor

A text editor beside the terminals. Click a file in the Files panel and it opens in a pane of the tab, split in next to the focused pane; the next file opens in the same pane, as another tab in its strip. The Files panel stays where it is, and can show Changes meanwhile.

- **Wrapped lines:** long lines wrap, and go on under the line's own indentation. Nothing scrolls sideways.
- **Save:** Cmd+S. Nothing is saved by itself. A dot on a file's tab means unsaved text, and closing that tab asks first.
- **Changes made elsewhere:** a file an agent or git changes is shown as it now is, when nothing is unsaved here. When something is, a save is refused and the editor asks which text to keep.
- **Nothing typed is lost:** the open files and their unsaved text are kept as you type. Close the pane or restart Herdr, open a file in that tab again, and they are back.
- **Find and replace:** Cmd+F and Cmd+Alt+F, with match case and regular expressions. Enter and Shift+Enter, or Cmd+G and Cmd+Shift+G, go through the matches; Replace all is one undo. The bar shows the line of the current match, because the text shows a selection only while it has the keyboard: click that line, or press Cmd+Enter, to go to it with the keyboard in the text.
- **Several cursors:** Alt+click adds one, Alt+Shift+drag selects a block, Cmd+Alt+Up or Down adds one above or below. Escape goes back to one.
- **Lines:** Alt+Up and Alt+Down move the selected lines, Cmd+Shift+D duplicates them, Cmd+/ comments them out or back in.
- **Wrap a selection:** with text selected, typing `"` `'` `` ` `` `(` `[` `{` `<` or `~` puts the selection inside the pair instead of replacing it, and keeps it selected. In Markdown `*` and `_` do too, so typing `*` twice makes bold.
- **Same word:** Cmd+D selects the word under the cursor, then jumps to the next place it is found. It moves one selection: it does not add cursors.
- **Markdown:** Cmd+B bold, Cmd+I italic, Cmd+E code, Cmd+Shift+X strikethrough, Cmd+K link, Cmd+Shift+8 bullets, Cmd+Shift+7 numbers, Cmd+Shift+9 tasks (again ticks them). Enter in a list goes on with it, and ends it on an empty item; in a numbered list the items under the new one are counted on. The same as buttons above the text.
- **Preview:** Cmd+Shift+V, or the Preview button, shows a Markdown file rendered.
- **Changes since the last commit:** a file git has gets a thin strip on the right of its text, with a mark where lines were added (green), changed (blue) or deleted (red), unsaved typing included. The strip is the whole file from top to bottom, not a margin: in a file shorter than the pane a mark is level with its lines, until a long line wraps above them, and in a longer file it shows where in the file they are. Click a mark, or press Alt+F3 and Alt+Shift+F3, or the `±` button that counts the changes, to go to a change with its lines selected. A file git does not have yet has no marks.

Undo, redo, indenting, bracket pairs and folding are Herdr's own editor. Files too large to edit open read-only.

A file on another machine is edited the same way. It is saved by a short shell script that Herdr runs there, sent along with every save: nothing is installed on that machine, which only needs `sh`. The file keeps its permissions, and a save is refused when the file changed there meanwhile.

The keys are in `keys.json` under `mod:file-editor`, so they count only while the keyboard is in the editor. Cmd+F is also under `mod:file-editor > Input`: Herdr's editor keeps that key for itself, and this section takes it back while the keyboard is in the text. There, Cmd+B, Cmd+D, Cmd+Shift+D and Cmd+/ do the above instead of what they do elsewhere (the sidebar, splitting a pane, help), and Cmd+Z undoes text instead of the last file action.

## Project search

Search every file of the project, and replace, in a panel that takes the place of Files and Changes: what Cmd+Shift+F is in VS Code. The searching is [ripgrep](https://github.com/BurntSushi/ripgrep)'s, which must be installed (`brew install ripgrep`).

- **Open:** Cmd+Shift+F, or the lens in the Files panel's header. From the editor, text selected on one line becomes the query. The Files button in the panel's header goes back.
- **The project:** the repository the focused pane is in, else its folder. In a repository the search runs as you type; elsewhere, where nothing says how much there is to read, on Enter.
- **Options:** match case (`Aa`), whole words (`ab`) and regular expression (`.*`). The syntax is ripgrep's: no lookaround, no backreferences.
- **Filters:** the `…` button opens "files to include" and "files to exclude", comma-separated: `src`, `*.ts`, `docs/**` count at any depth, and `./src` is the folder at the project's top. Dotfiles are searched; what git ignores is not, unless "Search ignored files too" is ticked. Closed, the filters don't count.
- **Find in Folder:** right-click a folder in the Files panel to search only there.
- **Results:** grouped by file, foldable. Click a match to open the file in the [editor](#file-editor) with the match selected. F4 and Shift+F4 go to the next and the previous result from anywhere. At most 2,000 matches are listed, and 500 matched lines of one file: the panel says when there are more.
- **Keyboard:** Down from a field goes to the list, where Up and Down move, Enter opens, Left and Right fold, and Cmd+Backspace dismisses. Tab goes through the fields, Alt+Up and Alt+Down bring back earlier queries, and Escape gives the keyboard back to the pane.
- **Right-click a result:** open it in the editor or in VS Code at its line, reveal it in Finder, copy its path, its path in the project or its line, replace it, or dismiss it from the list.
- **To a terminal:** drag a result onto a terminal to paste its file's path there.
- **Replace:** the chevron left of the query opens the replace row, and every match shows what it becomes. With a regular expression `$1` is the first group; in plain text a `$` is a dollar. Replace one match or one file from its row, or all of them with the button beside the field, which asks first. Only the matches listed are replaced.
- **What a replace writes:** the files themselves, at once. A file that changed since the search is left alone, whole, and so is one that is not UTF-8 text or is larger than 1 MB. A file open in the editor shows its new text, or asks when it has unsaved text.
- **Undo:** "Undo replace" under the fields takes back the last replace, in every file that is still as the replace left it.

The search reads the files on disk: unsaved text in the editor is not searched. Results come when the search is done, not one by one.

A project on another machine is searched there, where ripgrep must be installed too, and replaced there as the editor saves a file there. VS Code and Finder are for files on this Mac.

The keys are in `keys.json`: Cmd+Shift+F, F4 and Shift+F4 under `global`, Cmd+Shift+F again in the two `mod:file-editor` sections (Herdr's editor keeps that key for itself), and the panel's own under `mod:project-search` and `mod:project-search > Input`. One more command can be bound: `project-search.undo`.

## Go to file

Go to a file of the project by typing some of its name: what Cmd+P is in VS Code. Here it is Cmd+O, since Cmd+P is Herdr's own "Go to…" for tabs. The listing is [ripgrep](https://github.com/BurntSushi/ripgrep)'s, which must be installed.

- **Open:** Cmd+O, from a terminal or the editor. Cmd+O again or Escape closes it.
- **The project:** the repository the focused pane is in, else its folder: the same files the [search panel](#project-search) searches. Dotfiles are listed; what git ignores is not.
- **Type:** words in any order, each anywhere in the path. A word counts most in the file's name in one piece, then in its folders, then as letters in order: `gp main` finds `git-panel/main.js`. A word with a `/` is looked for in the whole path. The letters that matched in the name are marked.
- **Go to a line:** end with `:12`, or `:12:5` for a column. `:12` alone is a line of the file the editor shows.
- **Open a file:** Up and Down move, Enter opens the file in the [editor](#file-editor), or click it. The tab gets an editor pane when it has none.
- **Lately:** with nothing typed the files opened from here come first, newest first, so Cmd+O and Enter goes back to the file before. Among equal results a file opened lately wins.

The files are listed when the popup opens: a file made while it is open is not there until the next time. At most 20,000 files are listed. In a bigger project the popup asks the project's machine for the files that match, a moment after you stop typing.

The keys are in `keys.json`: Cmd+O under `global`, and Up and Down under `mod:go-to-file > Input`.

## Git panel

The repository the focused pane is in, in the panel on the right, in place of Herdr's Changes: the tab bar's Changes button opens it. It follows the pane you are in, on this Mac or another machine.

- **Graph:** every branch, tag and remote branch as lines of commits, newest on top, with merges drawn as curves. A filled name is the branch you are on; a name with a small cloud is in the same place as its remote branch. HEAD is a ring, a merge is hollow. Before its date, each commit has its author's initials in a circle, in a color that is always the same for a name. The first 1,000 commits are read, and "Load more" reads on.
- **Uncommitted changes:** a row of its own on top of the graph, hanging from HEAD by a dashed line. Selected, the lower half of the panel lists the files, staged and not.
- **Several repositories:** the panel shows the repository the pane's folder is in. When there are others, the name in the header becomes a list: the repositories inside that one (nested ones, submodules, up to five folders down), and the ones it is itself inside of. In a folder that is not a repository but holds some, as deep as a WordPress site's themes and plugins (`wordpress/wp-content/themes/<name>`), the first is shown and the list has the rest. The choice is remembered for that folder. Folders of installed packages (`node_modules`, `vendor`, `.venv`, `target`) and of uploaded files (`uploads`) are not looked into, nor is a home folder.
- **Stage and commit:** the `+` and `−` on a file's row (they show while the pointer is on it) stage and unstage it; the same in the headings do it for all. Type a message and press Cmd+Enter, or the Commit button. Enter is a new line: the field grows for a body. With nothing staged, everything is committed.
- **Have the message written:** the sparkle at the right of the message field asks `claude -p` or `codex exec` for it: a Conventional Commit heading and a body, in the style of the repository's earlier commits. It takes a few seconds, and what comes back is in the field to edit. Right-click the sparkle to choose who writes: Claude (Haiku or Sonnet) or Codex. See [below](#the-message-writer) for what is sent.
- **A commit:** click it to read its message and see its files below. Click a file to see its diff in the [diff pane](#git-diff).
- **Refs:** the other view lists branches, each remote's branches, tags and stashes. A branch shows how far it is ahead and behind its upstream. Click one to see its commit below; double-click a branch to switch to it; right-click, Show in Graph, to go to it there.
- **Fetch, pull, push:** the three buttons in the header, with how many commits wait in each direction. Pull is fast-forward only. Push is never forced, and a branch with no upstream is pushed to `origin` and starts tracking it.
- **Right-click** a commit, a branch, a tag, a stash or a file for the rest: new branch or tag here, switch, fast-forward, push, delete a branch or a tag, apply or drop a stash, open the file in the [editor](#file-editor), copy an ID, a name or a path.
- **Stashes:** "Stash all" in the changes list puts everything uncommitted away, untracked files too. A stash shows its files like a commit, with Apply and Pop.
- **Discard:** right-click a changed file, Discard Changes. It asks first, and the changes are not thrown away: they become a stash named "Discarded: …", which can be applied again. A file with staged changes too goes back to the last commit, and the stash holds both.
- **GitHub:** when the repository is on GitHub and [`gh`](https://cli.github.com) is installed and logged in, a branch shows its open pull request's number with the state of its checks, a commit shows a dot for its workflow run (green, red, or yellow while it runs), and a tag says when it is a release. The menus open them on GitHub. It is read once a minute while the panel is shown, more often while a workflow runs. Without `gh` there are simply no marks.

What the panel never does: rebase, merge, cherry-pick, reset, force push or delete a branch that is not merged. Those stay in a terminal. While a rebase or a merge is under way it only looks, and says so.

Before anything is changed the panel checks that what it showed is still true: that HEAD is on the same branch, that the branch or the stash clicked is still the same commit. If an agent moved something in between, nothing is done and the panel says why.

The panel reads the repository only while it is on screen: when a file changes on this Mac, and every few seconds on another machine.

Five commands can be bound in `keys.json`: `git-panel.fetch`, `git-panel.pull`, `git-panel.push`, `git-panel.refresh` and `git-panel.write` (the message writer). They reach the panel while it is shown.

### The message writer

The program runs on this Mac, with your own login to it, in your home folder, with no tools and no session kept. It is sent, as its prompt: the diff of what is about to be committed (what is staged, else everything, cut at 60,000 characters), the text of new files (a few thousand characters), the branch's name and the last twelve commit messages. So whatever is in that diff goes to Anthropic or OpenAI: look before you ask when a change holds something secret. For a repository on another machine git is read there, and the program still runs here.

Who can write, and with which model, is the list at the top of `mods/git-panel/write.js`: a model's name is the program's own (`claude --model`, `codex exec --model`), and Codex's change over time.

## Git diff

A pane beside the terminals for reading a change, opened by clicking a file in the [Git panel](#git-panel): of what is not committed, of a commit, or of a stash. One a tab; the next file clicked shows in the same pane.

- **Side by side** when the pane is wide and the longest line fits in half of it, else one column with the old and the new line numbers. `S`, or the button in the header, switches.
- **The words that changed** inside a changed line are colored stronger than the line.
- **Unchanged lines** are left out, three around each change, with a row that says how many were skipped. Click that row, press `W`, or use the header's button for the whole file.
- **Files:** listed on the left, in two groups for uncommitted changes (staged, not staged). `J` and `K`, or the arrows, go to the next and the previous one.
- **Viewed:** `V`, or the Viewed button, ticks the file and goes to the next one not viewed. The header counts them. A tick on an uncommitted file goes away when the file changes again.
- **To the editor:** `O`, or the pencil, opens the file as it is now in the [editor](#file-editor), at the first changed line for an uncommitted file.

Uncommitted changes are read again as files change. The pane only reads: it changes nothing in the repository. The keys count while the pane has the keyboard. A diff is cut at 6,000 lines, and it is not syntax-colored.

Six commands can be bound in `keys.json`: `git-diff.next`, `git-diff.prev`, `git-diff.viewed`, `git-diff.mode`, `git-diff.whole` and `git-diff.edit`.

## Install

Built against Herdr 0.1.17. From a clone of this repository, this adds the mods and the layout that shows them:

```sh
cp layouts/main-folders.json ~/.config/herdr-app/layouts/
cp -R mods/space-folders mods/agents-unread mods/files-actions mods/file-editor mods/project-search mods/go-to-file mods/git-panel mods/git-diff ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/space-folders
herdr-app check ~/.config/herdr-app/mods/agents-unread
herdr-app check ~/.config/herdr-app/mods/files-actions
herdr-app check ~/.config/herdr-app/mods/file-editor
herdr-app check ~/.config/herdr-app/mods/project-search
herdr-app check ~/.config/herdr-app/mods/go-to-file
herdr-app check ~/.config/herdr-app/mods/git-panel
herdr-app check ~/.config/herdr-app/mods/git-diff
herdr-app do layout.switch '{"name":"main-folders"}'
```

Your own layout stays as it was: `layout.switch` goes back to it, and deleting the copied files removes all of this.

For undo in the Files panel, also add `"cmd-z": "files-actions.undo"` to the `global` section of your `keys.json`. For the editor's keys, copy the two `mod:file-editor` sections of this repository's `keys.json` into yours. For the search panel, copy the two `mod:project-search` sections, and `cmd-shift-f`, `f4` and `shift-f4` from `global`. For going to a file, copy the `mod:go-to-file > Input` section and `cmd-o` from `global`.

`git-panel` needs `git-diff`, which is what a click on a file opens, and both use `file-editor` for "open in the editor". Copy each mod's folder whole, `mod.json` included: a mod folder Herdr first sees without one is docked into the shown layout by itself.

`files-actions` needs `file-editor`: it is what a click on a file opens. `project-search` needs `file-editor` too, and ripgrep; so does `go-to-file`, which is in no layout: its key opens it. In a layout of your own it needs two blocks, as in `main-folders.json`: the panel, and a block that is always shown (it can be 0 px tall) with props `{ "keys": true, "show": { ... } }`, which takes Cmd+Shift+F while the panel is hidden and shows it.

For only one of them, copy and check its folder, then point a layout of your own at it: `{ "mod": "space-folders" }` in the `spaces` block, `{ "mod": "agents-unread" }` in the `agents` block, or `{ "mod": "files-actions" }` in the `files` block. Herdr's shipped layouts are read-only, so clone one first:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
```

The layout and the mods are copies of Herdr's `main`, `spaces`, `agents` and `files`, so they don't pick up changes Herdr makes to those later.

## How the repository works

Herdr's own mods and layouts sit next to the custom ones and are replaced on every start, and its state files change constantly. So `.gitignore` is an allowlist: everything in the folder is ignored unless it is listed there, and a new mod, layout or theme needs one line.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/space-folders/main.js`, `mods/agents-unread/main.js`, `mods/files-actions/main.js` and `layouts/main-folders.json` are modified copies of files from Herdr, which is also Apache-2.0. The icons in `mods/files-actions/icons/` are Material Icon Theme's, which is MIT. See [NOTICE](NOTICE).
