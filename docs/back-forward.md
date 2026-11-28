# Back and Forward

Click **Back** in the status bar to return to the tab you were using before you switched spaces or jumped to an agent. Herdr restores the pane you last used in that tab, including a file editor or diff pane. **Forward** takes you back through the same visits. A dim arrow means there is no visit in that direction.

Right-click either arrow, even a dim one, to see **Recent workspaces**. Each open space you’ve visited appears once, most recent first, with a check beside the current space. Click a name to switch directly to that space’s selected tab and pane. **Back** returns you to the tab you just left.

In the Power Tools layout, point at a terminal and press the mouse’s **Back** or **Forward** button to use workspace history. In a split tab, the pointer decides which history you use. Over the File Editor the buttons switch files, and over a diff they move between changed files.

**Option** (Alt) plus a side button also navigates workspace history over other panels when the mouse reports the modifier. With an MX Master 3 on macOS, Herdr can receive these as plain side clicks.

Switching panes within one tab updates where you return. Going back and then choosing a different tab starts a new path. Closed tabs are skipped. If a pane has closed, the arrow opens its tab with the pane Herdr selects.

The current window remembers up to 100 tab visits and 100 distinct recent workspaces in memory. Restarting Herdr, switching layouts or reloading the mod starts a fresh history. **Go Back** and **Go Forward** are also in the command palette. To assign shortcuts, use `back-and-forward.back` and `back-and-forward.forward` in the global section of `keys.json`.

Adapted from the MIT-licensed [PostHog mod](https://github.com/PostHog/herdr/tree/8b0be111696030a626c47f90dceb77a579d33768/back-forward).

[Back to the README](../README.md)
