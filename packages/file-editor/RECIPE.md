# File Editor

Cmd-click a source path printed by an agent and edit the file beside its terminal. Open another path in the same tab to add it to the editor's file strip. Markdown has a rendered preview and a formatting toolbar.

![A Markdown file in the editor and its rendered preview](preview.png)

## What you see

Use a split pane with tabs across the top, a dot beside unsaved files, a find bar when requested, and text at the terminal's font size. A thin strip at the right maps additions, deletions and edits since the last commit. The pane header follows the selected filename unless the user has named the pane.

## How it behaves

Cmd+S saves. Cmd+F finds, Cmd+Alt+F replaces, and Cmd+Shift+V switches between Markdown and preview. Support multiple cursors, per-file wrap, indentation inferred from the file, and line and Markdown commands from the package keys. Preserve unsaved drafts when a pane closes. If the file changes outside the editor, refresh clean text and ask how to reconcile dirty text.

Give each file tab a right-click menu with Close, Pin or Unpin, Close Others, Close to the Right, and Close All. Keep pinned tabs at the left with a pin icon and preserve their state across reopen. Bulk closes skip pins, close clean files first, and offer Save, Discard or Cancel for each remaining unsaved file. Close Others and Close to the Right use the clicked tab.

## Built from

Install both `mods/file-editor/` and `mods/editor-links/` and merge the editor key sections. Include `editor-links` in the personal layout's root `link_handlers`. The link handler accepts regular text files, sends `file-editor.open` with the tab and optional selection, and opens or focuses one editor pane per tab. Use Herdr's native editor and Markdown views. Keep drafts and their last-read text in per-tab local storage. Remote saves use a shell on the file's machine.

## Watch out

Treat truncated content as read-only. Compare the last-read text before saving and preserve remote file permissions. Forward binary files and folders to the next link handler. Herdr recognizes terminal paths containing a slash. Preserve Git change marks for staged files and compute marks outside the draw loop.

## Done when

Cmd-click a source path ending in a line and column, edit a line, then close and reopen the pane. The draft returns. An intervening disk edit prompts on save. Opening a second path reuses the pane, and a Markdown selection in preview can be located back in the source.

Pin one of several open files. Close All leaves the pinned tab and asks about unsaved files. Close to the Right leaves the clicked tab and tabs to its left open.
