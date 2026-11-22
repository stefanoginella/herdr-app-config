# Herdr App Configuration

My personal setup for the [Herdr](https://herdr.dev) desktop app. It is opinionated: everything here follows my own preferences and the way I work. Feel free to fork it or use it as inspiration.

This repository is the app's home folder, `~/.config/herdr-app`, with only the customized files tracked. Everything Herdr writes there itself is ignored.

## What's here

| Path | What it is |
|---|---|
| `mods/space-folders/` | The Spaces sidebar, with folders |
| `mods/agents-unread/` | The Agents list, with "mark as unread" |
| `layouts/main-folders.json` | Herdr's default layout, showing those two |
| `keys.json`, `settings.json` | Personal key bindings and settings |
| `AGENTS.override.md`, `CLAUDE.md` | Notes for coding agents working in this folder |

## Space folders

Groups spaces into named folders in the sidebar. Folders are one level deep, and a space doesn't need one: it can stay at the root.

- **Add a folder:** the folder button next to `+` in the Spaces header, or right-click the header or the empty area under the list.
- **Move a space:** drag it onto a folder to put it in, onto a row to place it before or after that row, or under the list to take it out of every folder. Or right-click it: Move to, Out of folder, New folder.
- **Move a folder:** drag its header.
- **Rename or remove a folder:** right-click it. Removing a folder leaves its spaces at the root. Nothing is closed.
- **Fold:** click the header. A folded folder shows how many spaces it holds, and a dot when one of them needs you.

Placement survives restarts. It is also remembered by project (the repo, else the folder), so the next space opened on a filed project lands in the same folder.

The real order of spaces follows the sidebar, so `space.next`, `space.prev` and `space.select:N` match what is drawn.

Three commands can be bound in `keys.json`: `space-folders.new-folder`, `space-folders.fold-all` and `space-folders.unfold-all`.
A space's menu also opens its project in VS Code, and in Obsidian when the project is inside one of its vaults. The project is the repo's top folder, else the folder the space is in. Both are for spaces on this Mac.


## Unread agents

Marks an idle agent as unread: it goes back under Done, with the done dot, as a reminder to look at it later.

- **Mark as unread:** click the empty ring at the end of an idle agent's row, or right-click the row.
- **Mark as read:** click the same spot again, or right-click the row. It also happens by itself: when you open the agent again after having been somewhere else, and when the agent starts working.

Marking the agent you are looking at keeps it marked until you leave and come back. The mark lives in the list only: the tab bar and the spaces sidebar still show the agent as idle.

One command can be bound in `keys.json`: `agents-unread.toggle` marks the agent you are looking at, or clears its mark.

## Install

Built against Herdr 0.1.16. From a clone of this repository, this adds both mods and the layout that shows them:

```sh
cp layouts/main-folders.json ~/.config/herdr-app/layouts/
cp -R mods/space-folders mods/agents-unread ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/space-folders
herdr-app check ~/.config/herdr-app/mods/agents-unread
herdr-app do layout.switch '{"name":"main-folders"}'
```

Your own layout stays as it was: `layout.switch` goes back to it, and deleting the copied files removes all of this.

For only one of the two, copy and check its folder, then point a layout of your own at it: `{ "mod": "space-folders" }` in the `spaces` block, or `{ "mod": "agents-unread" }` in the `agents` block. Herdr's shipped layouts are read-only, so clone one first:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
```

The layout and both mods are copies of Herdr's `main`, `spaces` and `agents`, so they don't pick up changes Herdr makes to those later.

## How the repository works

Herdr's own mods and layouts sit next to the custom ones and are replaced on every start, and its state files change constantly. So `.gitignore` is an allowlist: everything in the folder is ignored unless it is listed there, and a new mod, layout or theme needs one line.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/space-folders/main.js`, `mods/agents-unread/main.js` and `layouts/main-folders.json` are modified copies of files from Herdr, which is also Apache-2.0: see [NOTICE](NOTICE).
