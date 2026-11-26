# File Editor

A file editor and viewer beside the terminals. Click a file in the Files panel and it opens in a pane of the tab, split in next to the focused pane; the next file opens in the same pane, as another tab in its strip. The Files panel stays where it is, and can show Changes meanwhile.

![A Markdown file in source and preview, with file size and text counts in the footer](images/file-editor.webp)

*A pinned Markdown file in the editor and its preview. The footer shows the size on disk and counts for the source.*

- **Wrapped lines:** long lines wrap, and go on under the line's own indentation. The Wrap button, or the command palette's "Editor: Toggle Line Wrap", turns that off for a file, and long lines then scroll sideways. The choice is kept with the file.
- **Indentation:** Tab indents as the file does: with tabs in a Makefile or a file indented with tabs, else by the file's own step of 2, 4 or 8 spaces.
- **Save:** Cmd+S. Nothing is saved by itself. A dot on a file's tab means unsaved text, and closing that tab asks first.
- **Changes made elsewhere:** a file an agent or git changes is shown as it now is, when nothing is unsaved here. When something is, a save is refused and the editor asks which text to keep.
- **Nothing typed is lost:** the open files and their unsaved text are kept as you type. Close the pane or restart Herdr, open a file in that tab again, and they are back.
- **Find and replace:** Cmd+F and Cmd+Alt+F, with match case and regular expressions. Enter and Shift+Enter, or Cmd+G and Cmd+Shift+G, go through the matches; Replace all is one undo. The bar shows the line of the current match, because the text shows a selection only while it has the keyboard: click that line, or press Cmd+Enter, to go to it with the keyboard in the text.
- **Several cursors:** Alt+click adds one, Alt+Shift+drag selects a block, Cmd+Alt+Up or Down adds one above or below. Escape goes back to one.
- **Lines:** Alt+Up and Alt+Down move the selected lines, Cmd+Shift+D duplicates them, Cmd+/ comments them out or back in.
- **Wrap a selection:** with text selected, typing `"` `'` `` ` `` `(` `[` `{` `<` or `~` puts the selection inside the pair instead of replacing it, and keeps it selected. In Markdown `*` and `_` do too, so typing `*` twice makes bold.
- **Same word:** Cmd+D selects the word under the cursor, then jumps to the next place it is found. It moves one selection: it does not add cursors.
- **Markdown:** Cmd+B bold, Cmd+I italic, Cmd+E code, Cmd+Shift+X strikethrough, Cmd+K link, Cmd+Shift+8 bullets, Cmd+Shift+7 numbers, Cmd+Shift+9 tasks (again ticks them). Enter in a list goes on with it, and ends it on an empty item; in a numbered list the items under the new one are counted on. The same as buttons above the text.
- **Edit and preview.** Cmd+Shift+V, Ctrl+Shift+V or the Preview button switches Markdown, CSV, SVG and HTML between source and a rendered view of the current draft. Markdown find results are highlighted in preview. Select something there and switch to Edit to find it in the source. For CSV, SVG and HTML, Find opens the source.
- **Web links.** Cmd-click an HTTP(S) URL in the source or a CSV cell to open it in the browser (Ctrl-click on Linux and Windows). In Markdown preview, click the link directly, including bare URLs in prose. HTML and SVG snapshots have a separate **Source links** bar when the draft contains web URLs. In the source, **Editor: Open Link at Cursor** in the command palette also opens a URL.
- **Images and PDFs.** Images open fitted to the pane. **Reload** reads the image again and a failed preview offers **Retry**. Animated images show their first frame. PDF opens on page one and has previous and next page buttons.
- **CSV and SVG.** The CSV table scrolls sideways and has controls for large sets of rows and columns. Drag a column’s right edge to resize it or double-click the edge to reset the width. Double-click a cell to edit it in place. **Apply cell** updates the draft without saving the file, and **Cancel** discards typing in that cell. Save, switch views or move to another page or tab to apply a pending cell edit. The editor preserves other cells, separators and record line endings. It recognizes commas, semicolons and tabs, and supports quoted and multiline cells. SVG previews in full color.
- **HTML.** Preview shows a static snapshot of the first viewport and loads local styles, images and fonts. Refresh picks up asset changes. **Open in Browser** serves the saved file and its project assets over a private local address for interactive use. The address expires after 15 minutes without a request.
- **File status.** The footer shows size on disk. Hover for the exact byte count. Text shows live line and character counts and the line ending style. CSV adds rows and columns, PDF adds total pages, and images and SVG show dimensions when available. The footer also identifies unsaved, read-only and SSH files.
- **Changes since the last commit:** a file git has gets a thin strip on the right of its text, with a mark where lines were added (green), changed (blue) or deleted (red), unsaved typing included. The strip is the whole file from top to bottom, not a margin: in a file shorter than the pane a mark is level with its lines, until a long line wraps above them, and in a longer file it shows where in the file they are. Click a mark, or press Alt+F3 and Alt+Shift+F3, or the `±` button that counts the changes, to go to a change with its lines selected. A file git does not have yet has no marks.

- **From a terminal:** Cmd-click a file path in a terminal, an agent's `src/app.ts:42:7` for one, and it opens in that tab's editor at that line and column (`editor-links`). Paths on another machine open there. Images and PDFs open in the editor too. Archives, unsupported binaries, folders and missing files go to Herdr's usual opener. Herdr only sees a path as a link when it has a folder in it (`src/app.ts`, `./app.ts`, `~/x/app.ts`): a bare `app.ts:42` is not underlined and can't be clicked.
- **Tabs.** Ctrl+W closes the current file, even if it’s pinned. It leaves the editor pane open and does not change Ctrl+W in terminals. Right-click a file tab for **Pin** or **Unpin**, **Close**, **Close Others**, **Close to the Right**, and **Close All**. Pinned tabs move to the left, stay pinned when the editor reopens, and survive all three bulk close actions. The mouse's back and forward buttons move through the tab strip.
- **Unsaved tabs.** A bulk close closes clean tabs first, then offers Save, Discard, or Cancel for each unsaved file. Cancel leaves the remaining files open.
- **The pane's name:** the pane's header says which file the editor shows, and "File Editor" when it shows none (the diff pane's says "Git Diff Viewer"). A name you give the pane yourself stays.
- **Text size:** the text is as large as the terminals' (`font_size`), as Herdr's own file preview and diff are.

Undo, redo, indenting, bracket pairs and folding are Herdr's own editor. Files too large to edit open read-only.

Media previews run on the macOS or Linux desktop for both local and SSH files. CSV and Markdown use Herdr's own UI. PDF needs Poppler (`pdfinfo` and `pdftoppm`). The HTML tools need Python 3.9+ and the snapshot uses a local Chrome or Chromium browser. On macOS common images use the built-in `sips` tool. On Linux the image preview needs ImageMagick 7. Image and PDF previews accept files up to 50 MiB. HTML assets must be smaller than 8 MiB. SSH machines use their standard shell tools, including `realpath` for HTML assets. The HTML reader serves the containing Git project, or the containing folder outside Git. Absolute URLs still work in the interactive browser, and paths starting with `/` on the preview server are relative to that project.

A file on another machine is edited the same way. It is saved by a short shell script that Herdr runs there, sent along with every save: nothing is installed on that machine, which only needs `sh`. The file keeps its permissions, and a save is refused when the file changed there meanwhile.

The keys are in `keys.json` under `mod:file-editor`, so they count only while the keyboard is in the editor. Cmd+F, Ctrl+W and both preview shortcuts are also under `mod:file-editor > Input`. The editor installs those bindings at the same depth as Herdr’s native text bindings so they work while you’re typing. There, Cmd+B, Cmd+D, Cmd+Shift+D and Cmd+/ do the above instead of what they do elsewhere (the sidebar, splitting a pane, help), and Cmd+Z undoes text instead of the last file action. `file-editor.wrap` is not bound; it and the preview are in the command palette.

---

[Back to the README](../README.md)
