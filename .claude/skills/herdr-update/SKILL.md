---
name: herdr-update
description: Herdr update check. Compares this setup's clones and custom mods with what changed in Herdr since they were last checked, and reports what breaks, what to port and what's new. Use after Herdr updates itself, when the owner asks what a new Herdr version means for this setup, or before porting the clones.
---

# Check a Herdr update

This setup's mods and layout were built against one Herdr version. Herdr has since updated itself. This skill finds everything in between that bears on the setup and ends in one **report** to the owner.

It reads, and writes in two places only: the scratchpad (outside Claude Code: `$TMPDIR/herdr-update`), and one new entry in `checks.md` next to this file (step 7). Its reads are `gh api`, `diff`, `jq`, `find`, `grep`, `herdr-app --version`, `herdr-app status` and `herdr-app check`. **The run ends with the report.**

`AGENTS.override.md` is the map of the setup: "What is custom" says what each mod is and what it stands on, and the "Behavior to preserve" headings say what must keep working. Read it in full first. Run every command from the Herdr folder (`~/.config/herdr-app`): the paths are relative to it.

## 1. The range

- **Baseline:** the `from version X` in the clone entries under "What is custom" in `AGENTS.override.md`. It is the version the clones are ported up to. (`cloned_from.version` in a clone's `mod.json` is Herdr's record of the first clone. It stays put, so it is never the baseline.)
- **Last checked:** the `to` version of the newest entry in `checks.md`.
- **Start:** the newer of the two. **Installed:** `herdr-app --version`.
- **Open items:** every item still under "Open" in any entry of `checks.md`. They are carried into this report as they are, and they don't need checking again.

Fetch these once and save them in the scratchpad:

```sh
gh api "repos/herdrdev/herdr-app/contents/CHANGELOG.md?ref=v<installed>" -H "Accept: application/vnd.github.raw" > <scratch>/CHANGELOG.md
gh api "repos/herdrdev/herdr-app/compare/v<start>...v<installed>" > <scratch>/compare.json
```

The compare lists at most 300 files and gives no warning when it cuts. If `jq '.files|length'` says 300, compare one version to the next instead, and merge the lists.

If start is the installed version, report that the setup is checked up to it, list the open items, and stop.

Done when: start, installed, and every version between them (the `## [x.y.z]` headings of the changelog) are named.

## 2. Health now

- Herdr restarted into the installed version: `last_run` in `update-notes.json` is the installed version. If it isn't, report that Herdr hasn't restarted yet and skip the rest of this step.
- `herdr-app status` shows `"layout": "main-folders"` and `"errors": []`.
- `find . -maxdepth 2 -name '*.error'` finds nothing (`layout.error`, `keys.error`, `settings.error`, `programs.error`: a file Herdr refused).
- `herdr-app check mods/<name>` passes for every custom mod: the `!/mods/<name>/` lines of `.gitignore`.

Done when: each of these has a result, and every custom mod has a pass or fail line with any warnings, quoting the exact error on a fail.

## 3. The originals

The installed copy of a shipped file is already the new version, so only the start version is fetched:

```sh
gh api "repos/herdrdev/herdr-app/contents/<original>?ref=v<start>" -H "Accept: application/vnd.github.raw" > <scratch>/<name>.old
diff <scratch>/<name>.old <installed copy>
```

The clones, copied from a shipped file (`grep -l cloned_from mods/*/mod.json layouts/*.json` finds them all):

| Clone | `<original>` | Installed copy |
|---|---|---|
| `space-folders` | `defaults/mods/spaces/main.js` | `mods/spaces/main.js` |
| `agents-unread` | `defaults/mods/agents/main.js` | `mods/agents/main.js` |
| `files-actions` | `defaults/mods/files/main.js` | `mods/files/main.js` |
| `main-folders` | `defaults/layouts/main.json` | `layouts/main.json` |

The shipped mods that other custom mods stand in for. Nothing was copied from them, but they show what Herdr added that the custom mod lacks:

| Stand-in | `<original>` | Installed copy |
|---|---|---|
| `git-panel`, `git-diff` | `defaults/mods/changes/main.js` | `mods/changes/main.js` |
| `go-to-file` | `defaults/mods/picker/main.js` | `mods/picker/main.js` |
| `file-editor` | the `files-actions` diff, read again for the preview | |

Done when: every hunk is either a change to port (what it does, where it lands in the clone) or set aside with a reason.

## 4. The changelog

An **item** is one feature or one fix. Take every bullet under `### New` and `### Fixed` (nested bullets too, bold headline or not) of every version after start, up to and including the installed one. Split a bullet that names several features into one item for each. Hold each item against every custom mod, `editor-links` included, and file it under the first of these kinds it fits:

1. **Moves what a workaround stands on:** it changes something a "Behavior to preserve" item or a "Working here" note relies on. For example: how a mod pane gets the keyboard, key sections and their order, Cmd+F, Cmd+O or Cmd+P, file drags, link detection and what a link handler is given, `exec`, `writeTextFile`, which copies a command reaches, `workspace.panels` and the `changes` block's id, `on_size_change` at a zoom, the time a script may run, `mod.open` and popups. Name the "Behavior to preserve" items to try again.
2. **Replaces a mod:** Herdr now does what a custom mod does (one in "What is custom"). Say what switching would gain and what it would lose. The owner decides, and a mod stays until they say otherwise.
3. **Lifts a limit:** it gives what a note in `AGENTS.override.md` says a mod can't have. For example: more than one selection, a scroll position, a mark beside an editor line, handlers on virtual-list rows, a remote `writeTextFile`, an import from another mod, a syntax highlighter for any text, a `props()` that stays the copy's own after an `await`, a faster script engine. Name the workaround it retires and its note.
4. **Everything else:** what it is, in a sentence. Why it matters for this setup (or that it doesn't). How it could be used here: a setting, a command or `herdr` function a mod could call, a key to bind, a shipped feature to try.

Done when: every item of every version in the range appears in the report exactly once.

## 5. The source

The changelog misses things. 0.1.17 changed how a `keys.json` section name is read without saying so, and broke every `> Input` section. Read the diff (`jq -r '.files[] | select(.filename=="<file>") | .patch' <scratch>/compare.json`) of every file in the compare that is:

- under `defaults/`, `docs/` or `vendor/gpui-kit/`. This includes `defaults/AGENTS.md`, `defaults/herdr.d.ts` and `vendor/gpui-kit/crates/shell/src/typings.rs` (the API and its types: `gpui-kit.d.ts` is written from it), the time limits in `engine/quickjs/sandbox.rs` and `scheduler.rs`, the mods other mods call (`worktree`, opened by `space-folders/menu.js`) or stand beside (`tabs`), and `defaults/keys*.json`. The owner's `keys.json` is edited, so new default keys never reach it: report every one.
- `src/keys.rs`, `src/mods.rs`, `src/mod_files.rs`, `src/links.rs`, `src/window.rs`, or under `vendor/gpui-pre/src/`.

A file whose `patch` is missing (a big diff): fetch it at both tags into the scratchpad and diff them there.

Done when: every change in those files is matched to an item from step 4 or reported as a **silent change**, under the kind it would have had. Every other file in the compare gets one line saying why it doesn't touch the setup.

### Subagents

When the compare lists more than about 20 files, give steps 3, 4 and 5 each to its own subagent, in parallel. Give each its step number, the start and installed versions, the scratchpad path and `AGENTS.override.md`. The step-5 agent also gets the changelog and matches against it itself. Each returns items as `{ kind, version, item or file, mods touched, proposal }`, and no report. Merge them into the report.

## 6. The report

In the chat, in this order. An empty section keeps its heading and says "None."

1. **Range:** start → installed, and the versions in between.
2. **Open from earlier checks:** the open items from `checks.md`, with their entry's date.
3. **Health:** the results of step 2.
4. **Moves what a workaround stands on**, 5. **Replaces a mod**, 6. **Lifts a limit:** one item each. Give the version and the item, the mods it touches, what it means for them and what is proposed. Mark silent changes from step 5.
7. **The originals:** for each clone, the hunks to port, then each hunk set aside with its reason, one line each. Then what the stand-ins have that the custom mods lack.
8. **Everything else:** grouped by version, one line per item: what it is, why it matters, how it could be used.
9. **Source files set aside:** one line per file.
10. **Proposed changes:** a numbered list of every edit the report suggests. Name the files, and the "Behavior to preserve" items to try again by hand. Mark the ones that need the owner's decision.

## 7. The log

Add an entry at the top of `checks.md`, under its title:

```markdown
## <date>: <start> → <installed>

Open:
- 1. <proposed change, as numbered in the report>

Settled:
```

Every proposed change starts under "Open". The repository is public, so an entry holds versions, dates and short titles that name mods and Herdr features only: no paths outside this folder, no machine, space or project names, nothing personal.

## After the report

Make a proposed change only after the owner names it. Then:

- Port the change into the clone, run `herdr-app check` on it and `herdr-app status`, and look with `herdr-app shot`.
- For a lifted limit, use what Herdr now gives. Delete the workaround and its note in `AGENTS.override.md`, and its example in step 4 here if it has one.
- Try again the "Behavior to preserve" items the report named, and say which could not be driven from a shell.
- In `checks.md`, move the item under "Settled", marked `made` or `declined`.

When no item of an entry is left open, the clones are ported up to its `to` version. Make that the new baseline: replace `from version <old>` in the clone entries of "What is custom", `Built against Herdr <old>` in `README.md`, and `(version <old>)` in `NOTICE`. Other version mentions date a fact ("since 0.1.17"): leave them.
