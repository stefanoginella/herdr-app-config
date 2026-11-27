# Quick Actions

This is the standalone Quick Actions mod from PowerMods, adapted for this layout. Its sources and MIT license are in `packages/quick-actions/mods/quick-actions/`. They were taken from `quick-actions-app/mods/quick-actions` at commit `93c58b5a7d0b3ab7564c45e9ecad68cc1e10cc7c`. [Upstream source](https://github.com/dougcunha/herdr-mods/tree/93c58b5a7d0b3ab7564c45e9ecad68cc1e10cc7c/quick-actions-app)

## What is where

- `mod.json` declares the dialog and palette entry. The layout mounts a second copy with `{ "part": "status" }`. This copy shows the terminal icon, remembers terminal focus, handles individual action shortcuts and tracks background jobs.
- `main.js` controls the list, editor, confirmation and status item. `list.js`, `form.js`, `output.js` and `ui.js` draw them. `demo.js` supplies examples only when a demo is requested. The icon files sit beside the scripts.
- `store.js` reads and updates `data/quick-actions.json`, expands defaults and manages local run files. The per-user `{actions: [...]}` format accepts existing upstream presets. Favorites sort the list. The mod does not require or update another layout's panel registry.
- `vars.js` captures the target, reads machine and Git context and quotes template values. `run.js` checks filters, prepares the run file and starts a tab or background process. `jobs.js` tracks hidden core terminals. `writer.js` starts a local agent only at the user's request to author a script. `core.js` supplies its agent launch arguments and requires no other mod.
- `data/quick-actions/` holds expanded run files, output, logs and generated scripts. Shared `quick-actions.*` keys hold revision, target, runner/lease state, job records and writer settings. All of this state stays untracked.
- The global shortcut is `alt-q` → `mod.open:quick-actions`. The status item receives `quick-actions.run-<id>`. The list and its confirmation also work when opened through the palette.

## Behavior to preserve

- Capture the originating tab, space, terminal, live directory, machine and reported branch at open. The saved last terminal is eligible only inside the same tab. Validate the target before preparing a script and again before launching. A closed or moved target asks the user to reopen the picker.
- Foreground scripts launch through `herdr-app do tab.new` with an explicit space, working directory and program arguments. Both upstream `terminal` and `tab` presets launch this way. Never type a script into an existing terminal or guess which tab a concurrent launch created. Background jobs call `hc run` on the captured machine with the same directory.
- On a remote run, copy the local run file with `hc put` to the captured terminal's machine. Expand variable values in the chosen interpreter's quoting rules. Recheck the project filter at execution time.
- **Add 2 examples** uses a file icon and appends two predefined presets through the ordinary list save. The agent writer is a separate action.
- Preserve the expected-text write when saving the action list. Only the copy holding the job lease polls running background jobs. The disk files and shared state belong to the user's private configuration.

## Trying it

Use the screenshot sandbox or a fresh fake Herdr home and core. Create an action with a name, a folder filter and `pwd` as the script. Open it from a terminal in a scratch checkout, run it and confirm that a new tab starts in the same space and directory. A background action exposes its output in the list. Change the original terminal's directory while the dialog is open and try to run the old target.

Verified in an isolated macOS Herdr 0.1.18 instance with a real Git checkout, saved inline actions, a saved file-based background action and a live directory change. The search field submits Enter and has its own deeper `QuickActionsSearch > Input` bindings for Up and Down. The picker’s `down` and `enter` commands selected and launched the second saved action. Both a new-tab preset and a legacy foreground preset created separate tabs. The directory-change case created no tab. The native checker passed. Physical typing, pointer actions, Windows, live SSH and the optional agent writer were not exercised in this integration.
