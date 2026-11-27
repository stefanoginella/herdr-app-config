# `back-and-forward`

Two status-bar buttons step through the places visited in this window. This is an adaptation of PostHog’s community mod at revision `8b0be111696030a626c47f90dceb77a579d33768`. The upstream MIT notice is in `packages/back-and-forward/mods/back-and-forward/LICENSE`. [Upstream source](https://github.com/PostHog/herdr/tree/8b0be111696030a626c47f90dceb77a579d33768/back-forward)

## Implementation

- `main.js` keeps the history and paints the two arrows. `follow()` records the focused space, tab and pane on render. `nextIndex()` finds a visit in the requested direction. `go()` selects the destination space, then the tab, then its pane if it still belongs to that tab.
- All state is in the view instance. It holds at most 100 visits. Reloading the mod or switching layouts starts fresh. Destinations use Herdr’s full IDs, including the machine prefix.
- `mod.json` declares the two unbound palette commands, `back-and-forward.back` and `back-and-forward.forward`. Both and the buttons use `go()`. The chevrons come from Herdr’s shipped `workspace-chrome` assets. The layout supplies a 76 px block.

## Behavior to preserve

- The root handles Option-only Back/Forward on press. Outside the status block, `on_mouse_down_out` captures the press before panel handlers. Inside, the matching `on_mouse_down` handles it. Consume the chord even at a history boundary. Leave plain side clicks and other modifiers to the hovered control.
- Only a change of tab or space adds a visit. A pane change updates the current visit. A temporarily missing pane, for example when a layout terminal takes focus, preserves the last model pane.
- A new visit after Back discards the forward history. Skip unavailable tabs and consecutive equivalent destinations after a tab closes.
- Keep a copy of the requested pane before issuing the selection commands. Intermediate renders may already show the right tab focused on a different pane. When the saved pane no longer exists, let Herdr choose the tab’s remaining pane.

## Verification

The native checker loaded the mod. A simulated navigation test covered cross-machine IDs, redraws between commands, returning to a split pane, forward-history truncation, closed tabs and panes, and the history limit. A separate Herdr window with fake projects restored the expected space and pane in both directions using the two commands. Simulated side-button events checked both the inside and outside handlers, plain clicks, other modifiers and the end of history. The mouse shortcut was not tried by hand.
