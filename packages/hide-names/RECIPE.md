# Hide Names

Disguise the project names around a terminal during a screen share. One shortcut switches tabs, pane headers, the status bar and notifications to consistent made-up names. The terminal or document you chose to share stays readable.

![The same demo workspace with names shown and hidden](preview.png)

## What you see

The tab bar offers Files, Search and Git when the layout contains those panels. Keep Herdr's existing tab strip, pane headers, status bar and notification cards in their usual positions. Substitute plausible names for named tabs, project folders, machines and topic branches. Preserve the branch prefix, numbered tabs and common names such as main. The matching sidebar and usage tools follow the same switch when installed.

## How it behaves

Cmd+Shift+H or the palette's Hide Names / Show Names toggles the window. Draw each alias consistently wherever the same kind of name appears. Switching back restores the original display immediately. A fresh app session starts with names visible again.

## Built from

Install `tabs-names`, `pane-names`, `hide-names` and `toast-names` from the package's `mods/` folder and merge its key. In a personal layout set the tab bar's mod to `tabs-names`, the active tab's pane header to `pane-names`, the status block to `hide-names`, and the root's `"toast"` to `toast-names`. Turn `names.hidden` on or off through the shown status mod. Each mod computes aliases from the input and its kind. **Spaces Sidebar**, **Mark Agents Unread** and **Agent Usage** also read the flag.

With **Back and Forward** in the status bar, the pane header accepts `"props": { "terminalHistory": true }`. Plain Back and Forward mouse presses over a terminal then run the matching history command. File Editor and diff panes handle their own presses.

## Watch out

Apply aliases at draw time. Real IDs and paths still drive selection, file operations, sorting and machine commands. A terminal, document, diff, right-side panel, native menu or rename field can contain real text. A notification is free text: replace every name the window knows in it as a whole word, and keep an agent's program name. Herdr fits a notification card to its text only for its own `toast` mod; any other gets a fixed 340×72 card, so show a cut text whole on hover. Include this scope in the user-facing instructions.

## Done when

Toggle the mode and follow a project across two surfaces that display it, and into a notification that names it. Its aliases agree. Navigation and file operations reach the same targets in both modes. The next fresh launch shows the actual names.
