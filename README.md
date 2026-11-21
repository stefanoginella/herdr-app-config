# Herdr Configuration

A setup for the [Herdr](https://herdr.dev) desktop app. This repository is the app's home folder, `~/.config/herdr-app`, with only the customized files tracked. Everything Herdr writes there itself is ignored.

## What's here

| Path | What it is |
|---|---|
| `mods/space-folders/` | The Spaces sidebar, with folders |
| `layouts/main-folders.json` | Herdr's default layout, showing that sidebar |
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

### Install

Built against Herdr 0.1.16. From a clone of this repository:

```sh
cp layouts/main-folders.json ~/.config/herdr-app/layouts/
cp -R mods/space-folders ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/space-folders
herdr-app do layout.switch '{"name":"main-folders"}'
```

Your own layout stays as it was: `layout.switch` goes back to it, and deleting the two copied items removes this one.

The layout and the sidebar are copies of Herdr's `main` and `spaces`, so they don't pick up changes Herdr makes to those later.

## How the repository works

`.gitignore` is an allowlist: everything in the folder is ignored unless it is listed there. Herdr's own mods and layouts sit next to the custom ones and are replaced on every start, and its state files change constantly. A new mod, layout or theme needs one line in `.gitignore`.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/space-folders/main.js` and `layouts/main-folders.json` are modified copies of files from Herdr, which is also Apache-2.0: see [NOTICE](NOTICE).
