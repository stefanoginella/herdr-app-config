# `mark-agents-unread`

Notes for agents on the mod in `packages/mark-agents-unread/mods/mark-agents-unread/`. The index and what holds for every mod are in `AGENTS.override.md`.

The gallery calls this mod Mark Agents Unread, and the sidebar heading is Agents. It is a clone of Herdr's `agents` list (from version 0.1.18) where an idle agent can be marked unread. A marked agent is drawn with the done dot and appears in the Done section in the priority view.

## What is where

- `main.js`: the list. `settle()` drops the marks that have served; `render()` turns a marked idle agent's status into `done` before anything is drawn; `row()` wraps the status dot in the click target and opens the menu on right-click.
- Hide names (see `hide-names.md`): `render()` reads the flag (`this.hidden`, for `subRow()` too); a row's name, its detail, its machine, a space group's header and a sub-agent's name are drawn through `alias.js`.
- `unread.js`: the marks and every change to them. `menu.js`: a row's right-click menu (mark as unread or read, pin or unpin, close an idle agent). The mod opens itself for it, with `props().menu`.
- A hovered row shows the pin button, and for an idle agent not marked unread a close button beside it (the menu's Close follows the same rule): `pane.close` on the agent's pane, which ends its terminal.
- State lives in shared `agents.unread`: `{ address: { left } }`. `left` means another pane has had the focus since the mark.
- Key command: `mark-agents-unread.toggle`, for the agent being looked at. It is not bound; it is in the command palette. `cmd-alt-1`…`cmd-alt-9` in `global` run `agent.select:N`, which follows this list's drawn order (`setAgentOrder()` in `render()`).

## Behavior to preserve

- Unread is this mod's alone: Herdr's status is untouched, so the tab bar, the spaces sidebar and the sounds still treat a marked agent as idle.
- Only an idle agent can be marked. A mark goes when the agent is focused again after another pane had the focus, when the agent is no longer idle, or by hand. Marking the agent being looked at must not clear at once: that is what `left` is for.
- `left` turns true only while another pane is known to have the focus. With no focused pane (a popup, a terminal block) nothing changes.
- A mark whose agent is not listed is dropped only after its machine's layout has been readable for 10 seconds. Before that the agent may only be unlisted while a layout loads.
- The row's dot target takes the same room as the dot it wraps, so rows with and without it line up.
