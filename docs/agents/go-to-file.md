# `go-to-file`

Notes for agents on the mod in `mods/go-to-file/`. The index and what holds for every mod are in `AGENTS.override.md`.

Go to a file of the project by its name, in a popup like Herdr's own "Go to…" for tabs (`picker`, which keeps Cmd+P). It is not a clone. ripgrep (`rg`) lists the files, on the project's own machine; the file opens in the tab's `file-editor`.

## What is where

- `main.js`: the popup. `where()` is where it was opened from, and the folder to find the project by; `load()` lists the files; `show()` makes the rows for what is typed; `ask()` has the machine look when the project is not listed whole; `pick()` opens a file; `status()` is the line under the list.
- `match.js`: what a query means (`parse()`), the listing as paths (`read()`), the paths ready to be searched (`index()`), the best of them for a query (`rank()`, `score()`), which letters of a name matched (`pieces()`), and a word as a pattern for ripgrep (`pattern()`). Nothing in it touches the app, so it runs under `node`: test a change to it there, against real `rg --files` output.
- `ops.js`: the one shell script (`LIST`) and what runs it (`list()`), and the files opened lately (`recent()`, `remember()`).
- Props: none from the key. `{ root, on }` pins the folder whose project is listed, whatever pane has the focus, and leaves the keyboard where it is; `{ query }` is what the field says at first: for a test window.
- State: shared `go-to-file.recent` (`{ "<machine>\n<folder>": [path, newest first] }`), the files opened lately from here, by project. The list of files is in the popup's memory only, and read again each time it opens.
- Keys: `cmd-o` in `global` runs `mod.open:go-to-file` (and closes it again); the command palette has it as "Go to File…". Key commands: `up`, `down`, bound in `mod:go-to-file > Input` and installed by `fieldkeys.js` (a copy of `file-editor`'s).

## Behavior to preserve

- Herdr's script engine is slow, and what is typed is looked for at every key, in an event handler that is stopped at 500 ms. Measured in the app on 30,000 paths: a loop that looks at every path, 114 ms (about 4 microseconds a path); the engine's own pattern matcher over the paths as one text, no faster (12 ms for 3,000 lines that don't match). `indexOf` is the one fast thing. So `rank()` looks for the letters of the longest word in the paths as one text (`blob`), and only a line that has them all in order is given its points: 35 to 90 ms on 30,000 paths. Don't put a loop over every path, or a pattern over the blob, back in.
- `MOST` is 20,000 for that reason. A project with more files is not listed whole (`cut`): what is typed is then asked of the machine (`ask()`, the same script with patterns), `TYPE_AFTER` ms after the last key, one answer at a time, and the rows are ranked from the answer.
- `read()` cuts the listing into paths with one `split`: a pattern over the whole listing, or a step a line, took 50 to 90 ms. `index()` makes the lower-case paths with one `toLowerCase` of them all.
- The shell sorts the files (`LC_ALL=C sort`), not the engine: sorting 30,000 paths here took tens of milliseconds, and ripgrep's own order changes from one run to the next, which would shuffle equal results.
- The listing ends with an empty line. Without it the answer was cut short by `head -c`, and its last line may be half a name: `read()` drops it.
- A word typed is only ever an argument of the script, as a pattern in which every character but a plain letter or digit is named by its number (`match.pattern()`): nothing typed means anything to ripgrep or to the shell.
- ripgrep is given the folder to list (`./`), and `-` where it reads the pipe.
- The project's folder is spelled as the terminal spells its own (`read()`), not as git does behind a link: the editor and the Files panel know a file by that path.
- The same files as the Search panel searches: all but what git ignores and git's own folder, dotfiles too.
- A word matches a path whenever its letters are there in order (the weakest of the four ways in `score()`). `rank()` stands on that: it only looks at the lines that have them. A new way to match must not find a path that way doesn't.
- Up and Down are commands, in `mod:go-to-file > Input` (installed by `fieldkeys.js`): the field binds those keys and passes nothing on. Enter is the field's `submit`, and reaches `on_key_down` too: so `pick()` runs once (`gone`), and the keys in `on_key_down` count only while the popup itself has the keyboard. Escape is Herdr's, which closes the top popup.
- The tab and the pane are read when the popup opens (`where()`). While the editor has the focus there is no folder: it is the folder of the tab's terminal that the file shown is under (so the project is the one the Files panel shows), else that file's own folder, else the tab's first terminal's.
- `pick()` closes the popup first, then leaves the file in `file-editor.open` and focuses the tab's editor, or splits one in: as `project-search`'s `open()`.
- `go-to-file.recent` is written only when a file is picked: setting shared state draws every mod.
- With nothing typed the files opened lately come first, without the one the editor shows: Cmd+O, Enter goes back to the file before. A line alone (`:12`) is a line of the file the editor shows, which then comes first.
- The popup is as tall as its content, so its root must not scroll: the list has a height of its own.
- `props()` is read in `init` and kept. In a check it is null.
- Tried in a test window, driven from a shell: the list, what a query finds, the big-project path, an error, and the `up` and `down` commands. Not tried by hand when this was written: typing in the field, the arrow keys and Enter as keys, and `pick()` opening a file in the editor.

## Trying it

- `go-to-file` can be tried in a window: `openOverlay({ mod: "go-to-file", kind: "window", key, width: 640, props: { root, query } })`. `herdr-app do go-to-file.down` moves its selection. Don't pick a file in it: that opens the editor in the tab the owner is looking at.
