# `git-diff`

Notes for agents on the mod in `mods/git-diff/`. The index and what holds for every mod are in `AGENTS.override.md`.

The diff pane, beside the terminals. It is not a clone. One a tab (props `{ tab }`), opened by the Git panel.

## What is where

- `main.js`: the pane. `take()` is a request; `lists()` reads the files and `open()` one file's diff; `table()`, `unifiedRow()` and `splitRow()` draw it; `mark()` and `isViewed()` are the viewed ticks; `layout()` chooses side by side or one column.
- `title()` names the pane `TITLE` ("Git Diff Viewer") once, when it has no name, since a mod pane's own title is its folder's name.
- `fit()`, at the start of each draw, sets the text size to the terminals' (`settings().font_size`, as Herdr's own Changes diff has it since 0.1.17) and scales `CHAR`, `ROW` and `NUMBER` from what they were at 12 px.
- `review.js`: resolving branch refs and the merge base, checking a checkpoint, reading raw file identities and finding a saved line again. `notes.js`: the line-note editor and notes list, opened as dialogs on the diff mod with `props().reviewNotes`.
- A branch request uses `source: { kind: "branch", branch, base }` with full local or remote ref names. Reading it pins the common ancestor and tip. The pane reads the refs again on a new request or a manual refresh. Its whole-branch and incremental views show committed changes only.
- Shared `git-diff.review.<key>` stores the explicit checkpoint, branch file ticks and notes. The key encodes the machine, checkout root, branch ref and base ref. Read the current shared value again before each write so another pane’s notes or marks survive. Existing non-branch viewed state and the most recent pane request stay in local storage.
- `diff.js`: a diff as rows, and the words that changed in a line. It touches nothing of the app and runs under `node`.
- State: shared `git-diff.open` (`{ tab, root, on, source, path, group, at }`) holds a request only until the tab's pane takes it. The copy's `localStorage` keeps the last request (so the pane shows it again after a restart), the view chosen, and the viewed ticks.
- Key commands: `next`, `prev`, `viewed`, `mode`, `whole`, `edit`. None is bound: the pane takes J, K, V, S, W and O itself while it has the keyboard, and the mouse's back and forward buttons over it are `prev` and `next`.

## Behavior to preserve

- It only reads. Nothing in it changes a repository.
- One reading of the lists at a time (`listing`), and it always ends: `lists()` clears it whatever `read()` did, and starts again when it was asked to meanwhile (`relist`). The pane restores what it last showed when it opens, and the request that opened it arrives during that: left set, `listing` kept the pane on "Nothing changed here" for ever.
- A method of the view must not share its name with another: the second one wins without a word. `list()` draws the files, `read()` reads them.
- A file is listed only when `--numstat` lists it too: `--name-status` also names files that were only touched, since a read must not refresh the index.
- An uncommitted file's diff is read again with every reading of the lists: the same line edited twice leaves the lists as they were.
- `tick()` reads nothing while Herdr is not the active app (`away`); the first active tick marks the lists stale. It starts no reading sooner than four times as long as the last one took (`cost`, measured from `listedAt` in `lists()`). Neither applies to `take()`: a request from the Git panel, or the restore at start, reads at once.
- A tick is kept with a number made from the added and removed lines only (`diff.changes()`), not from the whole diff: that one changes with the lines shown around a change, and the whole-file view would take every tick away.
- Which words changed is worked out when a file's diff is read (`open()`), not while drawing, and only as far as `WORDS` goes: Herdr's script engine takes about a quarter of a microsecond for a cell of that table (200 pairs of 230-character lines took 345 ms), and stops a task at 500 ms. Past the budget a changed line is all one color.
- Side by side clips a long line; one column scrolls sideways. So side by side is chosen only when the longest line fits in half the pane (`layout()`).
- A space in the text is drawn as a no-break space (`hard()`): a line is drawn in pieces, and a piece would lose the spaces at its ends.
- `on_size_change` reports the window's pixels: `width()` divides by the zoom before comparing with the pane's own lengths.
- A tick on an uncommitted file is kept with how many lines it added and removed and a number made from its diff: it goes when either changed (`prune()`, `open()`). A commit's tick stays.
- Branch file ticks compare Git’s old/new modes and full blob IDs from `--raw --no-abbrev -z --no-renames`, including for binary files and truncated displays. Viewing a follow-up promotes the whole-file tick only if the original changes were already read or the follow-up covers the whole change. Selecting a file or writing a note never advances the checkpoint.
- Saved notes retain the original text and context, side and line, both revisions and the file identity. On opening the list, verify them against the displayed tip. Reuse exact blob pairs, otherwise look for one matching changed line with its neighbors on the same side. Omitted lines, missing files, ambiguous matches and rewritten histories never silently move a note. Only selected, verified notes are copied. The copy action does not send to any terminal.
- The rows of the diff are in a virtual list. A gap click shows the whole file and a changed line click in a branch comparison opens a saved-note editor. A split change can offer both line anchors.

## Trying it

- The pane is tried in a window, together with the Git panel that opens it: see "Trying it" in `git-panel.md`.

- Run `node --test mods/git-diff/review.test.mjs` for a real scratch Git history and changed-line anchor cases.

- Verified in a separate Herdr window with a fake repository: the Git panel opened its base chooser and split a branch review pane, a viewed mark and checkpoint persisted, and a follow-up commit opened in the incremental comparison.
