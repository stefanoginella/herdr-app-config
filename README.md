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
| `layouts/main-folders.json` | Herdr's default layout, showing the first three: see [Install](#install) |
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

## Install

Built against Herdr 0.1.16. From a clone of this repository, this adds the mods and the layout that shows them:

```sh
cp layouts/main-folders.json ~/.config/herdr-app/layouts/
cp -R mods/space-folders mods/agents-unread mods/files-actions mods/file-editor ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/space-folders
herdr-app check ~/.config/herdr-app/mods/agents-unread
herdr-app check ~/.config/herdr-app/mods/files-actions
herdr-app check ~/.config/herdr-app/mods/file-editor
herdr-app do layout.switch '{"name":"main-folders"}'
```

Your own layout stays as it was: `layout.switch` goes back to it, and deleting the copied files removes all of this.

For undo in the Files panel, also add `"cmd-z": "files-actions.undo"` to the `global` section of your `keys.json`. For the editor's keys, copy the two `mod:file-editor` sections of this repository's `keys.json` into yours.

`files-actions` needs `file-editor`: it is what a click on a file opens.

For only one of them, copy and check its folder, then point a layout of your own at it: `{ "mod": "space-folders" }` in the `spaces` block, `{ "mod": "agents-unread" }` in the `agents` block, or `{ "mod": "files-actions" }` in the `files` block. Herdr's shipped layouts are read-only, so clone one first:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
```

The layout and the mods are copies of Herdr's `main`, `spaces`, `agents` and `files`, so they don't pick up changes Herdr makes to those later.

## How the repository works

Herdr's own mods and layouts sit next to the custom ones and are replaced on every start, and its state files change constantly. So `.gitignore` is an allowlist: everything in the folder is ignored unless it is listed there, and a new mod, layout or theme needs one line.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/space-folders/main.js`, `mods/agents-unread/main.js`, `mods/files-actions/main.js` and `layouts/main-folders.json` are modified copies of files from Herdr, which is also Apache-2.0. The icons in `mods/files-actions/icons/` are Material Icon Theme's, which is MIT. See [NOTICE](NOTICE).
