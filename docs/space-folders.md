# Space folders

Groups spaces into named folders in the sidebar. Folders are one level deep, and a space doesn't need one: it can stay at the root.

![The Spaces sidebar with three folders, a space's branch, its containers and its agents, and the same folders folded](images/space-folders.webp)

*The sidebar: folders of spaces, with each space's branch, containers and agents, and the same folders folded to their counts. The names in the pictures are made up.*

Each machine has folders of its own, drawn under its header, and a folder holds only that machine's spaces.

- **Add a folder:** the folder button next to `+` in the Spaces header, or right-click the header or the empty area under the list: the folder goes on the machine of the space shown. Right-click a machine's header for a folder on that machine.
- **Move a space:** drag it onto a folder to put it in, onto a row to place it before or after that row, or under the list to take it out of every folder. Or right-click it: Move to, Out of folder, New folder.
- **Move a folder:** drag its header.
- **New space in a folder:** the `+` on a folder's header, shown while the pointer is on it, makes a space in that machine's home folder and files it there. Or right-click the folder, New space here.
- **Rename or remove a folder:** right-click it. Removing a folder leaves its spaces at the root. Nothing is closed.
- **Fold:** click the header. A folded folder shows how many spaces it holds, and a dot when one of them needs you.

A space's row also says what runs in it:

- **Agents:** a number on the space's avatar counts its agents, in the color of the most urgent one (a ring when all are idle). An idle agent [marked unread](unread-agents.md) counts as done.
- **Containers:** the DDEV projects and Docker Compose stacks of the space's project (its repo's top folder, else where it is) show as a button at the row's end: a site for DDEV, the whale for Docker, with a dot that is green when all of it runs and amber when part of it does. Click it to start or stop them; the space's menu does it one stack at a time, and opens a running DDEV site. A dev container's stack has a button of its own, so a click on the project's never touches it. Starting uses `start` for containers that exist and `up -d` only for a stack never brought up; stopping is `stop`, never `down`.

Placement survives restarts. It is also remembered by project (the repo, else the folder), so the next space opened on a filed project lands in the same folder.

The real order of spaces follows the sidebar, so `space.next`, `space.prev` and `space.select:N` match what is drawn.

A space's menu also opens its project in VS Code, and in Obsidian when the project is inside one of its vaults. The project is the repo's top folder, else the folder the space is in. Both are for spaces on this Mac.

Three commands can be bound in `keys.json`: `space-folders.new-folder`, `space-folders.fold-all` and `space-folders.unfold-all`. They are also in the command palette (Cmd+Shift+P).

---

[Back to the README](../README.md)
