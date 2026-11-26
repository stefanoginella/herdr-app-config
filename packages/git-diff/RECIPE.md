# Git Diff

Review a branch, commit, stash or working tree beside the terminal. Mark a file viewed and move straight to the next unread change.

![A side-by-side diff with word highlights and a viewed file](preview.png)

## What you see

Put a file list with addition and deletion counts on the left and the patch on the right in the terminal's font size. Split working-tree files into staged and unstaged groups. Use syntax colors and distinct backgrounds for changed lines and words. Label the Unified, Split and Whole file controls. Auto chooses two columns when the text fits and the file exists on both sides. Unified scrolls horizontally and shows both line numbers.

## How it behaves

Click a file in the **Git Panel** to open or reuse the current tab's diff pane. J and K move through files, V marks viewed, S changes columns, W shows the whole file, and F opens the searchable file picker. In a narrow pane the filename opens the picker too. O opens the current file in **File Editor**. Show the hunk's line numbers and the function name Git supplies. Click a gap to expand its unchanged lines in groups of up to 80 and click Hide to collapse it. For uncommitted text changes, show **Stage hunk** or **Unstage hunk** in each eligible hunk's heading. Remember review progress across restarts and clear a working-tree tick when that file changes again.

A branch review compares the common ancestor of a chosen base with the branch tip. Mark the displayed revision reviewed to open only follow-up commits on the next visit. Keep the whole-branch view available, preserve still-identical file ticks, and show the whole comparison with an explanation after a history rewrite. Click a changed line for a saved note. Show its original revision and excerpt, retain outdated notes, and copy the selected, verified notes as a single message.

## Built from

Install `mods/git-diff/` alongside the **Git Panel** package, which opens this view. The editor shortcut also needs **File Editor**. The panel sends `git-diff.open` with the tab, repository, machine, source, path and group. Reuse a `git-diff` pane with matching tab props or split one beside the terminal. Run Git on the source machine, parse patch rows once per read and draw them in a virtual list.

## Watch out

Keep commit, branch and stash comparisons read-only. Check the checkout and exact patch before piping a single hunk to Git on the checkout's machine with `git apply --cached`. Keep mode changes separate from content edits. Limit the diff to 6,000 lines and bound word and syntax processing. Save the source, mode and non-branch viewed marks in local storage. Share branch checkpoints, viewed blob pairs and notes by machine, checkout, branch and base. Key working-tree marks to changed content so switching context display does not clear them.

## Done when

Review two files, mark one viewed, and change it again from the terminal. Its tick clears. Switching between Unified and Split or revealing unchanged lines preserves ticks on the other files. Stage one of two hunks in a file, then unstage it. The working file stays intact.
