// The Git panel: the history of the repository the focused pane is in, as a graph, with its
// branches, remotes, tags and stashes, and what is not committed yet. A click on a file shows
// its diff in the tab's `git-diff` pane, beside the terminals.
//
//   refresh()   reads the repository (status, refs, stashes), and the log again only when
//               something in it moved (`stamp`)
//   graph()     the list of commits; cell() draws one row's lines
//   refs()      the lists of branches, remotes, tags and stashes
//   detail()    what is selected: the uncommitted files, a commit's, a stash's
//   act()       runs a request (ops.js) and says what went wrong
//   show()      asks the tab's diff pane for a file; edit() asks its editor
//
// The panel reads only while it is on screen (shows()), and writes only what ops.js lists.

import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, openOverlay, nextCommand, run, shared, setShared, layout, checking } from "herdr";
import Menu, { any, height } from "./menu.js";
import Naming from "./naming.js";
import Confirm from "./confirm.js";
import * as ops from "./ops.js";
import * as hub from "./hub.js";
import * as git from "./git.js";
import * as write from "./write.js";
import { layout as lanes, TOP, MID } from "./lanes.js";

const MOD = "git-panel";
// The diff pane and the editor: what they read in shared state.
const DIFF = "git-diff", EDITOR = "file-editor";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;

// The graph: a row's height, a column's width, the room left of the first column, and the
// most columns drawn (a wider history is drawn with its last columns on top of each other).
const ROW = 26, LANE = 12, PAD = 9, LANES = 9;
// In a row: the circle with the author's initials, and the least room the date has.
const AVATAR = 16, AGO = 28;
// The key of the row for what is not committed yet.
const WORK = "WORK";
// Commits read at first, and more with each "Load more".
const PAGE = 1000, MOST = 10000;
// Files listed for one commit, and uncommitted files drawn in one list.
const FILES = 300;
// How often the timer looks (it does nothing unless something is due), and when a look is due
// with no word from the folder watch: on this machine, and on another, which has no watch.
const TICK = 1500, HERE_EVERY = 15000, THERE_EVERY = 8000;
// GitHub is asked this often, and this often while a workflow runs. A repository that is not
// there is asked about again after a while: a remote may have been added.
const HUB_EVERY = 60000, HUB_RUNNING = 15000, HUB_AGAIN = 600000;
const NOTE_FOR = 5000;
// How deep repositories are looked for under the pane's folder, and how long what was found is
// believed. The depth is that of the `.git` inside one, so 6 finds a repository five folders
// down. A WordPress theme is four down (wordpress/wp-content/themes/<name>): at 4 a project
// folder that is no repository itself, with its only ones there, showed none.
const DEPTH = 6, SURVEY_EVERY = 300000;
// No request runs longer than this (ops.js waits two minutes for the network). One still
// marked as running after it was cut off (the mod was reloaded under it), and is let go.
const BUSY_MOST = 135000;

const short = (sha) => sha.slice(0, 7);
const base = (path) => path.slice(path.lastIndexOf("/") + 1);
const parent = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
// A commit's message is wrapped for a terminal: its paragraphs are joined again, to wrap at
// the panel's width. Lists, quotes, trailers and indented lines stay as they are.
function unwrap(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const last = out[out.length - 1];
    const own = !line.trim() || /^(\s|[-*+>#]|\d+[.)]\s|[\w-]+: )/.test(line);
    if (!own && last && last.trim() && !/^([\w-]+: )/.test(last)) out[out.length - 1] = `${last} ${line}`;
    else out.push(line);
  }
  return out.join("\n");
}
const markColor = (t, mark) => (mark === "A" || mark === "U" ? t.ansi2 : mark === "D" || mark === "!" ? t.ansi1 : t.blocked);
const checkColor = (t, state) => (state === "fail" ? t.ansi1 : state === "running" ? t.blocked : t.ansi2);

// A mod pane (the diff, the editor) is in no folder: while one has the focus, the panel goes
// on showing the repository of the terminal that had it before, in that tab.
const held = new Map();
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane?.mod && held.has(pane.tab)) return held.get(pane.tab);
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const at = { cwd: pane?.cwd || f?.cwd || space?.folder, on };
  if (pane && !pane.mod) held.set(pane.tab, at);
  return at;
}

// Whether a copy of this mod in the layout is on screen: no block around it hidden, and every
// stack around it showing its way. A copy in a window can't be told from that one: it is
// on screen as long as it is open (`shows()`).
function visible() {
  const walk = (node, shown) => {
    if (!node || typeof node !== "object") return null;
    const here = shown && !node.hidden;
    if (node.content?.mod === MOD) return here;
    let found = null;
    for (const child of node.children ?? []) {
      const r = walk(child, here && (node.type !== "stack" || node.active === child.id));
      if (r) return true;
      if (r === false) found = false;
    }
    return found;
  };
  return walk(layout(), true) !== false;
}

export default class GitPanel extends View {
  init(_props, cx) {
    // Opened by itself as a popup or a dialog: the menu, the name prompt, the question.
    const p = props();
    const Other = p?.menu ? Menu : p?.naming ? Naming : p?.confirm ? Confirm : null;
    if (Other) {
      this.other = new Other();
      this.other.init(cx);
      return;
    }
    // Props { root, on } pin the folder shown, whatever has the focus: for a test window. Read
    // here and kept: after an `await`, `props()` and `localStorage` may answer for another
    // copy, the one that drew last.
    this.pin = typeof p?.root === "string" ? { cwd: p.root, on: p.on ?? null } : null;
    this.pending = {};
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.tasks = [];
    this.cost = 0;
    this.paths = new Map();
    this.view = (p?.view ?? localStorage.getItem("view")) === "refs" ? "refs" : "graph";
    try { this.folded = JSON.parse(localStorage.getItem("folded") ?? "{}") ?? {}; } catch { this.folded = {}; }
    // Which repository is shown for a folder, when it is not the one the folder is in:
    // { folder's key: top folder }. And who writes commit messages.
    try { this.choice = JSON.parse(localStorage.getItem("choice") ?? "{}") ?? {}; } catch { this.choice = {}; }
    this.writer = write.writer(localStorage.getItem("writer")).id;
    this.surveys = new Map();
    this.bad = new Set();
    this.message = "";
    this.input = TextareaState.new({ placeholder: "Commit message" });
    this.input.set_auto_grow(1, 9);
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.message.trim());
      this.message = this.input.value();
      if (had !== Boolean(this.message.trim())) cx.notify();
    });
    // Enter is a new line: a message has a body. Cmd+Enter commits.
    this.input.on("submit", (e, cx) => { if (e?.secondary) this.commit(cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.reset();
    if (checking()) return;
    cx.timer.every(TICK, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") { this.stale = true; this.refresh(cx); }
        else if (c === "fetch") this.ask({ op: "fetch" }, cx);
        else if (c === "pull") this.pull(cx);
        else if (c === "push") this.push(cx);
        else if (c === "write") this.generate(cx);
        cx.notify();
      }
    });
  }

  where() { return this.pin ?? location(); }

  // Whether this copy is on screen. One pinned to a folder is a test window, which is not in
  // the layout: without this it read only while the layout's own panel was shown.
  shows() { return Boolean(this.pin) || visible(); }

  // The folder the pane is in, and the repository chosen for it when one was.
  folder() { return JSON.stringify(this.where()); }

  key() { const at = this.folder(); return `${at}|${this.choice[at] ?? ""}`; }

  // Something to remember, written at the next draw (see `pin` in init for why not here).
  remember(name, value) { this.pending[name] = value; }

  // Nothing is known about the repository shown: another one is, or none.
  reset() {
    this.context = null; this.root = null; this.on = null; this.common = null; this.state = null;
    this.status = git.parseStatus(""); this.heads = []; this.remotes = []; this.tags = []; this.stashes = []; this.remoteNames = [];
    this.stats = { staged: {}, unstaged: {} };
    this.commits = []; this.rows = []; this.width = 1; this.index = new Map(); this.pills = new Map();
    this.limit = PAGE; this.more = false; this.stamp = null;
    this.sel = null; this.details = new Map(); this.empty = null;
    this.error = null; this.note = null; this.busy = null; this.stale = true; this.last = 0;
    this.turn = (this.turn ?? 0) + 1;
    this.hub = null; this.hubAt = 0; this.hubRoot = null;
    for (const w of this.watches ?? []) w?.cancel?.();
    this.watches = []; this.watching = null;
  }

  // A task begun while the panel is drawn. Its first step would run inside the draw itself,
  // where asking for another draw is refused, and that ends the task: so it waits one step.
  after(cx, body) {
    cx.spawn(async (cx) => { await null; await body(cx); });
  }

  tick(cx) {
    const now = Date.now();
    if (this.busy && now - this.busyAt > BUSY_MOST) { this.busy = null; cx.notify(); }
    if (this.writing && now - this.writing > BUSY_MOST * 1.5) { this.writing = null; cx.notify(); }
    if (!this.shows()) return;
    // A read that took long is not started again at once: in a big repository an agent at
    // work changes files all the time, and the reads would run back to back.
    if (now - this.last < this.cost * 4) return;
    if (this.stale || now - this.last > (this.on ? THERE_EVERY : HERE_EVERY)) this.refresh(cx);
    if (this.root && now - this.hubAt > (!this.hub?.repo ? HUB_AGAIN : this.hub.running ? HUB_RUNNING : HUB_EVERY)) this.readHub(cx);
    if (this.note && !this.note.error && now - this.note.at > NOTE_FOR) { this.note = null; cx.notify(); }
  }

  // Changes under the folder make the next tick read again. Only on this machine: another
  // one's folder can't be watched, and is read on a timer.
  watch(cx) {
    if (this.on || !this.root || this.watching === this.root) return;
    const root = this.root, dirs = [root];
    // A worktree keeps its refs in its repository's folder, which is somewhere else.
    if (this.common && !this.common.startsWith(`${root}/`)) dirs.push(this.common);
    // `turn` ends the loops of an earlier watch of the same folder: left alone, coming back
    // to a repository would add a loop every time.
    const turn = (this.turn = (this.turn ?? 0) + 1);
    this.watching = root;
    dirs.forEach((dir, i) => cx.spawn(async () => {
      try {
        while (this.turn === turn) {
          this.watches[i] = watchFolder(dir);
          await this.watches[i];
          if (this.turn === turn) this.stale = true;
        }
      } catch { if (this.turn === turn) this.watching = null; }
    }));
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const { cwd, on } = this.where(), context = this.key();
    if (context !== this.context) {
      this.reset();
      this.context = context;
      this.message = ""; this.input.set_value("");
    }
    if (!cwd) { this.error = "No folder"; return; }
    this.loading = true; this.stale = false; this.last = Date.now();
    cx.spawn(async (cx) => {
      try { await this.read(cwd, on, context); }
      catch (e) { if (this.key() === context) this.error = String(e?.message ?? e); }
      this.loading = false; this.cost = Date.now() - this.last;
      if (this.again) { this.again = false; this.stale = true; }
      cx.notify();
      if (this.key() === context) this.watch(cx);
    });
  }

  async read(cwd, on, context) {
    const folder = this.folder(), chosen = this.choice[folder];
    const at = await ops.probe(chosen ?? cwd, on);
    if (this.key() !== context) return;
    if (!at) {
      // The repository chosen is gone: back to the folder's own. Or the folder is in none:
      // the first one under it is shown, and the others are in the header's list.
      const under = chosen ? [] : (await ops.below(cwd, on, DEPTH)).filter((d) => !this.bad.has(d));
      if (this.key() !== context) return;
      // One that can't be read is not tried again: it would be chosen, fail, and be chosen.
      if (chosen) { this.bad.add(chosen); delete this.choice[folder]; } else if (under.length) this.choice[folder] = under[0];
      if (chosen || under.length) { this.remember("choice", JSON.stringify(this.choice)); this.stale = true; return; }
      const was = this.context; this.reset(); this.context = was; this.stale = false; this.last = Date.now(); this.error = "Not a git repository"; return;
    }
    this.survey(cwd, on, folder);
    const ask = (args) => exec("git", [...git.READ, ...args], { cwd: at.root, on });
    const [status, refs, stashes, remotes, unstaged, staged] = await Promise.all([
      ask(git.statusArgs), ask(git.refArgs), ask(git.stashArgs), ask(["remote"]),
      ask(["diff", "--numstat", "-z", "--no-renames"]), ask(["diff", "--cached", "--numstat", "-z", "--no-renames"]),
    ]);
    if (status.code !== 0) throw new Error(status.stderr.trim() || "git status failed");
    if (this.key() !== context) return;
    const st = git.parseStatus(status.stdout), dirty = st.staged.length + st.unstaged.length > 0;
    const stamp = `${git.hash(refs.stdout)}:${git.hash(stashes.stdout)}:${st.oid}:${st.branch}:${dirty}:${this.limit}`;
    let log = null;
    if (stamp !== this.stamp || at.root !== this.root) {
      log = await ask(git.logArgs(this.limit, Boolean(st.oid)));
      if (this.key() !== context) return;
    }
    this.root = at.root; this.on = on; this.common = at.common; this.state = at.state; this.error = null;
    this.status = st;
    this.stats = { unstaged: git.parseNumstat(unstaged.stdout), staged: git.parseNumstat(staged.stdout) };
    this.remoteNames = remotes.stdout.split("\n").filter(Boolean);
    if (log) {
      const r = git.parseRefs(refs.stdout, this.remoteNames);
      this.heads = r.heads; this.remotes = r.remotes; this.tags = r.tags.sort((a, b) => b.time - a.time);
      this.stashes = git.parseStashes(stashes.stdout);
      this.history(log.code === 0 ? git.parseLog(log.stdout) : [], dirty);
      this.stamp = stamp;
    }
    // What was selected may be gone: a commit rewritten, the last change committed.
    if (this.sel?.kind === "work" && !dirty) this.sel = null;
    if (this.sel?.kind === "commit" && !this.index.has(this.sel.sha)) this.sel = null;
    if (this.sel?.kind === "stash" && !this.stashes.some((s) => s.sha === this.sel.sha)) this.sel = null;
    if (!this.sel) this.sel = dirty ? { kind: "work" } : st.oid && this.index.has(st.oid) ? { kind: "commit", sha: st.oid } : null;
    if (this.sel?.kind === "commit") this.load(this.sel.sha);
  }

  // The repositories there are to choose from, for the folder the pane is in: the one it is
  // in, those that one is inside of, and those under it. Looked for once in a while, apart
  // from the reading of the one shown.
  survey(cwd, on, folder) {
    const had = this.surveys.get(folder);
    if (had && Date.now() - had.at < SURVEY_EVERY) return;
    const entry = had ?? { repos: [] };
    entry.at = Date.now();
    this.surveys.set(folder, entry);
    if (this.surveys.size > 30) this.surveys.delete(this.surveys.keys().next().value);
    this.spawn(async (cx) => {
      try {
        const here = (await ops.probe(cwd, on))?.root ?? null, base = here ?? cwd;
        const [outside, inside] = await Promise.all([here ? ops.around(here, on) : [], ops.below(base, on, DEPTH)]);
        entry.base = base;
        entry.repos = [...outside.map((root) => ({ root, kind: "around" })), ...(here ? [{ root: here, kind: "here" }] : []), ...inside.map((root) => ({ root, kind: "inside" }))];
      } catch { /* the list stays as it was */ }
      cx.notify();
    });
  }

  // Shows another of the folder's repositories (`to`: its top folder).
  choose(to) {
    const folder = this.folder(), survey = this.surveys.get(folder);
    // The folder's own is the default: choosing it is choosing nothing.
    if (survey?.repos.some((r) => r.kind === "here" && r.root === to)) delete this.choice[folder]; else this.choice[folder] = to;
    this.remember("choice", JSON.stringify(this.choice));
    this.stale = true;
  }

  // The rows of the graph, from the commits read. What is not committed yet is a row of its
  // own on top, hanging from HEAD.
  history(commits, dirty) {
    const head = this.status.oid;
    this.more = commits.length >= this.limit && this.limit < MOST;
    if (dirty && head) commits.unshift({ sha: WORK, parents: [head], loose: true, subject: "Uncommitted changes", time: 0, author: "" });
    const placed = lanes(commits);
    this.commits = commits; this.rows = placed.rows; this.width = Math.max(1, Math.min(placed.width, LANES));
    this.index = new Map(commits.map((c, i) => [c.sha, i]));
    // What points at each commit: a local branch and its remote one in the same place are one.
    const pills = new Map(), add = (sha, pill) => { if (!pills.has(sha)) pills.set(sha, []); pills.get(sha).push(pill); };
    const synced = new Set();
    for (const h of this.heads) {
      const same = h.upstream && this.remotes.some((r) => r.name === h.upstream && r.sha === h.sha);
      if (same) synced.add(h.upstream);
      add(h.sha, { kind: "head", name: h.name, current: h.name === this.status.branch, synced: Boolean(same) });
    }
    for (const r of this.remotes) if (!synced.has(r.name)) add(r.sha, { kind: "remote", name: r.name });
    for (const t of this.tags) add(t.sha, { kind: "tag", name: t.name });
    if (head && !this.status.branch) add(head, { kind: "head", name: "HEAD", current: true });
    for (const list of pills.values()) list.sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)));
    this.pills = pills;
  }

  // A commit's message and files (a stash is a commit too), read once.
  load(sha, stash) {
    if (this.details.has(sha)) return;
    const root = this.root, on = this.on, entry = { loading: true };
    this.details.set(sha, entry);
    if (this.details.size > 60) this.details.delete(this.details.keys().next().value);
    const ask = (args) => exec("git", [...git.READ, ...args], { cwd: root, on });
    this.spawn(async (cx) => {
      try {
        const parents = stash ? [`${sha}^1`] : this.commits[this.index.get(sha)]?.parents ?? [];
        let from = parents[0];
        if (!from) {
          // A first commit is compared with nothing: git's empty tree.
          this.empty ??= (await ask(["hash-object", "-t", "tree", "/dev/null"])).stdout.trim();
          from = this.empty;
        }
        const [body, names, stats] = await Promise.all([
          ask(["show", "-s", "--format=%B", sha]),
          ask(["diff", "--name-status", "-z", "--no-renames", from, sha]),
          ask(["diff", "--numstat", "-z", "--no-renames", from, sha]),
        ]);
        const counts = git.parseNumstat(stats.stdout);
        entry.files = git.parseNameStatus(names.stdout).map((f) => ({ ...f, ...(counts[f.path] ?? {}) }));
        entry.body = body.stdout.trim();
        if (stash) {
          // The files git didn't have yet are in a commit of their own, when there were any.
          const extra = await ask(["rev-parse", "-q", "--verify", `${sha}^3`]);
          if (extra.code === 0) {
            const list = await ask(["ls-tree", "-r", "-z", "--name-only", `${sha}^3`]);
            for (const path of list.stdout.split("\0").filter(Boolean)) entry.files.push({ path, mark: "U", untracked: true });
          }
        }
      } catch (e) { entry.error = String(e?.message ?? e); }
      entry.loading = false;
      cx.notify();
    });
  }

  // Starts a task from where there is no cx to start one with: the next draw does (every
  // caller asks for one).
  spawn(body) { this.tasks.push(body); }

  readHub(cx) {
    if (this.hubBusy || !this.root) return;
    const root = this.root, on = this.on;
    this.hubBusy = true; this.hubAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        const repo = this.hubRoot === root && this.hub?.repo ? this.hub.repo : await hub.repo(root, on);
        const data = repo ? await hub.read(root, on) : {};
        if (this.root === root) { this.hub = { repo, ...data }; this.hubRoot = root; cx.notify(); }
      } catch { /* no marks */ }
      this.hubBusy = false;
    });
  }

  // The open pull request of a branch. One from a fork (the person's own, when this
  // repository is a fork) counts only when it is of the commit the branch, or its upstream,
  // is at: a branch of the same name somewhere else is not this one.
  pullOf(h) {
    const upstream = h.upstream ? this.remotes.find((r) => r.name === h.upstream)?.sha : null;
    return (this.hub?.prs ?? []).find((p) => p.branch === h.name && (!p.cross || p.oid === h.sha || (upstream && p.oid === upstream))) ?? null;
  }

  // What every request and menu needs to know about the repository as it is shown.
  about() {
    return { root: this.root, on: this.on, branch: this.status.branch, head: this.status.oid, remotes: this.remoteNames, hub: this.hub?.repo?.url ?? null };
  }

  // Runs a request, from a button here or left by a menu or a dialog.
  ask(r, cx) {
    if (!this.root) return;
    const request = { root: this.root, on: this.on, ...r };
    cx.spawn(async (cx) => { await this.act(request, cx); cx.notify(); });
  }

  async act(r, cx) {
    if (r.op === "copy") { cx.write_to_clipboard(String(r.text ?? "")); this.say("Copied"); return; }
    if (r.op === "url") { if (/^https:\/\//.test(r.url ?? "")) cx.open_url(r.url); return; }
    if (r.op === "edit") { this.edit(r.path); return; }
    if (r.op === "show") { this.go(r.sha, true); return; }
    if (r.op === "repo") { this.choose(r.to); this.refresh(cx); return; }
    if (r.op === "writer") { this.writer = write.writer(r.id).id; this.remember("writer", this.writer); return; }
    if (this.busy) { this.note = { error: "Something is still running: try again in a moment", at: Date.now() }; return; }
    this.busy = r.op; this.busyAt = Date.now(); this.note = null;
    cx.notify();
    const done = await ops.perform(r);
    this.busy = null;
    if (done.error) this.note = { error: done.error, at: Date.now() };
    else {
      if (done.note) this.say(done.note);
      if (r.op === "commit") { this.message = ""; this.input.set_value(""); }
      // A new branch or tag is somewhere in the graph: show where.
      if ((r.op === "branch" || r.op === "tag") && this.index.has(r.at)) this.pick({ kind: "commit", sha: r.at }, true);
    }
    this.stale = true;
    this.refresh(cx);
    if (!done.error && (r.op === "push" || r.op === "tag-push")) this.hubAt = 0;
  }

  say(text) { this.note = { text, at: Date.now() }; }

  current() { return this.heads.find((h) => h.name === this.status.branch) ?? null; }

  pull(cx) {
    const h = this.current();
    if (h?.upstream && !h.gone) this.ask({ op: "pull", expect: { branch: h.name } }, cx);
  }

  // Where the current branch is pushed: its upstream, or `origin` (and it starts tracking it).
  pushTarget() {
    const h = this.current();
    if (!h) return null;
    if (h.upstream && !h.gone && h.remote && h.remoteBranch) return { remote: h.remote, remoteBranch: h.remoteBranch, track: false, label: h.upstream };
    if (h.upstream) return null;
    const remote = this.remoteNames.includes("origin") ? "origin" : this.remoteNames[0];
    return remote ? { remote, remoteBranch: h.name, track: true, label: `${remote}/${h.name}` } : null;
  }

  push(cx) {
    const h = this.current(), to = this.pushTarget();
    if (h && to) this.ask({ op: "push", branch: h.name, remote: to.remote, remoteBranch: to.remoteBranch, track: to.track, expect: { refs: [[`refs/heads/${h.name}`, h.sha]] } }, cx);
  }

  // Asks the chosen program for the commit message, and puts what it wrote in the field.
  generate(cx) {
    const st = this.status, root = this.root, on = this.on;
    if (this.writing || !root || !(st.staged.length + st.unstaged.length)) return;
    const who = write.writer(this.writer), context = this.context;
    this.writing = Date.now(); this.note = null;
    cx.spawn(async (cx) => {
      let done;
      try {
        const facts = await write.gather({
          root, on, staged: st.staged.length > 0, head: Boolean(st.oid),
          fresh: st.unstaged.filter((f) => f.mark === "U").map((f) => f.path),
          read: (path) => readTextFile(path, { on }),
        });
        done = facts.error ? facts : await write.write(who, write.prompt({ ...facts, branch: st.branch }));
      } catch (e) { done = { error: String(e?.message ?? e) }; }
      this.writing = null;
      // Another repository is shown by now: the message was not for it.
      if (this.context === context) {
        if (done.error) this.note = { error: done.error, at: Date.now() };
        else { this.message = done.message; this.input.set_value(done.message); }
      }
      cx.notify();
    });
  }

  commit(cx) {
    const message = this.message.trim(), st = this.status;
    if (!message || this.busy || !(st.staged.length + st.unstaged.length)) return;
    // With nothing staged, everything is committed: the common case needs no staging.
    this.ask({ op: "commit", message, all: st.staged.length === 0, expect: { branch: st.branch } }, cx);
  }

  // `reveal`: also scroll the graph to it. Not for a click on a row, which is on screen.
  pick(sel, reveal) {
    this.sel = sel;
    if (sel.kind === "commit") {
      this.load(sel.sha);
      const at = this.index.get(sel.sha);
      if (reveal && at !== undefined) this.scroll.scroll_to_item(at, "center");
    } else if (sel.kind === "stash") this.load(sel.sha, true);
  }

  // Selects the commit a branch or a tag leads to. `graph`: and goes to it in the graph. A
  // click in the Refs view stays there: a second click must find the same row (it switches).
  go(sha, graph) {
    if (!this.index.has(sha)) { this.note = { error: `That commit is not among the ${this.commits.length} read: load more in the graph`, at: Date.now() }; return; }
    if (graph) this.setView("graph");
    this.pick({ kind: "commit", sha }, true);
  }

  setView(view) {
    this.view = view;
    this.remember("view", view);
  }

  fold(name) {
    this.folded[name] = !this.folded[name];
    this.remember("folded", JSON.stringify(this.folded));
  }

  menu(m) {
    const all = { ...this.about(), ...m };
    if (this.root && any(all)) openOverlay({ mod: MOD, kind: "popup", width: 268, height: height(all), props: { menu: all } });
  }

  // The pane of `mod` in the focused tab takes what was left for it in shared state, or one
  // is split in beside the focused pane.
  pane(mod, ask) {
    const f = focused(), tab = f?.tab;
    if (!tab || !this.root) return;
    const here = panes().filter((p) => p.tab === tab), there = here.find((p) => p.mod === mod);
    const beside = here.find((p) => p.pane === f.pane) ?? here[0];
    if (!there && !beside) return;
    setShared(`${mod}.open`, { tab, on: this.on ?? null, at: Date.now(), ...ask });
    if (there) run("pane.focus", { pane: there.pane });
    else run("pane.split", { pane: beside.pane, direction: "right", mod, props: { tab } });
  }

  // Shows a file's diff: of what is not committed (`group`: "staged" or "unstaged"), of a
  // commit or of a stash.
  show(path, group) {
    const s = this.sel;
    if (!s) return;
    let source;
    if (s.kind === "work") source = { kind: "work" };
    else if (s.kind === "stash") {
      const stash = this.stashes.find((x) => x.sha === s.sha);
      source = { kind: "stash", sha: s.sha, title: stash?.subject ?? "Stash", sub: stash?.ref ?? "" };
    } else {
      const c = this.commits[this.index.get(s.sha)];
      if (!c) return;
      source = { kind: "commit", sha: c.sha, parent: c.parents[0] ?? null, title: c.subject, sub: `${short(c.sha)} · ${c.author} · ${git.when(c.time)}` };
    }
    this.pane(DIFF, { root: this.root, source, path, group: group ?? null });
  }

  edit(path) {
    this.pane(EDITOR, { path: `${this.root}/${path}` });
  }

  // ---- drawing

  color(t, n) {
    const palette = [t.ansi4, t.ansi5, t.ansi2, t.ansi3, t.ansi6, t.ansi1, t.ansi12, t.ansi13];
    return palette[n % palette.length];
  }

  // Whose commit a row is: the author's initials in a circle, in a color of the theme that is
  // always the same for a name. So one author among others stands out without being read.
  author(name, t) {
    const palette = [t.ansi4, t.ansi2, t.ansi5, t.ansi3, t.ansi6, t.ansi1, t.ansi12, t.ansi10, t.ansi13, t.ansi11, t.ansi14, t.ansi9];
    const color = palette[Math.abs(git.hash(name)) % palette.length];
    return div().flex_none().w(AVATAR).h(AVATAR).rounded(AVATAR / 2).bg(color + "30").flex().items_center().justify_center()
      .text_size(8.5).font_semibold().text_color(color).child(git.initials(name));
  }

  // One line of the graph, as a shape. The same few shapes make every row, so each is made
  // once and kept: making them again on every draw fills the memory all mods share.
  path(x1, y1, x2, y2, loose) {
    const id = `${x1},${y1},${x2},${y2},${loose}`;
    let p = this.paths.get(id);
    if (!p) {
      const b = PathBuilder.stroke(1.5).move_to(x1, y1);
      if (x1 === x2) b.line_to(x2, y2);
      // Into a commit from above, the line leaves straight down and arrives level; out of
      // one to below, it leaves level and arrives straight down.
      else if (y1 === 0) b.cubic_bezier_to(x2, y2, x1, y2 * 0.7, x1, y2);
      else b.cubic_bezier_to(x2, y2, x2, y1, x2, y1 + (y2 - y1) * 0.3);
      if (loose) b.dash_array([2, 2]);
      p = b.build();
      if (this.paths.size > 4000) this.paths.clear();
      this.paths.set(id, p);
    }
    return p;
  }

  cell(row, commit, t, head) {
    const x = (lane) => PAD + Math.min(lane, LANES - 1) * LANE, ys = [0, ROW / 2, ROW];
    const color = this.color(t, row.color), cx = x(row.lane);
    const el = div().relative().w(PAD * 2 + (this.width - 1) * LANE).h(ROW).flex_none();
    for (const [a, ay, b, by, c, loose] of row.lines) {
      el.child(window.paint_path(this.path(x(a), ys[ay], x(b), ys[by], loose ? 1 : 0), this.color(t, c)).absolute().top(0).left(0).size_full());
    }
    const work = commit.sha === WORK, merge = commit.parents.length > 1;
    // HEAD is a ring; what is not committed, and a merge, are hollow; the rest are dots.
    if (head) el.child(div().absolute().left(cx - 5).top(ROW / 2 - 5).w(10).h(10).rounded(5).bg(t.background).border(2).border_color(color));
    else if (work || merge) el.child(div().absolute().left(cx - 4).top(ROW / 2 - 4).w(8).h(8).rounded(4).bg(t.background).border(1.5).border_color(color));
    else el.child(div().absolute().left(cx - 3.5).top(ROW / 2 - 3.5).w(7).h(7).rounded(3.5).bg(color));
    return el;
  }

  pill(p, t, color) {
    const el = h_flex().flex_shrink(1).min_w(28).max_w(104).h(17).px(5).gap(3).items_center().rounded(4).text_size(10.5);
    if (p.kind === "tag") el.border_1().border_color(t.border).text_color(t.muted);
    else if (p.current) el.bg(color).text_color(t.background).font_semibold();
    else if (p.kind === "head") el.border_1().border_color(color).text_color(t.foreground);
    else el.border_1().border_color(t.border).text_color(t.muted);
    if (p.kind === "tag") el.child(svg(ICON("tag")).size(9).flex_none());
    el.child(div().min_w(0).truncate().child(p.name));
    if (p.synced) el.child(svg(ICON("remote")).size(9).flex_none().opacity(0.75));
    return el;
  }

  graphRow(i, t) {
    const c = this.commits[i], row = this.rows[i], work = c.sha === WORK;
    const selected = work ? this.sel?.kind === "work" : this.sel?.kind === "commit" && this.sel.sha === c.sha;
    const pills = this.pills.get(c.sha) ?? [], runState = this.hub?.runs?.[c.sha]?.state;
    const el = h_flex().w_full().h(ROW).flex_none().pr(10).gap(6).items_center().when(selected, (e) => e.bg(t.selected))
      .child(this.cell(row, c, t, c.sha === this.status.oid));
    // At most half the row is names: the subject keeps the rest.
    if (pills.length) el.child(h_flex().flex_none().max_w("52%").gap(4).items_center().overflow_hidden()
      .children(pills.slice(0, 2).map((p) => this.pill(p, t, this.color(t, row.color))))
      .when(pills.length > 2, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`+${pills.length - 2}`))));
    if (work) {
      const n = this.status.staged.length + this.status.unstaged.length;
      el.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`Uncommitted changes (${n})`));
    } else {
      el.child(div().flex_1().min_w(0).truncate().text_color(c.parents.length > 1 ? t.muted : t.foreground).child(c.subject));
      if (runState) el.child(div().flex_none().w(6).h(6).rounded(3).bg(checkColor(t, runState)));
      // The author, then the date in a column of its own width: the circles line up down
      // the list, whatever the dates are.
      el.child(this.author(c.author, t));
      el.child(div().flex_none().min_w(AGO).flex().justify_end().text_size(10.5).text_color(t.dim).child(git.ago(c.time)));
    }
    return el;
  }

  graph(t) {
    const n = this.commits.length;
    if (!n) return div().flex_1().min_h(0).p(14).text_color(t.dim).child(this.error ?? (this.loading ? "Reading the repository…" : "No commits yet"));
    return v_flex().flex_1().min_h(0)
      .child(div().flex_1().min_h(0).relative()
        .child(v_virtual_list("git-graph", n, ROW, (i) => this.commits[i].sha, (range) => {
          const out = [];
          for (let i = range.start; i < range.end; i++) out.push(this.graphRow(i, t));
          return out;
        }).track_scroll(this.scroll).size_full()
          .on_item_click((sha, cx) => { this.pick(sha === WORK ? { kind: "work" } : { kind: "commit", sha }); cx.notify(); })
          .on_item_secondary_click((sha) => {
            if (sha === WORK) return this.menu({ kind: "work", staged: this.status.staged.length, unstaged: this.status.unstaged.length });
            const c = this.commits[this.index.get(sha)];
            if (c) this.menu({ kind: "commit", sha, subject: c.subject, run: this.hub?.runs?.[sha] ?? null });
          }))
        .child(Scrollbar.vertical("git-graph").viewport_from_layout().absolute().inset_0()))
      .when(this.more, (el) => el.child(h_flex().id("git-more").flex_none().h(26).px(12).items_center().border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.limit = Math.min(MOST, this.limit + PAGE); this.stale = true; this.refresh(cx); cx.notify(); })
        .child(`${n} commits shown · Load more`)));
  }

  // A small button with an icon: `o.label` beside it, `o.spin` while it runs.
  button(t, id, icon, tip, act, o = {}) {
    const off = Boolean(o.off || this.busy);
    return h_flex().id(id).flex_none().h(24).px(o.label ? 6 : 5).gap(3).items_center().rounded(6).text_size(11).text_color(off ? t.dim : t.muted).tooltip(tip)
      .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
      // A button in a row: the click is not the row's too.
      .on_click((_e, cx) => { cx.stop_propagation(); if (!off) act(cx); cx.notify(); })
      .child(o.spin ? svg(CHROME("spinner")).size(13).flex_none().spin(900) : svg(icon).size(13).flex_none())
      .when(Boolean(o.label), (e) => e.child(div().child(o.label)));
  }

  head(t) {
    const st = this.status, h = this.current(), to = this.pushTarget();
    const name = this.root ? base(this.root) : "";
    const survey = this.surveys.get(this.folder()), repos = survey?.repos ?? [], many = Boolean(this.root) && repos.length > 1;
    const branch = st.branch ?? (st.oid ? `detached at ${short(st.oid)}` : this.root ? "no commits yet" : "");
    const tab = (view, label) => div().id(`git-view-${view}`).px(9).h(22).flex().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .when(this.view === view, (e) => e.bg(t.selected).text_color(t.foreground)).when(this.view !== view, (e) => e.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { this.setView(view); cx.notify(); }).child(label);
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().id("git-head").h(42).px(14).gap(6).items_center()
        .on_mouse_down("right", () => this.menu({ kind: "repo", name }))
        .child(div().font_semibold().child("Git"))
        .child(many
          ? h_flex().id("git-repo").flex_shrink(1).min_w(0).h(24).px(6).gap(3).items_center().rounded(6).text_size(11.5).text_color(t.muted).cursor_pointer().tooltip(`${repos.length} repositories here: choose which one to show`)
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => this.menu({ kind: "repos", repos, base: survey.base }))
            .child(div().min_w(0).truncate().child(name)).child(svg(CHROME("chevron-down")).size(11).flex_none())
          : div().flex_shrink(1).min_w(0).truncate().text_size(11.5).text_color(t.dim).child(name))
        .child(div().flex_1())
        .when(Boolean(this.root), (e) => e
          .child(this.button(t, "git-fetch", ICON("fetch"), "Fetch every remote", (cx) => this.ask({ op: "fetch" }, cx), { spin: this.busy === "fetch" }))
          .child(this.button(t, "git-pull", ICON("down"), h?.upstream ? `Pull from ${h.upstream} (fast-forward only)` : "No upstream branch to pull from", (cx) => this.pull(cx),
            { off: !h?.upstream || h.gone, label: st.behind ? String(st.behind) : null, spin: this.busy === "pull" }))
          .child(this.button(t, "git-push", ICON("up"), to ? `Push to ${to.label}` : "No remote to push to", (cx) => this.push(cx),
            { off: !to, label: st.ahead ? String(st.ahead) : null, spin: this.busy === "push" }))))
      .when(Boolean(this.root), (e) => e.child(h_flex().h(32).px(12).pb(6).gap(8).items_center()
        .child(h_flex().flex_1().min_w(0).gap(5).items_center().text_size(12).text_color(t.muted)
          .child(svg(CHROME("git-branch")).size(12).flex_none())
          .child(div().min_w(0).truncate().text_color(t.foreground).child(branch))
          .when(Boolean(h?.gone), (x) => x.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child("upstream gone"))))
        .child(h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.raised).child(tab("graph", "Graph")).child(tab("refs", "Refs")))))
      .when(Boolean(this.state), (e) => e.child(div().px(14).py(5).text_size(11.5).bg(t.blocked + "22").text_color(t.foreground).child(`${this.state} in progress: finish or abort it in a terminal. Actions wait until then.`)))
      .when(Boolean(this.note), (e) => e.child(h_flex().id("git-note").px(14).py(5).gap(8).items_start().text_size(11.5)
        .text_color(this.note?.error ? t.ansi1 : t.muted)
        .child(div().flex_1().min_w(0).child(this.note?.error ?? this.note?.text ?? ""))
        .when(Boolean(this.note?.error), (x) => x.child(div().id("git-note-x").flex_none().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.note = null; cx.notify(); }).child("✕")))));
  }

  // A foldable heading of the Refs view.
  section(t, name, label, count) {
    const open = !this.folded[name];
    return h_flex().id(`git-sec-${name}`).h(26).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(11).text_color(t.dim).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.fold(name); cx.notify(); })
      .child(svg(CHROME(open ? "chevron-down" : "chevron-right")).size(11).flex_none())
      .child(div().child(label.toUpperCase()))
      .child(div().child(String(count)));
  }

  // One line of the Refs view: an icon, a name, and what is said after it.
  line(t, id, o) {
    return h_flex().id(id).h(26).px(8).pl(o.indent ? 24 : 8).gap(7).items_center().rounded(6).cursor_pointer()
      .when(Boolean(o.selected), (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((e, cx) => { (e.click_count > 1 && o.twice ? o.twice : o.click)?.(cx); cx.notify(); })
      .on_mouse_down("right", () => o.menu?.())
      .child(svg(o.icon).size(12).flex_none().text_color(o.tint ?? t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(o.strong ? t.foreground : t.muted).when(Boolean(o.strong), (e) => e.font_medium()).child(o.name))
      .children(o.after ?? []);
  }

  // A pull request's number, with the state of its checks.
  pr(t, pr) {
    return h_flex().flex_none().gap(3).items_center().text_size(10.5).text_color(pr.draft ? t.dim : t.muted)
      .child(div().child(`#${pr.number}`))
      .when(Boolean(pr.checks), (e) => e.child(div().w(6).h(6).rounded(3).bg(checkColor(t, pr.checks))));
  }

  refs(t) {
    const small = (text, color) => div().flex_none().text_size(10.5).text_color(color ?? t.dim).child(text);
    const out = [];
    const selected = (sha) => this.sel?.kind === "commit" && this.sel.sha === sha;
    out.push(this.section(t, "heads", "Branches", this.heads.length));
    if (!this.folded.heads) for (const h of this.heads) {
      const current = h.name === this.status.branch, pr = this.pullOf(h);
      const after = [];
      if (pr) after.push(this.pr(t, pr));
      if (h.gone) after.push(small("gone", t.ansi1));
      if (h.ahead) after.push(small(`↑${h.ahead}`, t.muted));
      if (h.behind) after.push(small(`↓${h.behind}`, t.muted));
      after.push(small(git.ago(h.time)));
      out.push(this.line(t, `git-h-${h.name}`, {
        icon: CHROME(current ? "check" : "git-branch"), tint: current ? t.accent : null, name: h.name, strong: current, selected: selected(h.sha), after,
        click: () => this.go(h.sha),
        twice: current ? null : (cx) => this.ask({ op: "switch", branch: h.name, expect: { refs: [[`refs/heads/${h.name}`, h.sha]] } }, cx),
        menu: () => this.menu({ kind: "branch", ...h, pr: pr ?? null }),
      }));
    }
    for (const remote of this.remoteNames) {
      const list = this.remotes.filter((r) => r.remote === remote), name = `remote:${remote}`;
      out.push(this.section(t, name, remote, list.length));
      if (!this.folded[name]) for (const r of list) out.push(this.line(t, `git-r-${r.name}`, {
        icon: ICON("remote"), name: r.branch, selected: selected(r.sha), after: [small(git.ago(r.time))],
        click: () => this.go(r.sha),
        menu: () => this.menu({ kind: "remote", name: r.name, sha: r.sha, remote: r.remote, short: r.branch, local: this.heads.some((h) => h.name === r.branch) }),
      }));
    }
    out.push(this.section(t, "tags", "Tags", this.tags.length));
    if (!this.folded.tags) {
      const shown = this.allTags ? this.tags : this.tags.slice(0, 50);
      for (const tag of shown) {
        const release = this.hub?.releases?.[tag.name];
        const after = [];
        if (release) after.push(small(release.draft ? "draft" : release.pre ? "pre-release" : release.latest ? "latest release" : "release", release.latest ? t.ansi2 : t.muted));
        after.push(small(git.ago(tag.time)));
        out.push(this.line(t, `git-t-${tag.name}`, {
          icon: ICON("tag"), name: tag.name, selected: selected(tag.sha), after,
          click: () => this.go(tag.sha),
          menu: () => this.menu({ kind: "tag", name: tag.name, sha: tag.sha, release: release ?? null }),
        }));
      }
      if (shown.length < this.tags.length) out.push(div().id("git-all-tags").h(24).px(27).flex().items_center().text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.allTags = true; cx.notify(); }).child(`Show all ${this.tags.length}`));
    }
    out.push(this.section(t, "stashes", "Stashes", this.stashes.length));
    if (!this.folded.stashes) for (const s of this.stashes) out.push(this.line(t, `git-s-${s.sha}`, {
      icon: ICON("stash"), name: s.subject || s.ref, selected: this.sel?.kind === "stash" && this.sel.sha === s.sha, after: [small(git.ago(s.time))],
      click: () => this.pick({ kind: "stash", sha: s.sha }),
      menu: () => this.menu({ kind: "stash", ref: s.ref, sha: s.sha, subject: s.subject }),
    }));
    return div().flex_1().min_h(0).relative()
      .child(v_flex().id("git-refs").absolute().inset_0().overflow_y_scroll().p(6).children(out))
      .child(Scrollbar.vertical("git-refs").absolute().inset_0());
  }

  // One file of a list in the detail: its mark, its name, its folder, and how much changed.
  // `o.act` is a button shown while the pointer is on the row.
  file(t, id, f, o) {
    const hot = this.hot === id, dir = parent(f.path);
    return h_flex().id(id).h(25).flex_none().px(8).gap(7).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { o.click(); cx.notify(); })
      .on_mouse_down("right", () => o.menu?.())
      .on_hover((hovered, cx) => { if (hovered) this.hot = id; else if (this.hot === id) this.hot = null; cx.notify(); })
      .child(div().w(10).flex_none().text_size(11).text_color(markColor(t, f.mark)).child(f.mark))
      .child(div().flex_none().max_w(190).truncate().child(base(f.path)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir))
      .when(hot && Boolean(o.act), (e) => e.child(this.button(t, `${id}-act`, o.act.icon, o.act.tip, o.act.run)))
      .when(!(hot && o.act) && f.add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(!(hot && o.act) && f.del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  heading(t, label, after) {
    return h_flex().h(24).flex_none().px(8).gap(6).items_center().text_size(11).text_color(t.dim).child(div().flex_1().child(label.toUpperCase())).children(after ?? []);
  }

  work(t) {
    const st = this.status, here = { branch: st.branch };
    const total = st.staged.length + st.unstaged.length;
    const enabled = Boolean(this.message.trim() && total && !this.busy && !this.state);
    const who = write.writer(this.writer);
    const rows = [];
    const list = (group, files) => files.slice(0, FILES).map((f, i) => this.file(t, `git-w-${group}-${i}`, { ...f, ...(this.stats[group][f.path] ?? {}) }, {
      click: () => this.show(f.path, group),
      menu: () => this.menu({ kind: "file", path: f.path, mark: f.mark, staged: group === "staged", work: true, both: st.staged.some((x) => x.path === f.path) && st.unstaged.some((x) => x.path === f.path) }),
      act: f.mark === "!" ? null : group === "staged"
        ? { icon: CHROME("minus"), tip: "Unstage", run: (cx) => this.ask({ op: "unstage", paths: [f.path], expect: here }, cx) }
        : { icon: CHROME("plus"), tip: "Stage", run: (cx) => this.ask({ op: "stage", paths: [f.path], expect: here }, cx) },
    }));
    const more = (files) => (files.length > FILES ? [div().px(8).h(22).text_size(11).text_color(t.dim).child(`and ${files.length - FILES} more`)] : []);
    if (st.staged.length) {
      rows.push(this.heading(t, `Staged · ${st.staged.length}`, [this.button(t, "git-unstage-all", CHROME("minus"), "Unstage all", (cx) => this.ask({ op: "unstage", expect: here }, cx))]));
      rows.push(...list("staged", st.staged), ...more(st.staged));
    }
    if (st.unstaged.length) {
      rows.push(this.heading(t, `${st.staged.length ? "Not staged" : "Changes"} · ${st.unstaged.length}`, [
        this.button(t, "git-stash-all", ICON("stash"), "Stash all", (cx) => this.ask({ op: "stash", expect: here }, cx)),
        this.button(t, "git-stage-all", CHROME("plus"), "Stage all", (cx) => this.ask({ op: "stage", expect: here }, cx)),
      ]));
      rows.push(...list("unstaged", st.unstaged), ...more(st.unstaged));
    }
    return v_flex().size_full().min_h(0)
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("git-work").absolute().inset_0().overflow_y_scroll().p(6).children(rows))
        .child(Scrollbar.vertical("git-work").absolute().inset_0()))
      .child(h_flex().flex_none().p(10).gap(8).items_end().border_t(1).border_color(t.border)
        // The message, and at its right the button that has it written.
        .child(h_flex().id("git-message").flex_1().min_w(0).min_h(32).pl(10).pr(3).py(3).gap(4).items_start().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          // Cmd+Enter, should the field pass it on instead of saying "submit".
          .on_key_down((e, cx) => { if (e.key === "enter" && e.modifiers?.platform) { this.commit(cx); cx.stop_propagation(); cx.notify(); } })
          .child(div().flex_1().min_w(0).py(3).child(Textarea.new(this.input).w_full().text_size(12).text_color(t.foreground)))
          .child(h_flex().id("git-write").flex_none().size(24).items_center().justify_center().rounded(6).text_color(this.writing ? t.accent : total ? t.muted : t.dim)
            .tooltip(this.writing ? `${who.label} is writing…` : `Write the message with ${who.label}. Right-click to choose who writes`)
            .when(Boolean(total) && !this.writing, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
            .on_click((_e, cx) => { cx.stop_propagation(); this.generate(cx); cx.notify(); })
            .on_mouse_down("right", () => this.menu({ kind: "writer", writers: write.WRITERS.map((w) => ({ id: w.id, label: w.label })), writer: who.id }))
            .child(this.writing ? svg(CHROME("spinner")).size(13).spin(900) : svg(ICON("write")).size(13))))
        .child(div().id("git-commit").h(32).px(12).flex().flex_none().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12)
          .tooltip("Commit (Cmd+Enter in the message)")
          .when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => { this.commit(cx); cx.notify(); })
          .child(this.busy === "commit" ? "Committing…" : st.staged.length ? "Commit" : "Commit all")));
  }

  // The files of a commit or a stash, under what is said about it.
  changed(t, sha, top) {
    const d = this.details.get(sha);
    const files = d?.files ?? [];
    const rows = files.slice(0, FILES).map((f, i) => this.file(t, `git-c-${i}`, f, {
      click: () => this.show(f.path, f.untracked ? "untracked" : null),
      menu: () => this.menu({ kind: "file", path: f.path, mark: f.mark, staged: false, work: false }),
    }));
    if (files.length > FILES) rows.push(div().px(8).h(22).text_size(11).text_color(t.dim).child(`and ${files.length - FILES} more`));
    const add = files.reduce((n, f) => n + (f.add || 0), 0), del = files.reduce((n, f) => n + (f.del || 0), 0);
    return div().size_full().relative()
      .child(v_flex().id("git-changed").absolute().inset_0().overflow_y_scroll().p(6)
        .child(top(d))
        .child(this.heading(t, d?.loading || !d ? "Reading…" : d.error ? "Could not be read" : `${files.length} file${files.length === 1 ? "" : "s"}`,
          [div().text_color(t.ansi2).child(add ? `+${add}` : ""), div().text_color(t.ansi1).child(del ? `−${del}` : "")]))
        .children(rows))
      .child(Scrollbar.vertical("git-changed").absolute().inset_0());
  }

  detail(t) {
    const s = this.sel;
    if (!s) return div().p(14).text_size(12).text_color(t.dim).child(this.root ? "Select a commit to see what it changed" : "");
    if (s.kind === "work") return this.work(t);
    if (s.kind === "stash") {
      const stash = this.stashes.find((x) => x.sha === s.sha);
      if (!stash) return div();
      const same = { refs: [[stash.ref, stash.sha]] };
      return this.changed(t, s.sha, () => v_flex().px(8).pt(4).pb(6).gap(6)
        .child(div().text_color(t.foreground).child(stash.subject || stash.ref))
        .child(h_flex().gap(4).items_center().text_size(11).text_color(t.dim)
          .child(div().flex_1().child(`${stash.ref} · ${git.when(stash.time)}`))
          .child(this.button(t, "git-stash-apply", ICON("down"), "Apply, and keep the stash", (cx) => this.ask({ op: "stash-apply", ref: stash.ref, expect: same }, cx), { label: "Apply" }))
          .child(this.button(t, "git-stash-pop", ICON("down"), "Apply, and drop the stash", (cx) => this.ask({ op: "stash-pop", ref: stash.ref, expect: same }, cx), { label: "Pop" }))));
    }
    const c = this.commits[this.index.get(s.sha)];
    if (!c) return div();
    const runInfo = this.hub?.runs?.[c.sha];
    return this.changed(t, c.sha, (d) => {
      const body = (d?.body ?? c.subject).split("\n"), rest = unwrap(body.slice(1).join("\n").trim());
      return v_flex().px(8).pt(4).pb(6).gap(5)
        .child(div().text_color(t.foreground).font_medium().child(body[0] || c.subject))
        .when(Boolean(rest), (e) => e.child(div().text_size(12).text_color(t.muted).child(rest.length > 1200 ? `${rest.slice(0, 1200)}…` : rest)))
        .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
          .child(div().flex_1().min_w(0).truncate().child(`${c.author} · ${git.when(c.time)}`))
          .when(Boolean(runInfo), (e) => e.child(h_flex().id("git-run").flex_none().gap(4).items_center().cursor_pointer().hover((x) => x.text_color(t.foreground)).tooltip(`${runInfo?.name}: open the workflow run`)
            .on_click((_e, cx) => this.ask({ op: "url", url: runInfo.url }, cx))
            .child(div().w(6).h(6).rounded(3).bg(checkColor(t, runInfo?.state)))
            .child(div().child(runInfo?.state === "fail" ? "failed" : runInfo?.state === "running" ? "running" : "passed"))))
          .child(h_flex().id("git-sha").flex_none().gap(3).items_center().cursor_pointer().hover((x) => x.text_color(t.foreground)).tooltip("Copy the commit ID")
            .on_click((_e, cx) => this.ask({ op: "copy", text: c.sha }, cx))
            .child(div().font_family(settings().font_family ?? "JetBrains Mono").child(short(c.sha)))
            .child(svg(ICON("copy")).size(10))));
    });
  }

  render(cx) {
    if (this.other) return this.other.render(cx);
    for (const [name, value] of Object.entries(this.pending)) localStorage.setItem(name, value);
    this.pending = {};
    const shown = this.shows();
    if (shown && this.key() !== this.context) this.after(cx, async (cx) => { if (this.key() !== this.context) this.refresh(cx); });
    // A menu or a dialog left something to do. Taken in a task: only one copy gets it.
    if (ops.waiting()) this.after(cx, async (cx) => {
      const r = ops.take((r) => r.root === this.root && (r.on ?? null) === (this.on ?? null));
      if (r) { await this.act(r, cx); cx.notify(); }
    });
    const t = theme();
    // The size comes in the window's pixels: at a zoom, more of them than the panel's own.
    const tall = (this.size?.height ?? 700) / (Number(settings()?.zoom) || 1);
    const el = v_flex().id("git-panel").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(this.head(t));
    if (!this.root) el.child(div().p(14).text_color(t.dim).child(this.error ?? (this.loading ? "Reading the repository…" : "No folder")));
    else el
      .child(this.view === "refs" ? this.refs(t) : this.graph(t))
      .child(div().flex_none().h(Math.round(Math.max(170, Math.min(460, tall * 0.42)))).border_t(1).border_color(t.border).child(this.detail(t)));
    const tasks = this.tasks;
    this.tasks = [];
    for (const body of tasks) this.after(cx, body);
    return el;
  }
}
