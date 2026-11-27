# `git-diff`

Notes for agents on the mod in `packages/git-diff/mods/git-diff/`. The index and what holds for every mod are in `AGENTS.override.md`.

The diff pane, beside the terminals. It is not a clone. One a tab (props `{ tab }`), opened by the Git panel.

## What is where

- `main.js` owns the pane and its requests. `lists()` reads the file groups and `open()` reads the selected patch. `table()` draws hunk headings, gaps and code rows. `expand()` reads context from the original blob and `stageHunk()` applies a checked patch to the index.
- `title()` names the pane `TITLE` ("Git Diff Viewer") once, when it has no name, since a mod pane's own title is its folder's name.
- `fit()`, at the start of each draw, sets the text size to the terminals' (`settings().font_size`, as Herdr's own Changes diff has it since 0.1.17) and scales `CHAR`, `ROW` and `NUMBER` from what they were at 12 px.
- `review.js`: resolving branch refs and the merge base, checking a checkpoint, reading raw file identities and finding a saved line again. `notes.js`: the line-note editor and notes list, opened as dialogs on the diff mod with `props().reviewNotes`.
- A branch request uses `source: { kind: "branch", branch, base }` with full local or remote ref names. Reading it pins the common ancestor and tip. The pane reads the refs again on a new request or a manual refresh. Its whole-branch and incremental views show committed changes only.
- Shared `git-diff.review.<key>` stores the explicit checkpoint, branch file ticks and notes. The key encodes the machine, checkout root, branch ref and base ref. Read the current shared value again before each write so another pane’s notes or marks survive. Existing non-branch viewed state and the most recent pane request stay in local storage.
- `diff.js` builds the rows, tracks local gap ranges and assembles a patch from one raw hunk. `syntax.js` finds syntax colors and combines them with word-change marks. Both run under `node`.
- `file-picker.js` is a searchable dialog scoped to the pane that opened it. `git-diff.file-pick` carries the chosen path, group and picker ID until that pane takes it. `git-guard.js` is shared with Git Panel and checks the checkout, Git operation and expected revisions before changing the index.
- State: shared `git-diff.open` (`{ tab, root, on, source, path, group, at }`) holds a request only until the tab's pane takes it. The copy's `localStorage` keeps the last request (so the pane shows it again after a restart), the view chosen, and the viewed ticks.
- The pane handles J, K, V, S, W, O and F for `next`, `prev`, `viewed`, `mode`, `whole`, `edit` and `files`. `unified`, `split` and `auto` can set the mode directly. The mouse's back and forward buttons still move between files.

## Behavior to preserve

- The only writes are the explicit hunk actions in a working-tree diff. They run on the checkout's machine, check the branch and HEAD, then compare the exact patch to a fresh Git read. `git apply --cached` updates the index. Reverse applies to a staged hunk. A short shell script pipes the raw patch argument to Git, including CRLF and missing-newline markers.
- A text hunk from a modified file keeps the patch's path headers and skips mode changes. New or deleted regular files can use a complete single hunk. Untracked, binary, conflicted, truncated and oversized patches have no hunk action. Git Panel still offers file staging.
- The hunk action does not depend on Git Panel being visible. It refreshes the viewer and signals a matching panel after the index changes.
- One reading of the lists at a time (`listing`), and it always ends: `lists()` clears it whatever `read()` did, and starts again when it was asked to meanwhile (`relist`). The pane restores what it last showed when it opens, and the request that opened it arrives during that: left set, `listing` kept the pane on "Nothing changed here" for ever.
- A method of the view must not share its name with another: the second one wins without a word. `list()` draws the files, `read()` reads them.
- A file is listed only when `--numstat` lists it too: `--name-status` also names files that were only touched, since a read must not refresh the index.
- An uncommitted file's diff is read again with every reading of the lists: the same line edited twice leaves the lists as they were.
- `tick()` reads nothing while Herdr is not the active app (`away`); the first active tick marks the lists stale. It starts no reading sooner than four times as long as the last one took (`cost`, measured from `listedAt` in `lists()`). Neither applies to `take()`: a request from the Git panel, or the restore at start, reads at once.
- A tick is kept with a number made from the added and removed lines only (`diff.changes()`), not from the whole diff: that one changes with the lines shown around a change, and the whole-file view would take every tick away.
- Word and syntax spans are computed before drawing. `WORDS` bounds word comparisons and `COLOR_CHARS` bounds syntax scans. A long line, unknown file type or exhausted budget falls back to the available highlights. Syntax scanning uses the displayed line and carries no state across omitted lines.
- Unified and Split use the same theme-derived green and red line backgrounds at 25% opacity. Changed words get a second tint over the line background.
- Unified scrolls horizontally. Auto chooses Split when both columns fit and the file exists on both sides. An explicit mode stays selected until it is changed or Auto is selected again.
- A space in the text is drawn as a no-break space (`hard()`): a line is drawn in pieces, and a piece would lose the spaces at its ends.
- `on_size_change` reports the window's pixels: `width()` divides by the zoom before comparing with the pane's own lengths.
- A tick on an uncommitted file is kept with how many lines it added and removed and a number made from its diff: it goes when either changed (`prune()`, `open()`). A commit's tick stays.
- Branch file ticks compare Git’s old/new modes and full blob IDs from `--raw --no-abbrev -z --no-renames`, including for binary files and truncated displays. Viewing a follow-up promotes the whole-file tick only if the original changes were already read or the follow-up covers the whole change. Selecting a file or writing a note never advances the checkpoint.
- Saved notes retain the original text and context, side and line, both revisions and the file identity. On opening the list, verify them against the displayed tip. Reuse exact blob pairs, otherwise look for one matching changed line with its neighbors on the same side. Omitted lines, missing files, ambiguous matches and rewritten histories never silently move a note. Only selected, verified notes are copied. The copy action does not send to any terminal.
- The rows of the diff are in a virtual list. Gap controls read the nearest unchanged lines from the pinned old blob in groups of up to 80. A file can show up to 640 expanded lines at once. Whole-file view still uses Git's full context. A changed line click in a branch comparison opens a saved-note editor. A split change can offer both line anchors.

## Trying it

- The pane is tried in a window, together with the Git panel that opens it: see "Trying it" in `git-panel.md`.

- Run `node --test packages/git-diff/mods/git-diff/review.test.mjs` for scratch Git history, line anchors, index-only hunk staging with CRLF and a mode change, independent gap expansion and syntax spans.

- Verified in a separate Herdr window with a fake repository: the Git panel opened its base chooser and split a branch review pane, a viewed mark and checkpoint persisted, and a follow-up commit opened in the incremental comparison.
- Verified in an isolated Herdr window that the picker renders over a narrow pane, the selection moves via commands, and hunk actions fit in Unified view. A scratch mod exercised progressive gap expansion and collapse, staging and unstaging a single hunk, and rejection after the displayed patch changed. Physical clicks, typing and writes over SSH were not tried.
