# Herdr Power Tools

Keep an agent's terminal, the file it is changing, and the Git diff side by side in [Herdr](https://herdr.dev). Install the whole workspace or pick the tools you need.

![Herdr Power Tools showing a weekly usage forecast, project folders and a Git graph](docs/images/power-tools.webp)

**Agent support.** Agent Usage reads Claude Code and Codex, and the optional Git commit-message writer can use either one. The file editor, search, Git tools and space folders work with ordinary terminals. You can mark agents unread when Herdr recognizes their status.

[See the whole window](docs/images/overview.webp) · [Install and update](#install) · [Upgrading an earlier install](#upgrading-an-earlier-install)

*Every picture is the real app in a demo workspace with fictional projects, sessions and figures.*

## What's here

Each feature has a page with everything it does: every key, limit and edge case.

| Feature | In short | Mod IDs |
|---|---|---|
| [Agent Usage](docs/usage.md) | Whether the agents' limits last the week, and where the usage went | `agent-usage` |
| [Space Folders](docs/space-folders.md) | Folders for the Spaces sidebar, with each space's containers and agents | `space-folders` |
| [Mark Agents Unread](docs/unread-agents.md) | Flag idle agents to come back to later | `mark-agents-unread` |
| [Git Panel](docs/git-panel.md) | Commit history, refs, branch review and everyday Git actions | `git-panel` |
| [Git Diff](docs/git-diff.md) | A diff pane, side by side, with the changed words marked | `git-diff` |
| [File Editor](docs/file-editor.md) | Edit and preview files in a pane, also from a path Cmd-clicked in a terminal | `file-editor`, `editor-links` |
| [Project Search](docs/project-search.md) | Search and replace in every file of the project | `project-search` |
| [Back and Forward](docs/back-forward.md) | Return to the tab and pane you left | `back-and-forward` |
| [Quick Actions](docs/quick-actions.md) | Run saved commands for the current project | `quick-actions` |
| [Go to File](docs/go-to-file.md) | Any file of the project, by some of its name | `go-to-file` |
| [File Explorer](docs/file-actions.md) | The Files panel with icons, change marks, drag and drop and search shortcuts | `file-explorer` |
| [Hide Names](docs/hide-names.md) | Made-up names around the content, for a screenshot or a screen share | `hide-names`, `tabs-names`, `pane-names` |

The `herdr-powertools` layout shows all of the above, with the panes you're not in faded and the dividers lit on hover. The repository also includes my key bindings and settings, notes for coding agents, and the [scripts that take these pictures](docs/screenshots/README.md).

## The tour

### Agent Usage

**Will the weekly limit last?** One sentence says so for the limit most at risk, Claude's or Codex's, and a ruler for each limit shows which project is spending it.

![The Usage dialog: the verdict, a ruler for each limit split by project, and the two weekly charts, with the sidebar widget over it](docs/images/usage.webp)

- **The week as a chart:** what was used against an even pace, and where this pace ends.
- **Burning now:** the projects that used an agent in the last hour, and how fast.
- **Where it went:** tokens and cost by project, model, session and machine, and the year as a calendar.

<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>U</kbd> opens it, and a widget above Spaces keeps the limits in view. [Everything about usage](docs/usage.md)

### Space Folders

**Folders for the Spaces sidebar.** Drag a space onto a folder, fold a folder to its count, and the next space opened on a filed project lands in the same folder.

![The Spaces sidebar with its folders open, and the same folders folded to their counts](docs/images/space-folders.webp)

- **Agents on the avatar:** a number counts a space's agents, in the color of the most urgent one.
- **Containers on the row:** a button starts and stops the project's DDEV or Docker Compose containers.
- **The order is real:** `space.next` and `space.prev` follow what is drawn.

[Everything about space folders](docs/space-folders.md)

### Mark Agents Unread

**Mark an agent as unread.** Click the ring on an idle agent's row and it goes back under Done, until you come back to it or it starts working again.

![The Agents list before and after an idle agent is marked unread: it moves from Idle to Done](docs/images/unread-agents.webp)

<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd> to <kbd>9</kbd> jump to the first nine agents, in the order drawn. [Everything about unread agents](docs/unread-agents.md)

### Git Panel

**The repository you are in, as a graph.** Every branch as lines of commits with what is not committed on top, and a second view of branches, remotes, tags and stashes.

![The Git panel: the graph of commits and branches, and the Refs view](docs/images/git-panel.webp)

- **Everyday git, by click:** stage, commit, fetch, pull, push, switch, branch, tag and stash.
- **A message written for you:** ask Claude or Codex for the commit message, then edit it.
- **GitHub at a glance:** with [`gh`](https://cli.github.com), a branch shows its pull request and a commit its checks. Open a failed check to read and copy the job log.
- **Go to Open Checkout** takes you from a checked-out branch to its open space.
- **Nothing drastic:** it never rebases, merges, resets or forces. Those stay in a terminal.

[Everything about the Git panel](docs/git-panel.md)

### Git Diff

**Read a change, file by file.** Click a file in the Git panel and its diff opens in a pane: side by side when it fits, with the changed words marked and the unchanged lines folded away.

![The diff pane: a change side by side, with the changed words marked and one file ticked as viewed](docs/images/git-diff.webp)

<kbd>J</kbd> and <kbd>K</kbd> walk the files, <kbd>V</kbd> marks one as viewed and moves on, and <kbd>S</kbd> switches between Split and Unified. Expand a gap for more context or stage an individual hunk. Choose **Review branch…** to compare against a base, save feedback on changed lines and return to the changes since your last review. [Everything about the diff pane](docs/git-diff.md)

### File Editor

**An editor beside the terminals.** Click a file and it opens in a pane, each file a tab. <kbd>Cmd</kbd>+<kbd>S</kbd> saves, nothing is saved by itself, and unsaved text survives a restart.

![A Markdown file in the editor, and its rendered preview](docs/images/file-editor.webp)

- **From a terminal:** Cmd-click `src/app.ts:42:7` and it opens at that line and column.
- **Previews:** Markdown, images, PDF, CSV, SVG and HTML, with file details in the footer.
- **Since the last commit:** a strip beside the text marks the lines added, changed and deleted.
- **The usual tools:** find and replace, several cursors, line and comment commands.

[Everything about the file editor](docs/file-editor.md)

### Project Search

**Search and replace across the project.** <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> switches between Search and Files. Search runs as you type in a repository. Open the replace row and every match shows what it becomes. [Powered by ripgrep](https://github.com/BurntSushi/ripgrep)

![The search panel beside the editor: matches grouped by file, each showing its replacement](docs/images/project-search.webp)

- **Narrow it:** match case, whole words, regular expressions, files to include and exclude.
- **Replace** one match, a file or all of them, and undo the last replace.
- **Walk the results** from anywhere with <kbd>F4</kbd> and <kbd>Shift</kbd>+<kbd>F4</kbd>.

[Everything about project search](docs/project-search.md)

### Go to File

**Any file, a few letters away.** <kbd>Cmd</kbd>+<kbd>O</kbd>, then some of the name: words in any order, `gp main` finds `git-panel/main.js`, and `:12` goes to a line. With nothing typed, the files opened lately come first.

![The Go to File popup with two words typed and the files that match](docs/images/go-to-file.webp)

[Everything about go to file](docs/go-to-file.md)

### File Explorer

**The Files panel, as a file manager.** Right-click for new, rename, duplicate, copy, paste and Trash, drag to move, and <kbd>Cmd</kbd>+<kbd>Z</kbd> takes back the last move, rename or Trash.

![The Files panel with its right-click menu, beside the editor](docs/images/file-actions.webp)

- **At a glance:** each type's icon, a dot on folders with changes inside, and the file in the editor highlighted.
- **To a terminal:** drag a file onto a terminal to paste its path, a quick way to hand it to an agent.
- **In and out.** Drop files in from Finder, open one in a [configured external app](docs/external-apps.md), or show it in your desktop’s file manager.
- **Search:** the header opens Project Search, and the folder menu can narrow it to that folder.

[Everything about File Explorer](docs/file-actions.md)

### Hide Names

**A screenshot without your project names.** <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> gives every space, folder, tab, branch and machine around the content a plausible made-up name, the same one every time. What the panes show stays real: that is the content you chose to show.

![The same window twice: with its real names, and with made-up names](docs/images/hide-names.webp)

[Everything about hide names](docs/hide-names.md)

### Workspace controls

Use the status bar arrows or hold Option and press a mouse side button to return to the tab and pane you left. **Quick Actions** opens with <kbd>Alt</kbd>+<kbd>Q</kbd> or the adjacent status button. Save a project command once and run it in a new terminal tab on that project’s machine.

![Saved DDEV commands and the navigation controls in the status bar](docs/images/workspace-tools.webp)

[Back and Forward](docs/back-forward.md) · [Quick Actions](docs/quick-actions.md)

## The same everywhere

Three things hold for every feature, so the pages don't repeat them:

- **Other machines.** A space on another machine works the same way: files, search, git and the editor run there through Herdr, with nothing installed. What needs this Mac (opening in an app, Finder, the clipboard, the Trash) is offered only for files here.
- **Nothing is overwritten or lost quietly.** A file operation onto a name that exists is refused, a save over a change made elsewhere asks first, discarded git changes become a stash, and the Git panel checks that what it showed is still true before it changes anything.
- **Quiet in the background.** The panels read while they are on screen and Herdr is the active app, and catch up when you come back.

## Keys

All in `keys.json`. A feature's page says what each key does; this is what to copy into a `keys.json` of your own.

| For | Copy |
|---|---|
| Undo in the Files panel | `"cmd-z": "file-explorer.undo"` in `global` |
| The editor | the sections `mod:file-editor` and `mod:file-editor > Input` |
| Project Search | the sections `mod:project-search` and `mod:project-search > Input`, and `cmd-shift-f`, `f4`, `shift-f4` from `global` |
| Go to File | the section `mod:go-to-file > Input`, and `cmd-o` from `global` |
| Quick Actions | `alt-q` from `global` |
| Hide Names | `cmd-shift-h` from `global` |
| Usage | `cmd-shift-u` from `global` |
| Jumping to an agent | `cmd-alt-1` to `cmd-alt-9` from `global` |

Commands without a key (folders, the Git panel's, the diff's, more of the editor's) are in the command palette, Cmd+Shift+P, and listed on each page.

## Install

### Install and update with herdr-pkg

Start Herdr once. From a clone of this repository, install the community [herdr-pkg manager](https://github.com/manastalukdar/herdr-pkg#install) if you do not already use it. Sign in with the GitHub CLI for a full install. The file icons alone exceed GitHub's anonymous hourly download quota.

```sh
git clone https://github.com/manastalukdar/herdr-pkg.git ../herdr-pkg
python3 ../herdr-pkg/scripts/install.py --no-adopt
```

Install the collection and select its layout:

```sh
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
pkg="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/pkg/pkg.py"
python3 "$pkg" install "$repo" --yes
herdr-app do layout.switch '{"name":"herdr-powertools"}'
```

For one feature, use its folder under [packages/](packages), for example `python3 "$pkg" install "$repo/packages/agent-usage" --yes`. Each recipe explains where to place it and which companion tools it opens. Merge any shortcuts the manager reports as already taken.

Already copied a mod? After migrating any older names, use `python3 "$pkg" adopt agent-usage --from "$repo"` to track that installed copy. Run it once per mod or layout you want to follow. The manager can track itself with `python3 "$pkg" adopt pkg --from manastalukdar/herdr-pkg`.

Open **Packages** to check for updates and choose **Update all**, or run `python3 "$pkg" update`. The manager tracks installed mods and layouts. Newly added tools, future shortcut changes and personal settings need separate attention. Its optional daily update indicator needs a layout block with `{"mod":"pkg","props":{"bar":true}}`. Applying an update takes a click or a scheduled invocation of the command.

### Follow the whole configuration with Git

For a fresh setup, clone this repository into `~/.config/herdr-app` before first launch, open Herdr, then select `herdr-powertools`. Update with `git -C ~/.config/herdr-app pull --ff-only`. This also brings in settings, key bindings, newly added mods and documentation. To try it alongside an existing setup, use a separate checkout and point `HERDR_APP_HOME` there when launching Herdr.

### Upgrading an earlier install

The layout was renamed from `main-folders` to `herdr-powertools`. The installed mod IDs changed from `agent-inbox` to `mark-agents-unread`, `git-graph` to `git-panel`, `files-actions` to `file-explorer`, `back-forward` to `back-and-forward`, and `status-names` to `hide-names`. The same migration also handles older installs that use `usage` and `agents-unread`. Quit Herdr, update the configuration checkout first, and run these commands from it before updating individual packages. The migration needs the repository's Git history.

```sh
python3 docs/migrate-mods.py
python3 docs/migrate-mods.py --apply
```

The first command previews the migration. It updates layout references, shortcuts and existing herdr-pkg records, and carries across saved layout and view settings. Backups go under the Herdr home's `data/powertools-migration-…/`. If a copied mod has local code edits, keep a copy of the edited folder outside Herdr, restore the original release's files to the old folder, run the migration, then reapply your edits to the new folder. For a separate Herdr home, pass `--home PATH`. Update any personal scripts that use an old mod command or switch to the old layout name.

### Copy by hand or ask your agent

Point your agent at this README or a [feature recipe](packages). It can install the full setup or just the tools you name.

By hand: this was built against Herdr 0.1.18. From a clone of this repository, the following adds the mods and the layout that shows them:

```sh
cp layouts/herdr-powertools.json ~/.config/herdr-app/layouts/
for m in space-folders mark-agents-unread file-explorer file-editor editor-links project-search go-to-file git-panel git-diff agent-usage tabs-names pane-names hide-names back-and-forward quick-actions; do
  cp -R "mods/$m" ~/.config/herdr-app/mods/ && herdr-app check ~/.config/herdr-app/mods/"$m"
done
herdr-app do layout.switch '{"name":"herdr-powertools"}'
```

Your own layout stays as it was: `layout.switch` goes back to it, and deleting the copied files removes all of this. Then copy the [keys](#keys) you want.

What needs what:

- Copy each mod's folder whole, `mod.json` included: a mod folder Herdr first sees without one is docked into the shown layout by itself.
- `file-explorer`, `project-search`, `go-to-file`, `editor-links` and `git-panel` open files in `file-editor`. `git-panel` needs `git-diff`, which is what a click on a file opens.
- `project-search` and `go-to-file` need [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep`), also on another machine whose project is searched. `agent-usage` needs `node`. The Git panel's GitHub marks need [`gh`](https://cli.github.com), and its message writer `claude` or `codex`.
- `editor-links` is turned on by the layout's `"link_handlers": ["editor-links"]` (Herdr adds it to a layout of your own the first time it sees the mod).
- `go-to-file` and the `agent-usage` dialog are in no layout: their keys open them.
- The three hide names mods, `space-folders`, `mark-agents-unread` and `agent-usage` share the mode: with only some of them, only those hide their names. `hide-names` holds the command that switches it.

For only one of them, copy and check its folder, then point a layout of your own at it: `{ "mod": "space-folders" }` in the `spaces` block, `{ "mod": "mark-agents-unread" }` in the `agents` block, `{ "mod": "file-explorer" }` in the `files` block, `{ "mod": "git-panel" }` in the `changes` block, or a block 62 px tall with `{ "mod": "agent-usage", "props": { "role": "side" } }` for the usage widget. `project-search` needs two blocks, as in `herdr-powertools.json`: the panel, and a block that is always shown (it can be 0 px tall) with props `{ "keys": true, "show": { ... } }`. That block handles Cmd+Shift+F, switching between Search and Files. Herdr's shipped layouts are read-only, so clone one first:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
```

The layout and the cloned mods are copies of Herdr's `main`, `spaces`, `agents`, `files`, `tabs`, `pane` and `workspace-status`, so they don't pick up changes Herdr makes to those later.

## How the repository works

This repository is the app's home folder, `~/.config/herdr-app`, with only the customized files tracked. Herdr's own mods and layouts sit next to the custom ones and are replaced on every start, and its state files change constantly. So `.gitignore` is an allowlist: everything in the folder is ignored unless it is listed there, and a new mod, layout or theme needs one line.

## License

Apache-2.0, see [LICENSE](LICENSE). `mods/space-folders/main.js`, `mods/mark-agents-unread/main.js`, `mods/file-explorer/main.js`, `mods/tabs-names/main.js`, `mods/pane-names/main.js`, `mods/hide-names/main.js` and `layouts/herdr-powertools.json` are modified copies of files from Herdr, which is also Apache-2.0. The icons in `mods/file-explorer/icons/` are Material Icon Theme's, which is MIT. See [NOTICE](NOTICE).
