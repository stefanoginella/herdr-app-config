# `back-and-forward`

Two status-bar buttons step through the places visited in this window. This is an adaptation of PostHog’s community mod at revision `8b0be111696030a626c47f90dceb77a579d33768`. The upstream MIT notice is in `packages/back-and-forward/mods/back-and-forward/LICENSE`. [Upstream source](https://github.com/PostHog/herdr/tree/8b0be111696030a626c47f90dceb77a579d33768/back-forward)

## Implementation

- `main.js` keeps the history and paints the two arrows. `follow()` records the focused space, tab and pane on render. `nextIndex()` finds a visit in the requested direction. `go()` selects the destination space, then the tab, then its pane if it still belongs to that tab.
- The status-bar instance holds at most 100 tab visits and a separate list of the last 100 distinct space IDs in visit order. Reloading the mod or switching layouts starts fresh. Destinations use Herdr’s full IDs, including the machine prefix.
- Right-click opens a popup copy with the recent IDs in its props. It resolves names, machine labels and the active check against live spaces on render. `alias.js` supplies the same project and machine names as the sidebar when Hide Names is on. Only the status-bar copy follows focus and listens for navigation commands.
- `mod.json` declares the two unbound palette commands, `back-and-forward.back` and `back-and-forward.forward`. Both and the buttons use `go()`. The chevrons come from Herdr’s shipped `workspace-chrome` assets. The layout supplies a 76 px block.
- In the Power Tools layout, the `pane-names` header gets `{ "terminalHistory": true }`. On a terminal it extends a transparent side-button target from the header into the body. Herdr clips the target to that pane’s frame. It calls the same two commands.

## Behavior to preserve

- Plain Back/Forward follows the pointer over a terminal, including an unfocused terminal in a split. Mod panes have no terminal target. The editor, diff and other panels keep their own plain side clicks.
- The status block also handles Option-only Back/Forward on press when the driver reports Option. Outside the block, `on_mouse_down_out` captures the press before panel handlers. Inside, the matching `on_mouse_down` handles it. Consume the chord even at a history boundary. Other modifier combinations pass through.
- Only a change of tab or space adds a visit. A pane change updates the current visit. A temporarily missing pane, for example when a layout terminal takes focus, preserves the last model pane.
- A new visit after Back discards the forward history. Skip unavailable tabs and consecutive equivalent destinations after a tab closes.
- Both arrows open the same recent-workspace list, including at either history boundary. Back and Forward visits update its order, and branching preserves previously visited spaces in the list. Choosing a row uses `space.select`, as in the sidebar. Closed spaces drop out of the popup and are checked again at click time.
- Keep a copy of the requested pane before issuing the selection commands. Intermediate renders may already show the right tab focused on a different pane. When the saved pane no longer exists, let Herdr choose the tab’s remaining pane.

## Verification

The native checker loaded the mod. A simulated navigation test covered cross-machine IDs, redraws between commands, returning to a split pane, forward-history truncation, closed tabs and panes, and the history limit. A separate Herdr window with fake projects restored the expected space and pane in both directions using the two commands. Simulated events checked Option-only handling inside and outside the status block and at the end of history.

An isolated Herdr window exercised both right-click callbacks with three demo spaces, including a dim Forward arrow. Selecting a row through its click callback switched spaces, and Back restored the previous tab and pane. The screenshot confirmed the list fits its rows. Its scroll area needs an explicit height or only the heading appears. Simulated events also covered repeat visits, branching, renamed and closed spaces, remote IDs, Hide Names and the 100-space limit. The pointer gestures were simulated.

In an isolated stock Herdr 0.1.18 window on macOS, an MX Master 3 delivered Back and Forward with `alt: false` while Option was held. With a terminal above a two-file editor, the owner verified that plain Back over the editor switched files and that Back and Forward over the terminal switched workspace tabs in both directions. Simulated presses checked both header positions, modifier filtering and the opt-in on terminal panes.
