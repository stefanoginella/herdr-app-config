# Git diff

A pane beside the terminals for reading a change, opened by clicking a file in the [Git panel](git-panel.md): of what is not committed, of a commit, of a stash, or of a branch comparison. One a tab; the next file clicked shows in the same pane.

![The diff pane with its file list and a changed function](images/git-diff.webp)

*An uncommitted change side by side, with the changed words marked and one file ticked as viewed. The names in the pictures are made up.*

- **Side by side** when the pane is wide and the longest line fits in half of it, else one column with the old and the new line numbers. `S`, or the button in the header, switches.
- **The words that changed** inside a changed line are colored stronger than the line.
- **Unchanged lines** are left out, three around each change, with a row that says how many were skipped. Click that row, press `W`, or use the header's button for the whole file.
- **Files:** listed on the left, in two groups for uncommitted changes (staged, not staged). `J` and `K`, the arrows, or the mouse's forward and back buttons go to the next and the previous one.
- **Viewed:** `V`, or the Viewed button, ticks the file and goes to the next one not viewed. The header counts them. A tick on an uncommitted file goes away when the file changes again.
- **To the editor:** `O`, or the pencil, opens the file as it is now in the [editor](file-editor.md), at the first changed line for an uncommitted file.

Uncommitted changes are read again as files change, less often after a slow read, and not while Herdr is in the background. The pane only reads: it changes nothing in the repository. The keys count while the pane has the keyboard. A diff is cut at 6,000 lines, and it is not syntax-colored.

## Review a branch

![Branch comparison showing the base, commit range and review controls](images/branch-review.webp)

In the Git panel’s Refs view, right-click the branch you want to read, choose **Review branch…**, then choose a base branch. Typing filters the list and Enter takes the first match. The repository header’s menu offers the same action for the current branch. The viewer shows the committed changes from the common ancestor to the reviewed tip. The two short commit IDs identify the exact comparison. **Refresh** reads both branch tips again, using refs available on the repository’s machine.

- **Mark this revision reviewed** remembers the displayed tip. Opening the branch again, or refreshing it after more commits, shows the follow-up changes. **Show whole branch** and **Since my last review** switch between the two ranges. If the original tip is outside the new history or the common ancestor moved, the viewer explains why it opened the whole branch.
- **Viewed** applies to the file’s content and mode on both sides. Files whose diff stays identical keep their ticks. Reading a follow-up for a file you previously marked viewed brings its whole-branch tick up to date. A file you skipped initially still needs its original changes reviewed.
- Click an added or removed line to write feedback. A split row with changes on both sides lets you choose the side. **Save note** keeps its path, original revision, side, line, excerpt and feedback. **Notes** lists these drafts for this checkout, branch and base, including after a restart. A note follows its line only when its context matches one changed line. Ambiguous or missing lines are marked outdated.
- In **Notes**, tick the feedback to include and choose **Copy review notes**. The copy names the branch, the base and the pinned tip. Outdated or unverified notes stay in the list. **Remove** deletes a saved note.

Six general commands can be bound in `keys.json`: `git-diff.next`, `git-diff.prev`, `git-diff.viewed`, `git-diff.mode`, `git-diff.whole` and `git-diff.edit`.

---

[Back to the README](../README.md)
