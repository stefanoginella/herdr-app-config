// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.
//
// Modified from Herdr's `spaces` mod (version 0.1.16, Apache-2.0): see NOTICE at the repository root.
// A clone of Herdr's `spaces` with folders: one level of named, foldable groups of spaces
// (model.js). Drag a space onto a folder or out of it, drag a folder to reorder it, or use the
// right-click menus (menu.js) and the naming dialog (naming.js): this mod opens itself for both.
// The real space order follows the sidebar, so space.next and space.select:N do too.
// Keys can run `space-folders.new-folder`, `space-folders.fold-all` and `space-folders.unfold-all`.
// A space's menu also opens its project (the repo's top folder, else where it is) in VS Code,
// and in Obsidian when that is in one of its vaults (open.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, props, home, nextCommand, notify } from "herdr";
import * as model from "./model.js";
import * as opening from "./open.js";
import Menu, { naming } from "./menu.js";
import Naming from "./naming.js";

const MOD = "space-folders";
// A space's id says its machine: "<machine>/<id>" away, bare here.
const machineOf = (id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null);
// A closed space leaves the folders once its machine's layout has been readable this long:
// while a layout loads, its spaces aren't gone, only not listed yet.
const QUIET = 5000;
// Indent of a folder's rows, and the top of a folder's header that means "before it" to a dragged space.
const INDENT = 14;
const BEFORE_ZONE = 8;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// A repo's name from its git folder: the folder holding .git, a bare repo's own
// name, or the folder holding a hidden bare repo (<project>/.bare).
const repoName = (common) => {
  if (common.endsWith("/.git")) return base(common.slice(0, -5));
  const own = base(common);
  return own === ".bare" ? base(common.slice(0, -own.length - 1)) : own.replace(/\.git$/, "");
};

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // Opened by itself as a popup or a dialog: the menu, the naming prompt.
    const p = props();
    const Other = p?.menu ? Menu : p?.naming ? Naming : null;
    if (Other) {
      this.other = new Other();
      this.other.init(cx);
      return;
    }
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, top, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.drag = null; // what's pressed: { kind: "space" | "folder", id, fixed?, kids? }
    this.over = null; // where it would land: { on: "space" | "folder" | "end", id?, folder?, pos? }
    this.keys = {}; // space -> what its place is remembered by (projectKey)
    this.lastKey = {}; // space -> its key the last time its git was known
    this.readySince = {}; // machine -> since when its layout has been readable
    this.unplaced = false; // a space is waiting for its git before it's put in the folders
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand());
        cx.notify();
      }
    });
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    this.vaults = []; // Obsidian's vaults: a project in one can be opened there
    this.refreshVaults(cx);
    cx.timer.every(60000, cx => this.refreshVaults(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now) || this.unplaced) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshVaults(cx) {
    cx.spawn(async () => { this.vaults = await opening.vaults(); });
  }

  // What a space's menu can open in an editor: { folder, vault } (its repo's top folder, else
  // where it is; the Obsidian vault that is in), or null for a space on another machine.
  project(w, g) {
    const folder = g?.top ?? place(w, panes());
    return folder && opening.possible(w.machine) ? { folder, vault: opening.vaultOf(this.vaults, folder) } : null;
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repoName(repo);
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), top, linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  // The menus are this mod again, as a popup (menu.js). A popup is as tall as its items; height is only the most.
  menu(kind, target = {}) {
    openOverlay({ mod: MOD, kind: "popup", width: 236, height: 560, props: { menu: kind, target, keys: this.keys } });
  }

  // Key commands, e.g. "cmd-shift-n": "space-folders.new-folder" in keys.json.
  command(name) {
    if (name === "new-folder") naming({ title: "New folder" });
    else if (name === "fold-all" || name === "unfold-all") this.change((m) => model.folders(m).forEach((f) => model.setFolded(m, f.id, name === "fold-all")));
  }

  change(fn) {
    const m = model.load();
    fn(m);
    model.save(m);
  }

  // What a space's place in the folders is remembered by: its repo, else its folder; nothing at home.
  projectKey(w, ps) {
    const k = where(w, ps);
    const g = this.git[k];
    if (g) return `repo:${g.repo}`;
    const dir = (place(w, ps) ?? "").replace(/\/+$/, "");
    if (!dir || (!w.named && w.name === "~") || (!w.machine && dir === home().replace(/\/+$/, ""))) return null;
    return `dir:${k}`;
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // The sidebar top to bottom, from the folders' model: [{ r, kids }] for a space and the worktree
  // spaces under it, [{ f, members }] for a folder. Brings the model up to date with the spaces there
  // are, and the real space order in line with it.
  arrange() {
    const sp = spaces(), ps = panes(), now = Date.now();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || now - (this.born[w.id] ??= now) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const byId = new Map(list.map((r) => [r.w.id, r]));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => Boolean(r.g?.linked && mains.has(r.g.repo));
    const keys = {};
    for (const r of list) keys[r.w.id] = this.projectKey(r.w, ps);
    this.keys = keys;

    const m = model.load();
    // New spaces, once their git is known (or isn't coming): next to their repo's space, else where
    // their project was filed, else last.
    this.unplaced = false;
    for (const r of list) {
      if (model.has(m, r.w.id)) continue;
      if (!(where(r.w, ps) in this.git) && now - (this.born[r.w.id] ??= now) <= 1500) {
        this.unplaced = true;
        continue;
      }
      const main = nested(r) ? list.find((o) => o.g && !o.g.linked && o.g.repo === r.g.repo && model.has(m, o.w.id)) : null;
      if (main) model.moveSpace(m, r.w.id, { folder: model.folderOf(m, main.w.id)?.id ?? null, after: main.w.id });
      else model.admit(m, r.w.id, keys[r.w.id], now);
    }
    // A loose space that went into a filed project (a cd) joins that project's folder. Only a change
    // seen while this runs counts: after a restart, spaces stay where they were left.
    const last = {};
    for (const r of list) {
      const id = r.w.id, known = where(r.w, ps) in this.git, before = this.lastKey[id];
      last[id] = known ? keys[id] : before;
      if (!known || before === undefined || !keys[id] || keys[id] === before) continue;
      const f = model.folder(m, m.projects[keys[id]]);
      if (f && m.root.includes(id) && !nested(r)) model.moveSpace(m, id, { folder: f.id });
    }
    this.lastKey = last;
    // A filed space keeps its project remembered there, also when what names the project changes
    // (its folder becomes a repo).
    for (const f of model.folders(m)) for (const id of f.spaces) {
      const r = byId.get(id);
      if (r && keys[id] && where(r.w, ps) in this.git) m.projects[keys[id]] ??= f.id;
    }
    // Closed spaces leave, once it's sure they're closed and not just unlisted while a layout loads.
    for (const k of machines()) {
      if (k.layout === "ready") this.readySince[k.name ?? ""] ??= now;
      else delete this.readySince[k.name ?? ""];
    }
    const live = new Set(sp.map((w) => w.id));
    const listed = new Set(sp.map((w) => w.machine ?? ""));
    model.prune(m, (id) => {
      const on = machineOf(id) ?? "";
      return !live.has(id) && listed.has(on) && now - (this.readySince[on] ?? Infinity) > QUIET;
    });
    model.save(m);

    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    const node = (id) => {
      const r = byId.get(id);
      if (!r || nested(r)) return null;
      let kids = [];
      if (r.g && !r.g.linked && !placed.has(r.g.repo)) {
        placed.add(r.g.repo);
        kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      }
      return { r, kids };
    };
    const top = [];
    for (const e of m.root) {
      if (typeof e === "string") {
        const n = node(e);
        if (n) top.push(n);
      } else top.push({ f: e, members: e.spaces.map(node).filter(Boolean) });
    }
    // Still waiting for their git: last meanwhile.
    for (const r of list) {
      const n = model.has(m, r.w.id) ? null : node(r.w.id);
      if (n) top.push(n);
    }

    // The real order: the sidebar's, within each machine's block. Simulate the batch so later
    // indexes include earlier moves. An attempted write can lose a sync conflict: allow the echo
    // to settle before retrying.
    const flat = [];
    for (const e of top) for (const n of e.f ? e.members : [e]) flat.push(n.r, ...n.kids);
    const emitted = new Set(flat.map((r) => r.w.id));
    for (const r of list) if (!emitted.has(r.w.id)) flat.push(r);
    const order = sp.map(w => w.id);
    const target = [...new Set(sp.map((w) => w.machine ?? null))]
      .flatMap((on) => flat.filter((r) => (r.w.machine ?? null) === on).map((r) => r.w.id));
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < target.length; i++) {
        const from = order.indexOf(target[i]);
        if (from === i) continue;
        run("space.move", { id: target[i], index: i + 1 });
        moved.add(byId.get(target[i]).w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return top;
  }

  // One machine's part of the sidebar (`only`; all of it when there is one machine): its loose
  // spaces, and each folder with its spaces there. A folder with no spaces shows on this computer.
  // Returns [{ el, reveal }]: `reveal` marks what to bring into view for the active space.
  section(top, t, collapsed, only) {
    const mine = (n) => this.shown.has(n.r.w.id) && (only === undefined || (n.r.w.machine ?? null) === only);
    const out = [];
    const block = (n, f, closes) => {
      const kids = n.kids.filter((k) => this.shown.has(k.w.id));
      const rows = [{ ...n.r, tree: null }, ...kids.map((k, j) => ({ ...k, tree: j === kids.length - 1 ? "└─" : "├─" }))];
      rows.forEach((r, j) => {
        const last = j === rows.length - 1;
        const at = { node: n.r.w.id, kids: n.kids.map((k) => k.w.id), folder: f?.id ?? null, first: j === 0, last, closes: closes && last };
        out.push({ el: collapsed ? this.compact(r, t) : this.row(r, t, at), reveal: r.w.active });
      });
    };
    for (const e of top) {
      if (!e.f) {
        if (mine(e)) block(e, null, false);
        continue;
      }
      const members = e.members.filter(mine);
      if (only !== undefined && !members.length && !(only === null && !e.members.length)) continue;
      const inside = members.flatMap((n) => [n.r.w, ...n.kids.map((k) => k.w)]);
      out.push({ el: this.folderRow(e.f, inside, t, collapsed), reveal: e.f.folded && inside.some((w) => w.active) });
      if (e.f.folded) continue;
      if (!members.length) {
        if (!collapsed) out.push({ el: this.emptyRow(e.f, t), reveal: false });
        continue;
      }
      members.forEach((n, j) => block(n, e.f, j === members.length - 1));
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const top = this.arrange();
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...spaces().filter(s => this.shown.has(s.id)).map(s => s.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      const all = this.section(top, t, collapsed);
      if (loading(null) && !all.length) return [loadingRow(null)];
      this.activeAt = all.findIndex(p => p.reveal);
      return all.map(p => p.el);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = this.section(top, t, collapsed, m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(p => p.el) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex(p => p.reveal);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // Where a drop would land: a line on a row's top or bottom edge.
  line(t, edge, inset) {
    const el = div().absolute().left(inset).right(0).h(2).rounded(1).bg(t.accent);
    return edge === "top" ? el.top(0) : el.bottom(0);
  }

  aim(next, cx) {
    if (JSON.stringify(next) === JSON.stringify(this.over)) return;
    this.over = next;
    cx.notify();
  }

  // The button went up on a row: a drop where the drag was aimed, else a click on what was pressed.
  release(cx, click) {
    const d = this.drag, o = this.over;
    this.drag = null;
    this.over = null;
    if (d && o) this.drop(d, o);
    else if (d && click) click(d);
    cx.notify();
  }

  drop(d, o) {
    this.change((m) => {
      if (d.kind === "folder") model.moveFolder(m, d.id, o.on === "end" ? {} : { [o.pos]: o.id });
      else {
        const dest = o.on === "end" ? { folder: null }
          : o.on === "space" ? { folder: o.folder, [o.pos]: o.id }
          : o.pos === "into" ? { folder: o.id, start: true }
          : { folder: null, [o.pos]: o.id };
        model.file(m, d.id, dest, { kids: d.kids, keys: this.keys });
      }
    });
  }

  // A folder's header: click folds, drag reorders it, a space dropped on it goes in (on its top
  // edge: before it). Folded, it speaks for its spaces: how many, and a dot when one needs you.
  folderRow(f, inside, t, collapsed) {
    const d = this.drag, o = this.over;
    const aimed = o?.on === "folder" && o.id === f.id;
    const into = aimed && o.pos === "into";
    const urgent = f.folded ? ["blocked", "done"].find((s) => inside.some((w) => w.status === s)) : null;
    const active = f.folded && inside.some((w) => w.active);
    const toggle = () => this.change((m) => model.setFolded(m, f.id, !f.folded));
    const open = () => this.menu("folder", { id: f.id });
    if (collapsed)
      return railCell(h_flex()
        .id(`folder-${f.id}`)
        .relative()
        .w(RAIL_CELL)
        .h(26)
        .rounded(6)
        .justify_center()
        .items_center()
        .tooltip(f.folded && inside.length ? `${f.name} · ${inside.length}` : f.name)
        .when(active, (el) => el.bg(t.selected))
        .when(!active, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(toggle)
        .on_mouse_down("right", open)
        .child(svg("mods/workspace-chrome/folder.svg").size(13).flex_none().text_color(f.folded ? t.muted : t.dim))
        .when(Boolean(urgent), (el) => el.child(div().absolute().right(5).text_color(tone(t, urgent)).child(glyph(urgent)))));
    return h_flex()
      .relative()
      .id(`folder-${f.id}`)
      .h(28)
      .flex_none()
      .px(8)
      .gap(9)
      .items_center()
      .rounded(8)
      .text_color(active ? t.foreground : t.muted)
      .when(into, (el) => el.bg(t.selected))
      .when(!into, (el) => el.hover((s) => s.bg(t.hover)))
      .when(Boolean(o) && d?.kind === "folder" && d.id === f.id, (el) => el.opacity(0.5))
      .when(aimed && o.pos === "before", (el) => el.child(this.line(t, "top", 0)))
      .when(aimed && o.pos === "after" && f.folded, (el) => el.child(this.line(t, "bottom", 0)))
      .on_mouse_down("left", () => {
        this.drag = { kind: "folder", id: f.id };
        this.over = null;
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const y = e.local_position?.y ?? 0, h = e.bounds?.height ?? 0;
        let next = null;
        if (d.kind === "folder") {
          if (d.id !== f.id) next = { on: "folder", id: f.id, pos: y < h / 2 ? "before" : "after" };
        } else if (!d.fixed) next = { on: "folder", id: f.id, pos: y < BEFORE_ZONE ? "before" : "into" };
        this.aim(next, cx);
      })
      .on_mouse_up("left", (_e, cx) => this.release(cx, (d) => { if (d.kind === "folder" && d.id === f.id) toggle(); }))
      .on_mouse_down("right", open)
      .child(h_flex().size(18).flex_none().items_center().justify_center()
        .child(svg("mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(active ? t.muted : t.dim)))
      .child(div().flex_1().min_w(0).truncate().font_medium().child(f.name))
      .when(Boolean(urgent), (el) => el.child(div().flex_none().text_color(tone(t, urgent)).child(glyph(urgent))))
      .when(f.folded && inside.length > 0, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(inside.length))))
      .child(svg(`mods/workspace-chrome/chevron-${f.folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim));
  }

  // An open folder with nothing in it: somewhere to drop the first space.
  emptyRow(f, t) {
    const o = this.over;
    const aimed = o?.on === "folder" && o.id === f.id;
    return h_flex()
      .relative()
      .id(`folder-empty-${f.id}`)
      .h(24)
      .flex_none()
      .pl(8 + INDENT + 27)
      .pr(8)
      .items_center()
      .rounded(8)
      .text_size(11.5)
      .text_color(t.dim)
      .when(aimed && o.pos === "into", (el) => el.bg(t.selected))
      .when(aimed && o.pos === "after", (el) => el.child(this.line(t, "bottom", 0)))
      .on_mouse_move((_e, cx) => {
        const d = this.drag;
        if (!d) return;
        if (d.kind === "folder") this.aim(d.id === f.id ? null : { on: "folder", id: f.id, pos: "after" }, cx);
        else this.aim(d.fixed ? null : { on: "folder", id: f.id, pos: "into" }, cx);
      })
      .on_mouse_up("left", (_e, cx) => this.release(cx))
      .on_mouse_down("right", () => this.menu("folder", { id: f.id }))
      .child("No spaces");
  }

  // The room under the list: a drop there goes last, out of every folder. Right-click: new folder.
  tail(t) {
    return div()
      .relative()
      .id("spaces-tail")
      .flex_1()
      .min_h(18)
      .when(this.over?.on === "end", (el) => el.child(this.line(t, "top", 0)))
      .on_mouse_move((_e, cx) => {
        const d = this.drag;
        if (d) this.aim(d.fixed ? null : { on: "end" }, cx);
      })
      .on_mouse_up("left", (_e, cx) => this.release(cx))
      .on_mouse_down("right", () => this.menu("root"));
  }

  // `at`: the row's place. { node: the space it's drawn under (itself, or its repo's for a worktree
  // row), kids: the worktree spaces under that one, folder, first/last: of its node's rows,
  // closes: the last row of its folder }.
  row({ w, i, g, tree }, t, at) {
    const on = w.active;
    const d = this.drag, o = this.over;
    const aimed = o?.on === "space" && o.id === at.node;
    const inset = at.folder ? INDENT : 0;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .pl(8 + inset)
      .pr(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(Boolean(o) && d?.kind === "space" && d.id === at.node, (el) => el.opacity(0.5))
      .when(aimed && o.pos === "before" && at.first, (el) => el.child(this.line(t, "top", inset)))
      .when(aimed && o.pos === "after" && at.last, (el) => el.child(this.line(t, "bottom", inset)))
      .when(o?.on === "folder" && o.pos === "after" && at.closes && o.id === at.folder, (el) => el.child(this.line(t, "bottom", 0)))
      .on_mouse_down("left", () => {
        // A worktree row stays under its repo's space: it's clicked, never dragged.
        this.drag = { kind: "space", id: at.node, kids: at.kids, fixed: Boolean(tree), row: w.id };
        this.over = null;
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const upper = (e.local_position?.y ?? 0) < (e.bounds?.height ?? 0) / 2;
        const pos = at.first && upper ? "before" : "after";
        let next = null;
        if (d.kind === "folder") {
          // Over a loose space: beside it. Over another folder's spaces: after that folder.
          if (!at.folder) next = { on: "space", id: at.node, folder: null, pos };
          else if (at.folder !== d.id) next = { on: "folder", id: at.folder, pos: "after" };
        } else if (!d.fixed && d.id !== at.node) {
          const source = spaces().find((s) => s.id === d.id);
          if (source && (source.machine ?? null) === (w.machine ?? null)) next = { on: "space", id: at.node, folder: at.folder, pos };
        }
        this.aim(next, cx);
      })
      .on_mouse_up("left", (_e, cx) => this.release(cx, (d) => { if (d.row === w.id) run("space.select", { id: w.id }); }))
      .on_mouse_down("right", () => this.menu("space", { id: w.id, git: g ? (g.linked ? "linked" : "main") : null, nested: Boolean(tree), kids: tree ? [] : at.kids, open: this.project(w, g) }))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render(cx) {
    if (this.other) return this.other.render();
    // The menu left a project to open. Taken in a task: only one copy gets it.
    if (opening.waiting()) cx.spawn(async () => {
      const r = opening.take();
      const done = r ? await opening.perform(r) : {};
      if (done.error) notify({ title: `Couldn't open it in ${opening.appName(r.app)}`, body: done.error, level: "error" });
    });
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().id("spaces-head").h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .on_mouse_down("right", () => this.menu("root"))
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child(div().flex_1().child("Spaces"))
          .child(div().id("folder-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip("New folder").on_click(() => naming({ title: "New folder" })).child(svg("mods/workspace-chrome/folder-plus.svg").size(14))))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().id("spaces-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(4).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        // A drag ends where the button goes up, or when the pointer leaves the list: a release
        // elsewhere never reaches it, and must not turn the next one here into a drop.
        .on_hover((hovered, cx) => { if (!hovered && this.drag) { this.drag = null; this.over = null; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.drag = null; this.over = null; cx.notify(); })
        .children([...list, this.tail(t)]));
  }
}
