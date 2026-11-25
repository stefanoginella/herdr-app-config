// Usage: will the agents' limits last, and what is eating them; then where the usage went over
// 24 hours, 7 days, 30 days or everything on record; then the year. Opened as a dialog
// (`mod.open {name: "usage"}`, the palette's "Usage", Cmd+Shift+U). The same mod is the sidebar
// widget and the status bar's end (props `{ role }`, glance.js). Tokens are the unit; dollars
// are a side figure (Codex's an estimate, marked "≈").
//
//   collect()   runs collect.mjs here and on every other machine that is connected, then
//               reduces what they said (reduce.js) in steps, and keeps the result as the
//               snapshot shown at the next open (SNAPSHOT)
//   ensure()    the figures of a range for a project filter, worked out once and kept
//   relink()    which projects are open spaces: by the live folders of their panes only
//   palette()   one color a project, the same everywhere on the page
//   reading()   the verdict, the rulers (one per limit) and the limit in focus
//   headline()  the verdict's two sentences
//   rulers(), ruler(): one budget ruler a limit, all alike
//   fit()       the layout for the dialog's size: charts side by side or tabbed, three lower
//               columns or two, the year in one row or two, and the heights
//   charts()    one column per weekly limit (Claude, then Codex), or one with a switch when
//               narrow: week() is the time chart, chartShapes() makes its shapes once per data
//               version, agent and size; side() is that agent's Burning now and what 1% costs
//   toolbar()   the range tabs and the range's figures
//   projects(), middle() (bars, biggest sessions), models() and machines(): the model groups
//               and a machine with containers fold (folds); the Machines heading does not
//   year()      the calendar, its records and the earlier weeks, across the whole width
//   name(), sessionName(), machineName(): every name drawn, hidden when `hide` is on
//
// render() only reads what those made: nothing is added up while drawing, and every shape is
// made in a task (build()).

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, writeTextFile, home, appHome, checking, machines, spaces, panes, agents, theme, settings, shared, run, props, nextCommand, closeOverlay, window as app } from "herdr";
import { prepare, weekView, rangeView, yearView, burning, tokens, weekSpan, RANGES, WEEKDAYS, MONTHS, SCRATCH_KEY, YEAR_WEEKS, COLORS, TOP, shiftDay } from "./reduce.js";
import { HOUR_MS, localMidnight, nextLocalMidnight, usableStart, WEEK_MS, formatRate, evenAt } from "./pace.js";
import { judge, limitBlock, paceWords, levelColor, dayWord, clock, dur, dryAt, byDanger, shortWhen as whenShort } from "./limits.js";
import Glance, { agentIcon } from "./glance.js";

const HERE = () => `${appHome()}/mods/usage`;
const SNAPSHOT = () => `${home()}/.local/state/herdr-usage/view.json`;
const SNAPSHOT_V = 6;
const SPINNER = "mods/workspace-chrome/spinner.svg";
// Collected again while open, only while Herdr is the active app: every EVERY, or every
// EVERY_BUSY while an agent is working.
const EVERY = 5 * 60_000;
const EVERY_BUSY = 2 * 60_000;
const TICK = 30_000;
const COLLECT_TIMEOUT = 120_000;
// A Claude reading older than this says its time; older than STALE_DIM it is drawn dim.
const STALE_SAY = 30 * 60_000;
const STALE_DIM = 6 * HOUR_MS;
// The projects listed before "N more".
const LIST_FIRST = 10;
// Burning now: its rows at most for each agent, and when a project's last reply counts as quiet.
const BURNING_MOST = 3;
const QUIET_MS = 15 * 60_000;
// The bars rise once, on the first figures after the dialog opens.
const RISE_MS = 350;

// One color a project (palette()). Neighbours are told apart by color-blind eyes on the dialog's
// surface. Green is left out: it is the "spare" level's color.
const PALETTE = ["#5b8def", "#e3814f", "#8b7cf6", "#22a99a", "#b08d1e", "#d9649a"];
// The sidebar's space-avatar colors (MARK in space-folders).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const GREEN = "#3fae6a";

// Type, px at zoom 1: words in the app's UI font, every figure in MONO.
const MONO = "Geist Mono";
const LABEL = 11.5, BODY = 13, SECTION = 15, FIGURE = 20, HEADLINE = 28;
const ROW_H_ = 20;
const PAD = 24;
const HEAD_H = 44;
// The verdict: its height, the colored bar at its left included.
const HEADLINE_H = 76;
// A ruler: its name row, the bar, the ruler under it; the space between two.
const NAME_H = 24, BAR_H = 26, TICKS_H = 14, RULER_GAP = 10;
const RULER_H = NAME_H + 4 + BAR_H + 5 + TICKS_H;
// The chart row: a chart's least and most height, the gap between two charts, a chart's title.
const CHART_MIN = 120, CHART_MAX = 180, CHART_GAP = 36, CHART_TITLE = 20;
// Burning now under each chart: its heading, then `lines` rows (burnLines()), the same for every agent.
const burnH = (lines) => 10 + 20 + lines * ROW_H_;
// The chart row's fixed part, without Burning now: its margins, a title.
const CHART_FIXED = 14 + 12 + CHART_TITLE + 6;
// The chart's margins: the axis labels on the left, the weekday names under it.
const AXIS_W = 40, AXIS_B = 20, CHART_T = 6, CHART_R = 8;
// Zone two: the toolbar, the columns' least and most height, the bars' height and the gutter for
// their amounts.
const TOOLBAR_H = 10 + 34, LOWER_MIN = 290, LOWER_MAX = 380, BARS_H = 100, BAR_GUTTER = 44;
// Widths, px at zoom 1, below which the charts take turns, the lower zone has two columns and the
// year two rows, and the toolbar leaves out the tokens' split.
const WIDE_CHARTS = 900, THREE_COLUMNS = 1000, YEAR_ONE_ROW = 1000, TOOLBAR_SPLIT = 1060;
// The row grammar.
const ROW_H = ROW_H_, TRACK_W = 44, TOK_W = 52, USD_W = 62, SHARE_W = 36, SPARK_W = 56, SPARK_H = 14;
// The calendar: a cell's least and most pitch, the gap after a cell; the day labels; the year's
// records column; the earlier weeks' bars (a bar's least and most pitch).
const PITCH_MIN = 11, PITCH_MAX = 13, CELL_GAP = 2, YEAR_LABELS = 30, RECORDS_W = 200, YEAR_GAP = 36;
// Earlier weeks: a row's height (two agents), the block's least width, the label and percentage
// columns, and a bar's least pitch and most width (a bar is 0.7 of its pitch).
const EARLIER_H = 28, EARLIER_W_MIN = 220, EARLIER_LABEL = 58, EARLIER_PCT = 30, EARLIER_PITCH_MIN = 6, EARLIER_BAR_MAX = 14;
// A session row.
const SESSION_H = 32, SESSION_GAP = 6;
// A group's child rows in Models and Machines start here: under the header's name.
const CHILD = 16;
const CHEVRON = { open: "mods/workspace-chrome/chevron-down.svg", shut: "mods/workspace-chrome/chevron-right.svg" };

// ---------------------------------------------------------------- words

const short = (ms) => WEEKDAYS[new Date(ms).getDay()].slice(0, 3);
const date = (ms) => { const t = new Date(ms); return `${t.getDate()} ${MONTHS[t.getMonth()]}`; };
const when = (ms, now) => `${dayWord(ms, now)} ${clock(ms)}`;
function ago(ms, now) {
  const m = Math.floor((now - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`;
  return `on ${dayWord(ms, now)} ${clock(ms)}`;
}
const commas = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// "$4,818"; under a dollar "<$1"; "≈" when `est`, the estimated part, is 5% of it or more.
function money(v, est) {
  if (!v) return "$0";
  if (v < 1) return "<$1";
  return `${est >= 0.05 * v ? "≈" : ""}$${commas(v)}`;
}
// "$11.40": to ten cents from a dollar up, to the cent under.
function cents(v) { return `$${(v >= 1 ? Math.round(v * 10) / 10 : v).toFixed(2)}`; }
function share(f) {
  if (f === null || f === undefined) return "";
  if (f > 0 && f < 0.005) return "<1%";
  return `${Math.round(f * 100)}%`;
}
const PLANS = { prolite: "Pro Lite", pro: "Pro", plus: "Plus", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu", free: "Free" };
const plan = (p) => (p ? PLANS[p] ?? p[0].toUpperCase() + p.slice(1) : null);
const AGENTS = { claude: "Claude", codex: "Codex" };
// "A".."Z", then "AA".."AZ", ...
function letters(i) { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
// About how wide a text is, px, in the UI font at `size`.
const textW = (s, size) => s.length * size * 0.56;
// A color with its alpha multiplied: "#rrggbb" or "#rrggbbaa".
function fade(c, a) {
  if (typeof c !== "string" || !c.startsWith("#") || (c.length !== 7 && c.length !== 9)) return c;
  const base = c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1;
  const v = Math.round(Math.max(0, Math.min(1, base * a)) * 255).toString(16);
  return c.slice(0, 7) + (v.length < 2 ? "0" + v : v);
}
// The largest round step (1, 2, 2.5, 5 times a power of ten) that fits under `most` twice.
function niceStep(most) {
  const raw = Math.max(most / 2, 1e-9);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const k of [5, 2.5, 2, 1]) if (k * p <= raw) return k * p;
  return p;
}
// The level a week ended at: under 85 spare, 85 to 99 tight, 100 dry.
const endLevel = (pct) => (pct >= 100 ? "out" : pct >= 85 ? "tight" : "ok");
const pulse = { from: 0.35, to: 1, period: 1600 };
// A Herdr agent that is Codex: its program's key, or the app it reports.
const isCodex = (a) => a.program?.key === "codex" || /codex/i.test(a.app ?? "");

// A rectangle w by h, its right corners cut by `cut` (a hatch that reaches the track's end).
function rect(w, h, cut) {
  const pts = cut > 0
    ? [[0, 0], [w - cut, 0], [w, cut], [w, h - cut], [w - cut, h], [0, h]]
    : [[0, 0], [w, 0], [w, h], [0, h]];
  return PathBuilder.fill().add_polygon(pts, true).build();
}

// A project's buckets as one line, SPARK_W by SPARK_H: straight segments through the real
// points, so 24 hours, 7 days and 30 days show their own buckets. Only above SPARK_AVERAGE
// buckets ("All", by week) is each first averaged with its neighbours, so the line reads as a
// trend. A project with one active bucket is a small bump (0.4 of the height), not a spike.
// The builder has no line join to choose (its miter would point past the box at a sharp
// peak, and under the baseline at a valley), so each segment is its own stroke and every
// inner point gets a small round joint.
const SPARK_AVERAGE = 31;
function sparkPath(raw) {
  let vals = raw;
  if (raw.length > SPARK_AVERAGE) vals = raw.map((_v, i) => { let a = 0, n = 0; for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < raw.length) { a += raw[k]; n++; } return a / n; });
  const most = Math.max(...vals) || 1;
  const active = raw.filter((v) => v > 0).length;
  const reach = active <= 1 ? 0.4 : 1;
  const xs = vals.map((_v, i) => i / (vals.length - 1) * (SPARK_W - 2) + 1);
  const ys = vals.map((v) => SPARK_H - 1 - v / most * reach * (SPARK_H - 2));
  const p = PathBuilder.stroke(1.25);
  for (let i = 0; i < xs.length - 1; i++) p.move_to(xs[i], ys[i]).line_to(xs[i + 1], ys[i + 1]);
  // A ring this small, stroked 1.25 wide, is a dot about the line's own width.
  const r = 0.12;
  for (let i = 1; i < xs.length - 1; i++) {
    p.move_to(xs[i] + r, ys[i]).arc_to(r, r, 0, false, true, xs[i] - r, ys[i]).arc_to(r, r, 0, false, true, xs[i] + r, ys[i]);
  }
  return p.build();
}

// The five steps of a heat map, faint to full.
const STEPS = [0.22, 0.4, 0.58, 0.78, 1];

// ---------------------------------------------------------------- the view

export default class Usage extends View {
  init(_props, cx) {
    // The sidebar widget and the status bar's end are this mod too.
    const role = props()?.role;
    if (role === "side" || role === "bar") {
      this.glance = new Glance();
      this.glance.init(cx, role);
      return;
    }
    // Kept: after an `await`, props() may answer for another copy.
    this.overlay = props()?.overlay ?? null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.range = "week";
    this.filter = null;
    this.focus = null;      // the weekly limit the chart shows: "claude", "codex", or null (the one most in danger)
    this.hide = false;      // names hidden, for a screenshot; in memory only
    this.snap = null;       // what is shown: see collect()
    this.data = null;       // the rows of the last collection, for filters; never drawn
    this.cache = new Map(); // `${range}|${filter}` → rangeView, for this.data
    this.pending = new Set();
    this.version = 0;
    // Every shape drawn (the chart's, the hatches, the sparklines, the calendar's cells), by a key
    // with the data version and the size. They are made in a task (build()), never while drawing.
    this.shapes = new Map();
    this.wanted = new Map();
    this.building = false;
    this.sizes = {};        // each agent's chart size, px at zoom 1
    this.dims = null;       // the dialog's size, px at zoom 1 (fit())
    this.folds = {};        // the folded model groups and machines, by id: kept in the snapshot's file
    this.rulerW = null;     // a ruler's bar width, px at zoom 1
    this.links = new Map(); // project key → space id
    this.linkSig = null;
    this.paint = null;      // palette(): { key, colors }
    this.busy = false;
    this.failed = null;
    this.hoverAt = null;    // a time on a chart, of hoverAgent's
    this.hoverAgent = null;
    this.hoverBar = null;   // an index in the range's bars
    this.hoverProject = null;
    this.hoverRuler = null; // the ruler whose segment is under the pointer
    this.hoverDay = null;   // an index in the calendar
    this.hoverWeek = null;  // an earlier week under the pointer: { agent, resets, peak }
    this.open = false;      // the projects list shows all of them
    this.rise = "wait";     // the bars' one rise: wait, start, go, done
    this.lastCollect = 0;
    this.drawMost = 0;
    this.memo = null;       // reading()
    if (checking()) return;
    cx.timer.after(300, () => this.handle.focus());
    cx.spawn(async (cx) => {
      await this.restore(cx);
      cx.notify();
      await this.collect(cx);
    });
    cx.timer.every(TICK, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") await this.collect(cx);
        // Not bound: a range, the names or a limit chosen from a shell, for a look at them.
        else if (RANGES.some((r) => r.id === c)) this.range = c;
        else if (c === "names") this.hide = !this.hide;
        else if (c === "claude" || c === "codex") this.focus = c;
        cx.notify();
      }
    });
  }

  // Every TICK: the age of the figures changes, and they are collected again every EVERY (every
  // EVERY_BUSY while an agent works), only while Herdr is the active app.
  tick(cx) {
    if (app()?.active === false) return;
    const every = agents().some((a) => a.status === "working") ? EVERY_BUSY : EVERY;
    if (!this.busy && Date.now() - this.lastCollect >= every) { cx.spawn(async (cx) => this.collect(cx)); return; }
    cx.notify();
  }

  // The snapshot of the last collection, so the dialog shows something at once.
  async restore(cx) {
    try {
      const text = await readTextFile(SNAPSHOT());
      this.snapText = text;
      const s = text ? JSON.parse(text) : null;
      if (s?.v === SNAPSHOT_V && s.weeks && s.ranges) { this.snap = s; this.folds = this.cleanFolds(s.folds); this.version++; this.rising(cx); }
    } catch { /* none, or unreadable: the first collection writes it */ }
  }

  async save(snap) {
    const text = JSON.stringify(snap);
    try { await writeTextFile(SNAPSHOT(), text, this.snapText ?? null); this.snapText = text; }
    catch {
      // Written meanwhile by another copy, or there all along: read what is there and try once more.
      try { const now = await readTextFile(SNAPSHOT()); await writeTextFile(SNAPSHOT(), text, now ?? null); this.snapText = text; } catch {}
    }
  }

  // The bars rise from nothing once, on the first figures after the dialog opens.
  rising(cx) {
    if (this.rise !== "wait") return;
    this.rise = "start";
    cx.timer.after(40, (cx) => { this.rise = "go"; cx.notify(); });
    cx.timer.after(40 + RISE_MS + 120, (cx) => { this.rise = "done"; cx.notify(); });
  }

  async collect(cx) {
    if (this.busy) return;
    this.busy = true;
    this.failed = null;
    cx.notify();
    const t0 = Date.now();
    try {
      const dir = HERE();
      const tz = this.snap?.tz ?? null;
      const local = exec("node", [`${dir}/collect.mjs`], { timeout: COLLECT_TIMEOUT })
        .then((r) => ({ machine: null, r }), (e) => ({ machine: null, error: String(e?.message ?? e) }));
      // The other machines' rows are given this Mac's time zone (TZ), so their days and hours
      // line up with these. Their history is kept there, in their own state folder.
      const others = machines().filter((m) => m.name !== null);
      let script = null;
      const remote = others.map(async (m) => {
        if (m.layout !== "ready") return { machine: m.name, error: "unreachable" };
        try {
          script ??= readTextFile(`${dir}/collect.mjs`);
          const text = await script;
          const args = ["--input-type=module", "-e", text, "--"];
          const r = tz ? await exec("env", [`TZ=${tz}`, "node", ...args], { on: m.name, timeout: COLLECT_TIMEOUT })
            : await exec("node", args, { on: m.name, timeout: COLLECT_TIMEOUT });
          return { machine: m.name, r };
        } catch (e) { return { machine: m.name, error: String(e?.message ?? e) }; }
      });
      const answers = await Promise.all([local, ...remote]);
      const tRun = Date.now();
      const docs = [];
      const status = [];
      let failed = null;
      for (const a of answers) {
        let doc = null, error = a.error ?? null;
        if (!error && a.r.code !== 0) error = (a.r.stderr || `exit code ${a.r.code}`).trim().split("\n")[0];
        if (!error) { try { doc = JSON.parse(a.r.stdout); } catch (e) { error = `unreadable answer: ${e.message}`; } }
        await null;
        if (doc) docs.push({ machine: a.machine, doc });
        if (a.machine === null) { if (error) failed = error; }
        else status.push({ name: a.machine, ok: Boolean(doc), error });
      }
      if (failed) { this.failed = failed; return; }
      const tParse = Date.now();
      const now = Date.now();
      const data = prepare(docs, now);
      await null;
      // One view per agent with a weekly limit; the colors are claimed by the limit most in
      // danger first, then by the others' top projects: those that ate a point or more of it
      // (a limit at 1% would otherwise take colors from the range's biggest projects).
      const weeks = { claude: weekView(data, now, "claude") };
      if (data.codex) weeks.codex = weekView(data, now, "codex");
      await null;
      const order = byDanger(Object.values(weeks).map((w) => ({ w, block: w.none ? null : limitBlock(w.pct, w.end, WEEK_MS, now) })));
      const claims = [];
      for (const { w } of order) {
        const tops = w.none ? w.top : w.pts.filter(([, v]) => v >= 1).slice(0, TOP).map(([k]) => k);
        for (const k of tops) if (!claims.includes(k) && claims.length < COLORS) claims.push(k);
      }
      const ranges = {};
      for (const r of RANGES) { ranges[r.id] = rangeView(data, r.id, null, now, claims); await null; }
      const year = yearView(data, now);
      const tReduce = Date.now();
      // The projects any part names, and nothing of the rows: the snapshot stays small.
      const used = new Set(claims);
      for (const w of Object.values(weeks)) { for (const k of w.top) used.add(k); for (const [k] of w.pts ?? []) used.add(k); }
      for (const r of Object.values(ranges)) { for (const p of r.projects) used.add(p.key); for (const s of r.biggest) used.add(s.p); }
      const burn = data.hasRecent ? burning(data.recent, BURNING_MOST) : null;
      for (const b of Object.values(burn ?? {})) for (const x of b.rows) used.add(x.p);
      const projects = {};
      for (const k of used) if (data.projects[k]) projects[k] = data.projects[k];
      // Hidden names: a letter a project, by all-time tokens, so the same in every range.
      const alias = {};
      let n = 0;
      for (const k of [...ranges.all.projects.map((p) => p.key), ...used]) if (k !== SCRATCH_KEY && !(k in alias) && projects[k]) alias[k] = letters(n++);
      // `took`: how long this collection's steps took, and the slowest draw since the dialog
      // opened, in ms. Only read by people.
      const took = { run: tRun - t0, parse: tParse - tRun, reduce: tReduce - tParse, rows: data.rows.length, render: this.drawMost };
      const lx = data.codex;
      const snap = {
        v: SNAPSHOT_V, at: now, tz: data.tz, weeks, claims,
        codex: lx ? { at: lx.at, plan: lx.plan ?? null, primary: lx.primary ?? null, secondary: lx.secondary ?? null } : null,
        ranges, year, projects, alias, machines: status,
        blocked: data.blocked, docker: data.docker, hasTop: data.top.length > 0, recent: burn, took, folds: this.folds,
      };
      this.data = data;
      this.cache = new Map(RANGES.map((r) => [`${r.id}|`, ranges[r.id]]));
      this.pending.clear();
      this.snap = snap;
      this.version++;
      this.shapes.clear();
      this.memo = null;
      this.linkSig = null;
      this.rising(cx);
      this.lastCollect = Date.now();
      took.size = JSON.stringify(snap).length;
      await this.save(snap);
    } catch (e) {
      this.failed = String(e?.message ?? e).split("\n")[0];
    } finally {
      this.busy = false;
      cx.notify();
    }
  }

  // The figures of the range shown, for the filter; worked out in a task the first time.
  // A filter is only taken once the rows are here (toggle()), so it never shows unfiltered.
  ensure(cx) {
    const k = `${this.range}|${this.filter ?? ""}`;
    const v = this.cache.get(k);
    if (v) return v;
    if (!this.filter || !this.data) return this.snap?.ranges?.[this.range] ?? null;
    if (!this.pending.has(k)) {
      this.pending.add(k);
      const { range, filter, data } = this;
      cx.spawn(async (cx) => {
        await null;
        if (data !== this.data) return;
        this.cache.set(k, rangeView(data, range, filter, data.now, this.snap.claims ?? []));
        this.pending.delete(k);
        cx.notify();
      });
    }
    return null;
  }

  // Which projects are open spaces. Only the live folders of a space's panes count, never the
  // space's own folder (where it was made, often another project's): a pane's folder belongs to
  // the project whose folder is it or holds it, the longest such one. Mod panes have none.
  // Worked out when the panes' folders change, never while drawing.
  relink(cx) {
    const sp = spaces(), pn = panes();
    const sig = `${this.version}|` + pn.map((p) => `${p.pane}\t${p.tab}\t${p.cwd ?? ""}`).join("\n");
    if (sig === this.linkSig || !this.snap) return;
    this.linkSig = sig;
    cx.spawn(async (cx) => {
      await null;
      if (sig !== this.linkSig) return;
      const tabSpace = new Map();
      for (const s of sp) for (const t of s.tabs) tabSpace.set(t.id, s);
      const links = new Map();
      const paneProject = new Map();
      for (const p of pn) {
        const s = tabSpace.get(p.tab);
        if (!s || !p.cwd) continue;
        const k = this.projectOf(s.machine ?? null, p.cwd);
        if (!k) continue;
        paneProject.set(p.pane, k);
        if (!links.has(k)) links.set(k, s.id);
      }
      this.links = links;
      this.paneProject = paneProject;
      this.paint = null;
      cx.notify();
    });
  }

  // The project a folder belongs to: the longest project folder that is it or holds it.
  projectOf(machine, cwd) {
    let best = null, len = 0;
    for (const pr of Object.values(this.snap?.projects ?? {})) {
      if (!pr?.path || pr.key === SCRATCH_KEY || (pr.machine ?? null) !== machine) continue;
      if ((cwd === pr.path || cwd.startsWith(pr.path + "/")) && pr.path.length > len) { best = pr.key; len = pr.path.length; }
    }
    return best;
  }

  // The working Herdr agents by project: { key: [agent, ...] }, from their panes' folders.
  working() {
    const map = new Map();
    const pp = this.paneProject;
    if (!pp) return map;
    for (const a of agents()) {
      if (a.status !== "working") continue;
      const k = pp.get(a.pane);
      if (!k) continue;
      const l = map.get(k) ?? [];
      l.push(a);
      map.set(k, l);
    }
    return map;
  }

  // One color a project: the limits' claims first (the limit most in danger first), then the
  // shown range's own, from PALETTE in order. An open space's avatar color wins when it is no
  // green and not taken already.
  palette(rv) {
    const keys = (rv?.segKeys ?? this.snap?.claims ?? []).slice(0, COLORS);
    const sig = `${this.version}|${keys.join("|")}|${[...this.links].join(",")}`;
    if (this.paint?.key === sig) return this.paint.colors;
    const avatars = shared("space.colors") ?? {};
    const colors = new Map();
    const taken = new Set();
    for (const k of keys) {
      const id = this.links.get(k);
      const c = id ? avatars[id] : null;
      const hex = c ? (c.startsWith("#") ? c : MARK[c]) : null;
      if (hex && hex !== GREEN && !taken.has(hex)) { colors.set(k, hex); taken.add(hex); }
      else {
        const pick = PALETTE.find((x) => !taken.has(x));
        if (pick) { colors.set(k, pick); taken.add(pick); }
      }
    }
    this.paint = { key: sig, colors };
    return colors;
  }

  color(key, t) { return this.colors?.get(key) ?? t.dim; }

  // The project shown brighter than the rest: the one under the pointer, else the filter.
  lit() { return this.hoverProject ?? this.filter; }

  // Whether a band or a segment of `key` (null: the rest) is drawn in full.
  isLit(key) {
    const hl = this.lit();
    if (!hl) return true;
    if (key === null) return !this.colors?.has(hl);
    return key === hl;
  }

  hoverOn(key, cx, ruler = null) {
    if (this.hoverProject === key && this.hoverRuler === ruler) return;
    this.hoverProject = key; this.hoverRuler = ruler; cx.notify();
  }
  hoverOff(key, cx) {
    if (this.hoverProject !== key) return;
    this.hoverProject = null; this.hoverRuler = null; cx.notify();
  }

  // ---------------------------------------------------------------- names

  name(key) {
    if (key === SCRATCH_KEY) return "Other folders";
    if (this.hide) return `Project ${this.snap?.alias?.[key] ?? "?"}`;
    return this.snap?.projects?.[key]?.name ?? "";
  }
  machineName(m) {
    if (m === "" || m === null) return "This Mac";
    if (!this.hide) return m;
    const i = (this.snap?.machines ?? []).findIndex((x) => x.name === m);
    return `Machine ${i >= 0 ? i + 1 : "?"}`;
  }

  choose(id, cx) { this.range = id; this.hoverBar = null; cx.notify(); }

  // The folds kept in view.json, without the stale `machines` (the section header once folded).
  cleanFolds(f) {
    const out = {};
    for (const [k, v] of Object.entries(f ?? {})) if (v && k !== "machines") out[k] = true;
    return out;
  }

  // A group of Models or Machines folded or unfolded; kept in the snapshot's file (view.json).
  fold(id, cx) {
    const f = { ...this.folds };
    if (f[id]) delete f[id]; else f[id] = true;
    this.folds = f;
    cx.notify();
    if (!this.snap || checking()) return;
    this.snap = { ...this.snap, folds: f };
    const snap = this.snap;
    cx.spawn(async () => { await this.save(snap); });
  }

  toggle(key, cx) {
    if (key !== null && !this.data) return;
    this.filter = this.filter === key ? null : key;
    this.hoverBar = null;
    cx.notify();
  }

  goTo(key) {
    const id = this.links.get(key);
    if (id) run("space.select", { id });
  }

  key(e, cx) {
    // Escape clears the project filter first, then closes the dialog: the dialog's own keyboard
    // handle keeps the key from Herdr, as in files-actions' naming.js and confirm.js.
    if (e.key === "escape") {
      cx.stop_propagation();
      if (this.filter) { this.toggle(null, cx); return; }
      if (this.overlay) closeOverlay(this.overlay);
      return;
    }
    if (e.modifiers?.control || e.modifiers?.alt || e.modifiers?.platform || e.modifiers?.shift) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i >= 0) { this.choose(RANGES[i].id, cx); cx.stop_propagation(); return; }
    if (e.key === "r") { cx.stop_propagation(); cx.spawn(async (cx) => this.collect(cx)); }
    if (e.key === "h") { cx.stop_propagation(); this.hide = !this.hide; cx.notify(); }
  }

  zoom() { return Number(settings()?.zoom) || 1; }

  // The verdict, the rulers and the default focus, at the snapshot's own moment: the chart is of
  // that moment too, so all say the same until the next collection.
  reading() {
    const key = `${this.version}`;
    if (this.memo?.key === key) return this.memo;
    const s = this.snap;
    const now = s?.at ?? Date.now();
    const weeks = s?.weeks ?? {};
    const lx = s?.codex;
    const limits = [];
    const rulers = [];
    for (const agent of ["claude", "codex"]) {
      const w = weeks[agent];
      if (!w || w.none) continue;
      limits.push({ agent, name: AGENTS[agent], week: { pct: w.pct, resets: w.end, samples: w.samples ?? [] }, at: w.at });
      const b = limitBlock(w.pct, w.end, WEEK_MS, now);
      if (b) rulers.push({ id: `${agent}-week`, agent, week: true, name: `${AGENTS[agent]} week`, plan: agent === "codex" ? plan(lx?.plan) : null, block: b, view: w });
    }
    // The shorter windows, when there is a reading of one.
    const fh = weeks.claude?.fiveHour;
    if (fh && fh.pct != null && fh.resets) {
      const b = limitBlock(fh.pct, fh.resets, 5 * HOUR_MS, now);
      if (b) rulers.push({ id: "claude-5h", agent: "claude", week: false, name: "Claude 5 hours", plan: null, block: b, windowMs: 5 * HOUR_MS });
    }
    for (const x of [lx?.primary, lx?.secondary]) {
      if (!x || x.pct == null || !x.resets || !x.windowMinutes || x.windowMinutes >= 10080) continue;
      const b = limitBlock(x.pct, x.resets, x.windowMinutes * 60_000, now);
      if (b) rulers.push({ id: `codex-${x.windowMinutes}`, agent: "codex", week: false, name: x.windowMinutes === 300 ? "Codex 5 hours" : `Codex ${dur(x.windowMinutes * 60_000)}`, plan: null, block: b, windowMs: x.windowMinutes * 60_000 });
    }
    const verdict = s ? judge(limits, now) : null;
    const weekly = rulers.filter((r) => r.week);
    const worst = byDanger(weekly)[0]?.agent ?? Object.keys(weeks)[0] ?? "claude";
    this.memo = { key, verdict, rulers, worst };
    return this.memo;
  }

  // The weekly limit the chart shows.
  focused() {
    const w = this.snap?.weeks ?? {};
    if (this.focus && w[this.focus]) return this.focus;
    return this.reading().worst;
  }

  // How old Claude's reading is, in ms (null without one).
  age() { const at = this.snap?.weeks?.claude?.at; return at ? Date.now() - at : null; }

  // ---------------------------------------------------------------- header

  header(t) {
    const now = Date.now();
    const s = this.snap;
    const working = agents().filter((a) => a.status === "working").length;
    const el = h_flex().flex_none().h(HEAD_H).px(PAD).gap(14).items_center()
      .child(div().text_size(SECTION).font_semibold().child("Usage"));
    if (working > 0) {
      const burst = this.reading().verdict?.burst;
      el.child(h_flex().gap(7).items_center().text_size(BODY).text_color(t.muted)
        .child(div().size(6).rounded(3).flex_none().bg(t.working).loop("opacity", { from: 0.25, to: 1, period: 1600 }))
        .child(div().child(`${working} ${working === 1 ? "agent" : "agents"} working${burst ? `, ${formatRate(burst.perHour)}% an hour` : ""}`)));
    }
    el.child(div().flex_1());
    el.child(div().id("usage-names").px(7).py(3).rounded(4).cursor_pointer().text_size(LABEL).text_color(this.hide ? t.foreground : t.muted)
      .when(this.hide, (d) => d.bg(t.selected))
      .hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.hide = !this.hide; cx.notify(); })
      .child(this.hide ? "Show names" : "Hide names"));
    el.child(div().text_size(LABEL).text_color(t.muted).child(s ? `updated ${ago(s.at, now)}` : this.busy ? "reading…" : ""))
      .child(h_flex().id("usage-refresh").gap(5).items_center().px(5).py(3).ml(-8).rounded(4).cursor_pointer().text_color(t.muted)
        .hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => cx.spawn(async (cx) => this.collect(cx)))
        .child(this.busy ? svg(SPINNER).size(13).spin(900) : svg("mods/usage/refresh.svg").size(13))
        .child(div().text_size(LABEL).text_color(t.dim).child("R")));
    return el;
  }

  // ---------------------------------------------------------------- the verdict

  headline(t) {
    const v = this.snap ? this.reading().verdict : { level: "none", one: this.failed ? "No figures yet." : "Reading transcripts…", two: "" };
    // Claude's reading older than STALE_DIM is drawn dim, as the sidebar draws it.
    const stale = v.agent === "claude" && (this.age() ?? 0) > STALE_DIM;
    // Smaller when narrow, so the first sentence stays on one line.
    const size = (this.dims?.width ?? 1280) >= 1000 ? HEADLINE : 22;
    return h_flex().flex_none().h(HEADLINE_H).px(PAD).pt(6).gap(14).items_start()
      .child(div().w(3).h(56).flex_none().rounded(1.5).bg(stale ? t.dim : levelColor(v.level, t)))
      .child(v_flex().gap(6).min_w(0).text_color(stale ? t.dim : t.foreground)
        .child(div().text_size(size).line_height(1.15).font_semibold().truncate().child(v.one))
        .child(div().text_size(BODY).text_color(stale ? t.dim : t.muted).child(v.two || " ")));
  }

  // ---------------------------------------------------------------- the rulers

  rulers(t) {
    const el = v_flex().id("usage-rulers").flex_none().px(PAD)
      .on_size_change((size, cx) => {
        const w = size.width / this.zoom() - 2 * PAD;
        if (Math.abs((this.rulerW ?? 0) - w) > 1) { this.rulerW = w; cx.notify(); }
      });
    if (!this.snap) return el;
    const { rulers } = this.reading();
    if (!rulers.length) {
      const w = this.snap.weeks?.claude;
      return el.child(div().h(NAME_H).text_size(BODY).text_color(t.muted)
        .child(w?.stale ? `No reading since the reset ${when(w.stale, Date.now())}.` : "No limit reading yet."));
    }
    rulers.forEach((r, i) => el.child(this.ruler(t, r).when(i > 0, (d) => d.mt(RULER_GAP))));
    return el;
  }

  // One limit: its name and where it stands; the bar (what each project ate, what this pace will
  // burn, what is spare, and today's even pace); the ruler of its days.
  ruler(t, r) {
    const b = r.block;
    const now = this.snap.at;
    const W = this.rulerW;
    const age = this.age();
    const stale = r.agent === "claude" && age !== null && age > STALE_SAY;
    const dim = r.agent === "claude" && age !== null && age > STALE_DIM;
    const p = b.pace;
    const tone = levelColor(b.level, t);
    const out = p?.state === "out";
    const dryTime = p?.runsOutAt ? dryAt(p.runsOutAt) : null;
    const end = out ? 100 : Math.min(100, p?.projected ?? b.pct);
    // Row 1: the name, the plan; where it stands.
    const row1 = h_flex().h(NAME_H).flex_none().gap(10).items_center().text_color(dim ? t.dim : t.foreground)
      .child(h_flex().gap(7).items_center().child(agentIcon(r.agent, 15)).child(div().text_size(SECTION).font_semibold().child(r.name)))
      .when(Boolean(r.plan), (d) => d.child(div().text_size(BODY).text_color(t.dim).child(r.plan)))
      .child(div().flex_1());
    if (stale) {
      const at = this.snap.weeks.claude.at;
      row1.child(div().text_size(LABEL).text_color(t.dim).child(`at ${Date.now() - at > 86_400_000 ? `${short(at)} ` : ""}${clock(at)}`));
    }
    row1.child(div().text_size(BODY).text_color(dim ? t.dim : t.muted).child(out ? "dry" : paceWords(b)));
    row1.child(div().font_family(MONO).text_size(FIGURE).font_semibold().child(`${Math.round(b.pct)}%`));
    // What can't stand in the bar stands here, after the percentage.
    const x = (v) => Math.max(0, Math.min(100, v)) / 100 * (W ?? 0);
    const dryWords = dryTime ? `dry ${whenShort(dryTime, now)}` : null;
    const endWords = !out && !dryTime && p ? `ends at ${Math.round(p.projected)}%` : null;
    const hatchW = x(end) - x(b.pct);
    const dryInside = dryWords && hatchW >= textW(dryWords, LABEL) + 16;
    const endInside = endWords && (W ?? 0) - x(end) >= textW(endWords, LABEL) + 10;
    if (dryWords && !dryInside) row1.child(div().text_size(BODY).text_color(dim ? t.dim : tone).child(dryWords));
    if (endWords && !endInside && W) row1.child(div().text_size(BODY).text_color(t.muted).child(endWords));
    row1.child(div().text_size(BODY).text_color(dim ? t.dim : t.muted).child(out ? `until ${whenShort(b.resets, now)}` : `resets ${whenShort(b.resets, now)}`));
    const el = v_flex().id(`usage-ruler-${r.id}`).flex_none().cursor_pointer()
      .on_click((_e, cx) => { this.focus = r.agent; cx.notify(); })
      .child(row1);
    if (!W) return el.child(div().h(BAR_H + TICKS_H));
    // Row 2: the bar.
    const bar = div().relative().mt(4).w(W).h(BAR_H).flex_none().rounded(5).bg(t.hover);
    let at = 0;
    const segs = [];
    if (r.week && r.view?.pts) {
      // The colored projects in the order of the points they ate, then the rest.
      let rest = r.view.ptsRest ?? 0;
      for (const [k, v] of r.view.pts) { if (this.colors?.has(k)) segs.push([k, v]); else rest += v; }
      const sum = segs.reduce((a, s) => a + s[1], 0) + rest;
      // The points are worked out from the weight: scaled to the reading drawn.
      const f = sum > 0 ? b.pct / sum : 0;
      for (const s of segs) s[1] *= f;
      if (rest * f > 0.05) segs.push([null, rest * f]);
    } else segs.push([undefined, b.pct]);
    segs.forEach(([k, v], i) => {
      const w0 = x(at), w1 = x(at + v);
      at += v;
      if (w1 - w0 < 0.5) return;
      const lit = k === undefined || this.isLit(k);
      const c = k === undefined ? t.muted : k === null ? t.dim : this.color(k, t);
      const seg = div().id(`usage-rs-${r.id}-${i}`).absolute().left(w0).top(0).w(w1 - w0).h(BAR_H)
        .bg(dim ? t.dim : fade(c, lit ? 1 : 0.3)).border_r(2).border_color(t.popover)
        .when(i === 0, (d) => d.rounded_l(5));
      if (k !== undefined) seg.on_hover((on, cx) => (on ? this.hoverOn(k, cx, r.id) : this.hoverOff(k, cx)));
      // A segment wide enough carries its name and points.
      if (k !== undefined) {
        const nm = k === null ? "other" : this.name(k);
        const pts = String(Math.round(v));
        if (w1 - w0 - 2 >= textW(nm, LABEL) + pts.length * 7.5 + 16) {
          seg.child(h_flex().size_full().px(7).gap(5).items_center().text_size(LABEL).text_color(t.popover)
            .child(div().min_w(0).truncate().font_semibold().child(nm))
            .child(div().font_family(MONO).child(pts)));
        }
      }
      bar.child(seg);
    });
    // What this pace burns: hatched, from the reading to where it ends; to the end when it runs
    // dry first.
    if (!out && hatchW >= 2) {
      const hc = dim ? t.dim : b.level === "ok" ? (r.week ? t.muted : t.dim) : tone;
      const cut = end >= 100 ? 3 : 0;
      const hp = this.shape(`hatch|${Math.round(hatchW)}|${cut}`, () => rect(Math.round(hatchW), BAR_H, cut));
      const hatch = div().absolute().left(x(b.pct)).top(0).w(Math.round(hatchW)).h(BAR_H);
      if (hp) hatch.child(window.paint_path(hp, Background.pattern_slash(fade(hc, 0.75), 1.5, 6)).absolute().top(0).left(0).size_full());
      bar.child(hatch);
      if (dryInside) {
        bar.child(div().absolute().right(8).top(5).px(5).h(16).rounded(3).bg(t.popover).flex().items_center()
          .text_size(LABEL).text_color(dim ? t.dim : tone).whitespace_nowrap().child(dryWords));
      }
    }
    if (endInside) {
      bar.child(div().absolute().left(x(end) + 6).top(0).h(BAR_H).flex().items_center()
        .text_size(LABEL).text_color(t.muted).whitespace_nowrap().child(endWords));
    }
    // Where today is: the even pace.
    bar.child(div().absolute().left(x(b.even) - 1).top(-3).w(2).h(BAR_H + 9).bg(dim ? t.dim : t.foreground));
    // The hovered segment's chip, above the bar.
    if (this.hoverRuler === r.id && this.hoverProject && r.week) {
      const k = this.hoverProject;
      let a0 = 0, v0 = null;
      for (const [sk, sv] of segs) { if (sk === k) { v0 = sv; break; } a0 += sv; }
      if (v0 !== null) {
        const words = `${this.name(k)}  ${Math.round(v0)} ${Math.round(v0) === 1 ? "point" : "points"}`;
        const cw = textW(words, LABEL) + 16;
        const cxp = Math.max(0, Math.min(W - cw, x(a0 + v0 / 2) - cw / 2));
        bar.child(div().absolute().left(cxp).top(-24).h(20).px(7).rounded(4).bg(t.popover).border(1).border_color(t.border)
          .flex().items_center().text_size(LABEL).whitespace_nowrap().child(words));
      }
    }
    el.child(bar);
    // Row 3: the days (or hours) of the window, where each starts on the even pace's scale.
    el.child(this.ticks(t, r, W, now));
    return el;
  }

  ticks(t, r, W, now) {
    const b = r.block;
    const el = div().relative().w(W).h(TICKS_H).flex_none().mt(5);
    const start = b.start, end = b.resets;
    if (r.week) {
      const at = (ms) => evenAt(start, end, ms) / 100 * W;
      const today = localMidnight(now);
      for (let d = localMidnight(start); d < end; d = nextLocalMidnight(d)) {
        const a = Math.max(d, start), e = Math.min(nextLocalMidnight(d), end);
        if (d > start) el.child(div().absolute().left(at(d)).top(0).w(1).h(4).bg(t.border));
        if (at(e) - at(a) < 26) continue;
        el.child(div().absolute().left(at(a) + 4).top(1).text_size(LABEL - 1).text_color(d === today ? t.foreground : t.dim).child(short(d + 12 * HOUR_MS)));
      }
    } else {
      // A short window: by the clock, a tick each hour.
      const span = end - start;
      const at = (ms) => (ms - start) / span * W;
      const nowH = Math.floor(now / HOUR_MS) * HOUR_MS;
      for (let h = Math.ceil(start / HOUR_MS) * HOUR_MS; h < end; h += HOUR_MS) {
        el.child(div().absolute().left(at(h)).top(0).w(1).h(4).bg(t.border));
        if (at(Math.min(h + HOUR_MS, end)) - at(h) >= 40) el.child(div().absolute().left(at(h) + 4).top(1).text_size(LABEL - 1).font_family(MONO).text_color(h === nowH ? t.foreground : t.dim).child(clock(h)));
      }
    }
    return el;
  }

  // ---------------------------------------------------------------- the chart

  // x and y of the chart, for its size.
  scales(w, size) {
    const x0 = AXIS_W, x1 = Math.max(x0 + 10, size.width - CHART_R);
    const y0 = CHART_T, y1 = Math.max(y0 + 10, size.height - AXIS_B);
    const x = (ms) => x0 + (ms - w.start) / (w.end - w.start) * (x1 - x0);
    const y = (v) => y1 - Math.max(0, Math.min(100, v)) / 100 * (y1 - y0);
    return { x0, x1, y0, y1, x, y };
  }

  // A shape made once for its key, in a task: null until it is there.
  shape(key, build) {
    const s = this.shapes.get(key);
    if (s !== undefined) return s;
    this.wanted.set(key, build);
    return null;
  }

  // Makes the shapes the last draw asked for, a few at a time, then draws again.
  build(cx) {
    if (!this.wanted.size || this.building) return;
    const jobs = [...this.wanted];
    this.wanted.clear();
    this.building = true;
    cx.spawn(async (cx) => {
      await null;
      try {
        for (const [k, f] of jobs) {
          if (!this.shapes.has(k)) this.shapes.set(k, f());
          await null;
        }
        if (this.shapes.size > 600) this.shapes.clear();
      } finally {
        this.building = false;
        cx.notify();
      }
    });
  }

  // The chart's shapes, made once for a data version, a limit and a size: making them on every
  // draw fills the memory all mods share.
  chartPaths(w, size) {
    return this.shape(`chart|${this.version}|${w.agent}|${Math.round(size.width)}|${Math.round(size.height)}`, () => this.chartShapes(w, size));
  }

  chartShapes(w, size) {
    const { x0, x1, y0, y1, y, x } = this.scales(w, size);
    const line = (pts, width, dash) => {
      const b = PathBuilder.stroke(width).move_to(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) b.line_to(pts[i][0], pts[i][1]);
      if (dash) b.dash_array(dash);
      return b.build();
    };
    const xs = w.times.map(x);
    const bands = w.tops.map((top, b) => {
      const pts = top.map((v, i) => [xs[i], y(v)]);
      const under = b === 0 ? top.map((_v, i) => [xs[i], y(0)]) : w.tops[b - 1].map((v, i) => [xs[i], y(v)]);
      for (let i = under.length - 1; i >= 0; i--) pts.push(under[i]);
      return PathBuilder.fill().add_polygon(pts, true).build();
    });
    const last = w.tops[w.tops.length - 1];
    const grid = PathBuilder.stroke(1);
    for (const v of [25, 50, 75]) grid.move_to(x0, y(v) + 0.5).line_to(x1, y(v) + 0.5);
    const dryT = w.pace?.runsOutAt ? dryAt(w.pace.runsOutAt) : null;
    const dry = dryT !== null ? x(dryT) : null;
    // A burst: a steeper line from now to where the last hour's rate would run dry.
    const bu = w.burst && w.burst.runsOutAt > w.now && w.burst.runsOutAt < w.end ? w.burst : null;
    return {
      bands,
      top: line(last.map((v, i) => [xs[i], y(v)]), 1.5),
      even: line(w.even.map(([t, v]) => [x(t), y(v)]), 1),
      projection: w.projection && w.projection.length > 1 ? line(w.projection.map(([t, v]) => [x(t), y(v)]), 1.5, [4, 3]) : null,
      burst: bu ? line([[x(w.now), y(last[last.length - 1])], [x(bu.runsOutAt), y(100)]], 1.5, [2, 3]) : null,
      hundred: line([[x0, y(100) + 0.5], [x1, y(100) + 0.5]], 1, [2, 3]),
      grid: grid.build(),
      dry: dry !== null ? line([[dry + 0.5, y0], [dry + 0.5, y1]], 1, [3, 3]) : null,
      // The dry stretch, hatched lightly, to rhyme with the rulers.
      dryArea: dry !== null && x1 - dry > 1 ? rect(x1 - dry, y1 - y0, 0) : null,
    };
  }

  // The weekly limits with a reading, Claude first.
  weekly() {
    const w = this.snap?.weeks ?? {};
    return ["claude", "codex"].filter((a) => w[a] && !w[a].none);
  }

  // The switch of the weekly limits, when the charts take turns (narrow).
  switcher(t) {
    const el = h_flex().gap(16).items_center().text_size(BODY);
    const f = this.focused();
    for (const agent of this.weekly()) {
      const on = agent === f;
      el.child(h_flex().id(`usage-focus-${agent}`).gap(7).items_center().cursor_pointer().text_color(on ? t.foreground : t.muted)
        .when(on, (d) => d.font_semibold())
        .when(!on, (d) => d.hover((st) => st.text_color(t.foreground)))
        .on_click((_e, cx) => { this.focus = agent; cx.notify(); })
        .child(agentIcon(agent, 14))
        .child(div().child(`${AGENTS[agent]} week`)));
    }
    return el;
  }

  // A line of words where a chart would be.
  note(t, text) {
    return div().flex_1().h_full().flex().items_center().justify_center().text_size(BODY).text_color(t.muted).child(text);
  }

  // The chart row: one column per weekly limit, side by side, of equal widths; when narrow, the
  // limit in focus alone, with the switch.
  charts(t, lay) {
    const h = CHART_TITLE + 6 + lay.chart + burnH(lay.burn);
    const row = h_flex().flex_none().mt(14).mb(12).px(PAD).gap(CHART_GAP).items_start();
    const s = this.snap;
    if (!s) return row.h(h).child(this.note(t, this.failed ? "" : "Reading transcripts…"));
    const list = this.weekly();
    if (!list.length) {
      const w = s.weeks?.claude;
      return row.h(h).child(this.note(t, w?.stale ? `No reading since the reset ${when(w.stale, Date.now())}.` : "No weekly reading yet."));
    }
    const shown = lay.wide ? list : [list.includes(this.focused()) ? this.focused() : list[0]];
    const tabs = !lay.wide && list.length > 1;
    shown.forEach((agent, i) => row.child(this.column(t, agent, lay, tabs, i === shown.length - 1)));
    return row;
  }

  // One weekly limit: its title (or the switch), its chart, its Burning now. `last`: the column
  // at the right, which carries the note on the nights.
  column(t, agent, lay, tabs, last) {
    const title = h_flex().flex_none().h(CHART_TITLE).mb(6).gap(8).items_center()
      .child(tabs ? this.switcher(t) : h_flex().gap(7).items_center().text_size(BODY).font_semibold()
        .child(agentIcon(agent, 14)).child(div().child(`${AGENTS[agent]} week`)))
      .child(div().flex_1());
    if (last) title.child(div().text_size(LABEL).text_color(t.dim).whitespace_nowrap().child("shaded: 00–08, not counted"));
    return v_flex().flex_1().min_w(0)
      .child(title)
      .child(this.week(t, agent, lay.chart))
      .child(this.side(t, agent, lay.burn));
  }

  // An agent's weekly chart, `height` px tall and as wide as its column.
  week(t, agent, height) {
    const box = div().id(`usage-chart-${agent}`).w_full().h(height).flex_none().relative()
      .on_size_change((size, cx) => {
        const z = this.zoom();
        const was = this.sizes[agent];
        const next = { width: size.width / z, height: size.height / z };
        if (!was || Math.abs(was.width - next.width) > 0.5 || Math.abs(was.height - next.height) > 0.5) { this.sizes[agent] = next; cx.notify(); }
      });
    const w = this.snap.weeks?.[agent];
    const size = this.sizes[agent];
    if (!w || w.none || !size) return box;
    const { x0, x1, y0, y1, x, y } = this.scales(w, size);
    const p = this.chartPaths(w, size);
    if (!p) return box;
    const now = w.now;
    const level = w.verdict?.level ?? "ok";
    const tone = levelColor(level, t);
    const full = (path, color) => window.paint_path(path, color).absolute().top(0).left(0).size_full();
    const last = w.tops[w.tops.length - 1];
    const usedNow = last[last.length - 1];
    // Nights, 00:00 to the start of the usable day: the even pace and the projection rest there.
    for (let d = localMidnight(w.start); d < w.end; d = nextLocalMidnight(d)) {
      const a = Math.max(d, w.start), b = Math.min(usableStart(d), w.end);
      if (b > a) box.child(div().absolute().left(x(a)).top(y0).w(Math.max(1, x(b) - x(a))).h(y1 - y0).bg(fade(t.hover, 0.5)));
    }
    // The dry stretch: from the moment the projection reaches 100% (to the half hour) to the reset.
    const dryTime = w.pace?.runsOutAt ? dryAt(w.pace.runsOutAt) : null;
    if (dryTime && p.dryArea) {
      box.child(div().absolute().left(x(dryTime)).top(y0).w(x1 - x(dryTime)).h(y1 - y0)
        .child(window.paint_path(p.dryArea, Background.pattern_slash(fade(tone, 0.22), 1, 7)).absolute().top(0).left(0).size_full()));
    }
    if (p.dry) box.child(full(p.dry, fade(tone, 0.7)));
    // The grid: 25, 50, 75 faint, 100 dashed, 0 a hairline; a tick and a day name at each midnight.
    box.child(full(p.grid, fade(t.border, 0.6)));
    box.child(full(p.hundred, t.border));
    box.child(div().absolute().left(x0).top(y1).w(x1 - x0).h(1).bg(t.border));
    const axis = (v, text) => box.child(div().absolute().left(0).top(y(v) - 8).w(AXIS_W - 8).whitespace_nowrap().text_right().text_size(LABEL).text_color(t.dim).font_family(MONO).child(text));
    axis(100, "100%");
    axis(50, "50%");
    for (let d = nextLocalMidnight(w.start); d <= w.end; d = nextLocalMidnight(d)) {
      box.child(div().absolute().left(x(d)).top(y1).w(1).h(5).bg(t.border));
    }
    // The day names.
    for (let d = localMidnight(w.start); d < w.end; d = nextLocalMidnight(d)) {
      const a = Math.max(d, w.start);
      if (x(Math.min(nextLocalMidnight(d), w.end)) - x(a) < 28) continue;
      box.child(div().absolute().left(x(a) + 4).top(y1 + 4).text_size(LABEL).text_color(t.dim).child(short(d + 12 * HOUR_MS)));
    }
    // Used so far, by project, then its edge; the even pace; the projection and a burst. Quieter
    // than the rulers.
    const order = [...w.top, null];
    p.bands.forEach((band, b) => {
      const key = order[b];
      const lit = this.isLit(key);
      const own = key && this.colors?.has(key) ? this.color(key, t) : t.dim;
      const fill = Background.solid(lit ? own : t.dim).opacity(lit ? (key ? 0.55 : 0.4) : 0.15);
      box.child(full(band, fill));
    });
    box.child(full(p.even, t.muted));
    if (p.projection) box.child(full(p.projection, tone));
    if (p.burst) box.child(full(p.burst, fade(tone, 0.5)));
    box.child(full(p.top, t.foreground));
    // The lines' names at their right ends. "at this pace" sits above the projection's end.
    const rects = [];
    if (w.projection && w.projection.length > 1) {
      const [te, ve] = w.projection[w.projection.length - 1];
      const ex = x(dryTime ?? te), ey = y(ve);
      if (dryTime) {
        box.child(div().absolute().left(ex - 4).top(ey - 4).size(8).rounded(4).border(1.5).border_color(tone).bg(t.popover));
        rects.push([ex - 5, ey - 5, ex + 5, ey + 5]);
        // How long it stays dry, on a chip at the foot of the stretch, clear of the lines.
        const words = `dry for ${dur(w.end - dryTime)}`;
        box.child(div().absolute().left(ex + 6).top(y1 - 22).px(4).py(1).rounded(2).bg(t.popover).text_size(LABEL).text_color(tone).whitespace_nowrap().child(words));
        rects.push([ex + 6, y1 - 22, ex + 6 + textW(words, LABEL) + 8, y1 - 4]);
      } else {
        const words = `at this pace: ${Math.round(w.pace.projected)}%`;
        box.child(div().absolute().right(size.width - ex + 2).top(ey - 18).text_size(LABEL).text_color(tone).whitespace_nowrap().child(words));
        rects.push([ex - 2 - textW(words, LABEL), ey - 18, ex - 2, ey - 2]);
      }
    }
    // "even pace": right-aligned at the plot's right edge, under the line, its top a few px below
    // the line's height at the label's left edge (the line only rises to the right, so it stays
    // clear under the whole label). Where that is taken, left of the line's end, above it. On a
    // chip when it sits on the dry hatch.
    const evenW = textW("even pace", LABEL) + 8, evenH = 16;
    const lx = x1 - evenW;
    const at = w.start + (lx - x0) / (x1 - x0) * (w.end - w.start);
    const yl = y(this.readingAt(w, Math.max(w.start, at)).even);
    const hits = (r) => rects.some((o) => r[0] < o[2] && o[0] < r[2] && r[1] < o[3] && o[1] < r[3]);
    let ly = Math.max(y0 + 2, yl + 4);
    if (ly + evenH > y1 || hits([lx, ly, x1, ly + evenH])) ly = Math.max(0, yl - evenH - 4);
    const onHatch = dryTime !== null && lx >= x(dryTime) - 2;
    box.child(div().absolute().right(size.width - x1).top(ly).px(4).h(evenH).flex().items_center().rounded(2).when(onHatch, (d) => d.bg(t.popover))
      .text_size(LABEL).text_color(t.muted).whitespace_nowrap().child("even pace"));
    rects.push([lx, ly, x1, ly + evenH]);
    // Now: a hairline, and the dot at the reading, which pulses while a Herdr agent of this
    // chart's kind works (a Codex agent on Codex's chart only). Who works where is Burning now's.
    box.child(div().absolute().left(x(now)).top(y0).w(1).h(y1 - y0).bg(fade(t.foreground, 0.22)));
    const busy = agents().some((a) => a.status === "working" && (w.agent === "codex") === isCodex(a));
    box.child(div().absolute().left(x(now) - 3.5).top(y(usedNow) - 3.5).size(7).rounded(3.5).bg(t.foreground)
      .when(busy, (d) => d.loop("opacity", pulse)));
    // The pointer's hour: a hairline, and the reading at the top of the chart.
    if (this.hoverAgent === agent && this.hoverAt !== null && this.hoverAt >= w.start && this.hoverAt <= w.end) {
      const r = this.readingAt(w, this.hoverAt);
      const hx = x(this.hoverAt);
      box.child(div().absolute().left(hx).top(y0).w(1).h(y1 - y0).bg(t.muted));
      const text = `${whenShort(this.hoverAt, Date.now())}: ${r.v === null ? "—" : `${Math.round(r.v)}%`} ${r.used ? "used" : "projected"}, pace ${Math.round(r.even)}%`;
      // At the top, or under the labels it would cover.
      const tw = textW(text, LABEL) + 14, left = hx > (x0 + x1) / 2;
      const tx0 = left ? hx - 6 - tw : hx + 6;
      let ty = y0 + 2;
      for (const o of rects) if (tx0 < o[2] && o[0] < tx0 + tw && ty < o[3] && o[1] < ty + 20) ty = Math.max(ty, o[3] + 4);
      const tag = div().absolute().top(ty).px(6).py(2).rounded(4).bg(t.popover).border(1).border_color(t.border).text_size(LABEL).whitespace_nowrap().child(text);
      box.child(left ? tag.right(size.width - hx + 6) : tag.left(hx + 6));
    }
    box.on_mouse_move((e, cx) => {
      const lx = (e.local_position?.x ?? 0) / this.zoom();
      const t1 = w.start + (lx - x0) / (x1 - x0) * (w.end - w.start);
      // Snapped to the hour, so the view is drawn again only when the hour changes.
      const hour = t1 < w.start || t1 > w.end ? null : Math.min(w.end, Math.max(w.start, w.start + Math.round((t1 - w.start) / HOUR_MS) * HOUR_MS));
      if (hour !== this.hoverAt || this.hoverAgent !== agent) { this.hoverAt = hour; this.hoverAgent = agent; cx.notify(); }
    }).on_hover((on, cx) => { if (!on && this.hoverAgent === agent && this.hoverAt !== null) { this.hoverAt = null; this.hoverAgent = null; cx.notify(); } });
    return box;
  }

  // The reading at a moment of the chart: used by then, or projected; and the even pace there.
  readingAt(w, at) {
    const lerp = (pts, t) => {
      for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i][0]) { const [ta, va] = pts[i - 1], [tb, vb] = pts[i]; return tb > ta ? va + (vb - va) * (t - ta) / (tb - ta) : vb; }
      }
      return pts.length ? pts[pts.length - 1][1] : 0;
    };
    const even = lerp(w.even, at);
    if (at <= w.now) {
      const last = w.tops[w.tops.length - 1];
      const i = Math.min(w.times.length - 1, Math.max(0, Math.round((at - w.start) / HOUR_MS)));
      return { used: true, v: last[i], even };
    }
    if (w.projection?.length > 1 && at <= w.projection[w.projection.length - 1][0]) return { used: false, v: lerp(w.projection, at), even };
    return { used: false, v: w.projection?.length ? 100 : null, even };
  }

  // ---------------------------------------------------------------- burning now

  // An agent's Burning now, under its chart: the heading, with what 1% of its week costs at the
  // right, then its projects of the last hour. Every agent's takes the same height.
  side(t, agent, lines) {
    const el = v_flex().flex_none().h(burnH(lines)).pt(10);
    const head = h_flex().flex_none().h(20).gap(8).items_center()
      .child(div().text_size(BODY).font_semibold().child("Burning now"))
      .child(div().text_size(LABEL).text_color(t.dim).child("last hour"))
      .child(div().flex_1());
    // What one percent of the limit costs at API prices, once there is enough to say.
    const w = this.snap.weeks?.[agent];
    if (w && !w.none && w.pct >= 5 && w.cost > 0) {
      head.child(h_flex().gap(5).items_center().text_size(LABEL).text_color(t.muted)
        .child(div().child("1% ≈"))
        .child(div().font_family(MONO).text_size(BODY).text_color(t.foreground).child(cents(w.cost / w.pct))));
    }
    el.child(head);
    const recent = this.snap.recent;
    if (!recent) return el.child(div().h(ROW_H).text_size(BODY).text_color(t.dim).child("Needs a newer collector."));
    return el.child(this.burning(t, agent, recent[agent] ?? { rows: [], more: 0, moreTok: 0 }));
  }

  // Percent of a limit an hour for what its agent spent in the last hour, by the week's own rate.
  perHour(agent, x) {
    const w = this.snap.weeks?.[agent];
    if (!w || w.none || !(w.pct > 0) || !x) return null;
    // By the week's cost per point; tokens of a model with no price (cost60 0) by its tokens per point.
    if (w.cost > 0 && x.cost60 > 0) return x.cost60 / (w.cost / w.pct);
    return w.tok > 0 && x.tok60 > 0 ? x.tok60 / (w.tok / w.pct) : null;
  }

  // An agent's projects that spent most in the last hour, with its Herdr agents working in them.
  burning(t, agent, b) {
    const el = v_flex().flex_none();
    if (!b.rows.length) return el.child(div().h(ROW_H).flex().items_center().text_size(BODY).text_color(t.dim).child("Nothing in the last hour."));
    const at = this.working();
    b.rows.forEach((x, i) => {
      const list = (at.get(x.p) ?? []).filter((a) => isCodex(a) === (agent === "codex"));
      const quiet = Date.now() - x.last > QUIET_MS;
      const ph = this.perHour(agent, x);
      const row = h_flex().id(`usage-burn-${agent}-${i}`).flex_none().h(ROW_H).px(6).mx(-6).gap(8).items_center().rounded(4).text_size(BODY)
        .text_color(quiet ? t.muted : t.foreground)
        .child(div().size(8).rounded(4).flex_none().bg(this.color(x.p, t)))
        .child(div().min_w(0).truncate().child(this.name(x.p)))
        // Herdr's agents at work there: a pulsing dot in the working color and their number.
        .when(list.length > 0, (d) => d.child(h_flex().flex_none().gap(4).items_center().text_size(LABEL).text_color(t.dim)
          .child(div().size(5).rounded(2.5).flex_none().bg(t.working).loop("opacity", pulse))
          .child(div().child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`))))
        .child(div().flex_1())
        .child(div().flex_none().font_family(MONO).child(tokens(x.tok60 ?? 0)))
        .child(div().w(58).flex_none().text_right().whitespace_nowrap().font_family(MONO).text_color(t.muted).child(ph === null ? "" : ph < 0.05 ? "<0.1%/h" : `${ph < 10 ? ph.toFixed(1) : Math.round(ph)}%/h`));
      // A row with a Herdr agent at work takes you to it.
      if (list.length) {
        row.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => {
          run("agent.focus", { terminal: list[0].address });
          if (this.overlay) closeOverlay(this.overlay);
        });
      }
      el.child(row);
    });
    if (b.more > 0) el.child(div().h(ROW_H).flex().items_center().text_size(LABEL).text_color(t.dim).child(`${b.more} more, ${tokens(b.moreTok)} tokens`));
    return el;
  }

  // ---------------------------------------------------------------- the range

  // The range tabs, the filter, the range's tokens (or the hovered bar's or project's), their
  // split, and the dollars at the right end.
  toolbar(t, rv, range, lay) {
    const hb = this.hoverBar !== null && rv?.bars?.[this.hoverBar] ? rv.bars[this.hoverBar] : null;
    const hp = !hb && this.hoverProject && rv ? rv.projects.find((p) => p.key === this.hoverProject) : null;
    const line = h_flex().flex_none().h(34).px(PAD).gap(16).items_center().text_size(BODY).child(this.tabs(t));
    let fig = null;
    if (hb) {
      line.child(div().text_size(SECTION).font_semibold().whitespace_nowrap().child(this.barTitle(rv, hb)));
      fig = { T: hb.v, tok: hb.tok, cost: hb.cost, est: hb.est };
    } else if (hp) {
      line.child(div().text_size(SECTION).font_semibold().max_w(220).truncate().child(this.name(hp.key)));
      fig = { T: hp.T, tok: hp.tok, cost: hp.cost, est: hp.est };
    } else {
      if (this.filter && (this.snap?.projects?.[this.filter] || this.filter === SCRATCH_KEY)) {
        line.child(h_flex().gap(4).items_center().px(8).h(24).rounded(5).bg(t.selected)
          .child(div().size(8).rounded(4).flex_none().bg(this.color(this.filter, t)))
          .child(div().ml(2).max_w(200).truncate().font_semibold().child(this.name(this.filter)))
          .child(div().id("usage-unfilter").px(4).rounded(4).cursor_pointer().text_color(t.muted)
            .hover((st) => st.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => this.toggle(null, cx))
            .child("×")));
      }
      if (rv && !rv.empty) fig = { T: rv.T, tok: rv.tokens, cost: rv.cost, est: rv.est, prev: rv.prev };
    }
    if (fig) {
      const big = h_flex().items_end().gap(6)
        .child(div().font_family(MONO).text_size(FIGURE).font_semibold().child(tokens(fig.T)))
        .child(div().mb(3).text_size(BODY).child("tokens"));
      // Per full day, against as many full days before; nothing when those aren't on record.
      if (fig.prev && range.before) {
        const c = fig.prev.change, n = Math.round(Math.abs(c) * 100);
        big.child(div().ml(-5).mb(3).text_size(BODY).text_color(t.muted).child(n === 0 ? ", flat" : `, ${c > 0 ? "up" : "down"} ${n}%`));
      }
      line.child(big);
      const [i, o, w, r] = fig.tok;
      const part = (v, words) => h_flex().gap(4).child(div().font_family(MONO).child(tokens(v))).child(div().text_color(t.muted).child(words));
      if (lay.W >= TOOLBAR_SPLIT) line.child(h_flex().gap(12).items_center().text_size(12).child(part(i, "input")).child(part(o, "output")).child(part(w, "cache write")).child(part(r, "cache read")));
    } else if (rv?.empty) line.child(div().text_color(t.muted).child(range.empty));
    line.child(div().flex_1());
    if (fig && fig.cost > 0) {
      line.child(h_flex().gap(5).items_baseline().text_color(t.muted)
        .child(div().font_family(MONO).text_size(BODY).text_color(t.foreground).child(money(fig.cost, fig.est)))
        .child(div().child("at API prices")));
    }
    if (!hb && !hp) {
      const away = (this.snap?.machines ?? []).filter((m) => !m.ok).map((m) => this.machineName(m.name));
      if (away.length) line.child(div().text_size(LABEL).text_color(t.dim).child(`without ${away.join(", ")}`));
    }
    return line;
  }

  // The range tabs, each with its key.
  tabs(t) {
    return h_flex().gap(2).items_center().children(RANGES.map((r, i) => {
      const on = r.id === this.range;
      return h_flex().id(`usage-range-${r.id}`).gap(5).px(9).py(3).rounded(5).text_size(BODY).cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .when(on, (d) => d.bg(t.selected))
        .when(!on, (d) => d.hover((st) => st.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => this.choose(r.id, cx))
        .child(div().child(r.label))
        .child(div().text_size(LABEL).text_color(t.dim).child(String(i + 1)));
    }));
  }

  barTitle(rv, b) {
    if (rv.unit === "hour") return `${short(b.at)} ${clock(b.at)}`;
    if (rv.unit === "week") return `Week of ${date(b.at)}`;
    return `${WEEKDAYS[new Date(b.at).getDay()]} ${date(b.at)}`;
  }

  // Under its own bar: every sixth hour, every weekday, else every seventh bar from the last.
  barTick(rv, b, i, n) {
    if (i === n - 1) return rv.unit === "hour" ? "now" : rv.unit === "week" ? "this week" : "today";
    if (rv.unit === "hour") { const h = new Date(b.at).getHours(); return h % 6 === 0 ? clock(b.at) : null; }
    if (rv.id === "week") return short(b.at);
    // Not so near the last that it runs into "this week", which ends with its bar.
    return (n - 1 - i) % 7 === 0 && (rv.unit !== "week" || n - 1 - i >= 10) ? date(b.at) : null;
  }

  // ---------------------------------------------------------------- the columns

  title(text, right, t) {
    const el = h_flex().flex_none().h(22).mb(6).items_center().child(div().flex_1().text_size(SECTION).font_semibold().child(text));
    if (right) el.child(div().text_size(LABEL).text_color(t.dim).child(right));
    return el;
  }

  // The figures at a row's end: tokens, dollars (dim), the share.
  figures(t, row, { T, cost, est, part }) {
    row.child(div().w(TOK_W).flex_none().text_right().whitespace_nowrap().font_family(MONO).child(tokens(T)));
    row.child(div().w(USD_W).flex_none().text_right().whitespace_nowrap().font_family(MONO).text_color(t.dim).child(cost > 0 ? money(cost, est) : ""));
    row.child(div().w(SHARE_W).flex_none().text_right().font_family(MONO).text_color(t.muted).child(share(part)));
    return row;
  }

  // A project's own buckets in the range, as one line. Made once per data version and range.
  spark(rv, key, t) {
    const vals = rv.sparks?.[key];
    if (!vals || vals.length < 2) return div().w(SPARK_W).h(SPARK_H).flex_none();
    const p = this.shape(`spark|${this.version}|${rv.id}|${key}`, () => sparkPath(vals));
    if (!p) return div().w(SPARK_W).h(SPARK_H).flex_none();
    const c = this.colors.get(key) ?? t.muted;
    return div().w(SPARK_W).h(SPARK_H).flex_none().relative()
      .child(window.paint_path(p, !this.lit() || this.lit() === key ? c : fade(c, 0.3)).absolute().top(0).left(0).size_full());
  }

  projects(t, rv, lay) {
    const el = v_flex().w(lay.three ? "36%" : "50%").min_w(0).h_full().pl(PAD).pr(16).pt(14).child(this.title("Projects", null, t));
    const list = v_flex().id("usage-projects").flex_1().min_h(0).overflow_y_scroll()
      .on_hover((on, cx) => { if (!on && this.hoverProject && !this.hoverRuler) { this.hoverProject = null; cx.notify(); } });
    if (!rv || !rv.projects.length) return el.child(list);
    const projects = this.snap.projects;
    const shown = this.open ? rv.projects : rv.projects.slice(0, LIST_FIRST);
    // The word that tells two same-named projects apart, only when both are rows here.
    const count = new Map();
    if (!this.hide) for (const p of shown) { const n = projects[p.key]?.name; if (n) count.set(n, (count.get(n) ?? 0) + 1); }
    shown.forEach((p, i) => {
      const pr = projects[p.key] ?? { name: p.key, dim: "" };
      const linked = this.links.has(p.key);
      const on = this.filter === p.key;
      const dim = this.lit() && !on && this.hoverProject !== p.key;
      const nm = this.name(p.key);
      const keep = nm.length <= 22;
      const name = h_flex().flex_1().min_w(0).gap(8).items_center()
        .child(div().size(8).rounded(4).flex_none().bg(this.color(p.key, t)))
        .child(div().id(`usage-pt-${i}`).when(keep, (d) => d.flex_none()).when(!keep, (d) => d.min_w(0).truncate()).text_color(dim ? t.muted : t.foreground)
          .when(linked, (d) => d.cursor_pointer().hover((st) => st.underline()).on_click((_e, cx) => { cx.stop_propagation(); this.goTo(p.key); }))
          .child(nm));
      if (pr.dim && (count.get(pr.name) ?? 0) >= 2) name.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(pr.dim));
      const row = h_flex().id(`usage-p-${i}`).flex_none().h(ROW_H).gap(8).px(6).items_center().rounded(4).cursor_pointer().text_size(BODY)
        .child(name).child(this.spark(rv, p.key, t));
      list.child(this.figures(t, row, { T: p.T, cost: p.cost, est: p.est, part: p.share })
        .when(on, (d) => d.bg(t.selected))
        .when(!on, (d) => d.hover((st) => st.bg(t.hover)))
        .on_hover((h, cx) => { if (h) this.hoverOn(p.key, cx); })
        .on_click((_e, cx) => this.toggle(p.key, cx)));
    });
    if (rv.projects.length > LIST_FIRST) {
      const more = rv.projects.slice(LIST_FIRST);
      const T = more.reduce((a, p) => a + p.T, 0);
      list.child(div().id("usage-more").flex_none().h(ROW_H).px(6).rounded(4).flex().items_center().cursor_pointer().text_size(LABEL).text_color(t.muted)
        .hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.open = !this.open; cx.notify(); })
        .child(this.open ? "fewer" : `${more.length} more, ${tokens(T)} tokens`));
    }
    return el.child(list);
  }

  // The range's bars, then its biggest sessions.
  middle(t, rv, lay) {
    const el = v_flex().id("usage-middle").w(lay.three ? "36%" : "50%").min_w(0).h_full().pl(16).pr(lay.three ? 16 : PAD).pt(14).overflow_hidden();
    if (!rv) return el;
    el.child(this.bars(t, rv));
    if (this.snap?.hasTop) {
      el.child(div().h(12).flex_none());
      // "All" has no sessions older than the collector's 31 days.
      el.child(this.title(rv.id === "all" ? "Biggest sessions, last 31 days" : "Biggest sessions", null, t));
      if (!rv.biggest?.length) el.child(div().h(ROW_H).text_size(BODY).text_color(t.dim).child("None in this range"));
      // As many whole rows as the column holds under the bars, SESSION_GAP apart.
      const left = lay.lower - 14 - (BARS_H + 16 + (rv.older ? 19 : 0)) - 12 - 28 - 4;
      const room = Math.floor((left + SESSION_GAP) / (SESSION_H + SESSION_GAP));
      const now = Date.now();
      const today = localMidnight(now), yesterday = localMidnight(today - 12 * HOUR_MS);
      (rv.biggest ?? []).slice(0, Math.max(1, room)).forEach((s, i) => {
        const d = localMidnight(s.last);
        const day = d === today ? "today" : d === yesterday ? "yesterday" : now - s.last < 6 * 86_400_000 ? short(s.last) : date(s.last);
        const bits = [this.name(s.p), day];
        if (s.sub > 0.5) bits.push("mostly subagents");
        const title = this.hide ? `Session ${i + 1}` : s.title ?? (s.agent === "codex" ? "Codex session" : "Untitled session");
        el.child(v_flex().flex_none().h(SESSION_H).when(i > 0, (d) => d.mt(SESSION_GAP))
          .child(h_flex().gap(8).items_center().text_size(BODY).line_height(1.3)
            .child(div().flex_1().min_w(0).truncate().child(title))
            .child(div().flex_none().font_family(MONO).child(tokens(s.tok)))
            .child(div().w(USD_W).flex_none().text_right().font_family(MONO).text_color(t.dim).child(s.cost > 0 ? money(s.cost, s.est) : "")))
          .child(h_flex().gap(5).items_center().text_size(LABEL).line_height(1.3).text_color(t.muted)
            .child(agentIcon(s.agent ?? "claude", 11))
            .child(div().min_w(0).truncate().child(bits.filter(Boolean).join(", ")))));
      });
    }
    return el;
  }

  bars(t, rv) {
    const range = RANGES.find((r) => r.id === rv.id);
    const el = v_flex().flex_none();
    if (rv.empty) return el.child(div().h(BARS_H + 16).flex().items_center().text_size(BODY).text_color(t.muted).child(range.empty));
    const order = rv.segKeys ?? [];
    // The tallest bar reaches the top; faint lines at round amounts under it.
    const scaleTop = rv.most || 1;
    const step = niceStep(scaleTop);
    const area = div().relative().h(BARS_H).flex_none();
    for (let k = 1; k <= 3; k++) {
      const yy = BARS_H - k * step / scaleTop * BARS_H;
      if (yy < 6) continue;
      area.child(div().absolute().left(BAR_GUTTER).right(0).top(yy).h(1).bg(fade(t.border, 0.5)));
      area.child(div().absolute().left(0).top(yy - 8).w(BAR_GUTTER - 8).text_right().whitespace_nowrap().text_size(LABEL).text_color(t.dim).font_family(MONO).child(tokens(k * step)));
    }
    area.child(div().absolute().left(BAR_GUTTER).right(0).top(BARS_H).h(1).bg(t.border));
    const rising = this.rise === "start" || this.rise === "go";
    const flat = this.rise === "start";
    const n = rv.bars.length;
    const gap = n <= 10 ? 6 : n <= 31 ? 3 : 2;
    const bars = h_flex().absolute().left(BAR_GUTTER).right(0).top(0).h(BARS_H).items_end();
    const labels = h_flex().h(16).ml(BAR_GUTTER);
    rv.bars.forEach((b, i) => {
      // The last bar (today, this hour, this week) is not over yet: drawn lighter.
      const open = i === n - 1;
      const stack = v_flex().w_full().justify_end().rounded_t(3).overflow_hidden();
      let top = true;
      for (let s = b.segs.length - 1; s >= 0; s--) {
        const v = b.segs[s];
        if (!v) continue;
        const h = v / scaleTop * BARS_H;
        if (h < 0.5) continue;
        const key = s < order.length ? order[s] : null;
        const lit = this.isLit(key);
        const c = key ? this.color(key, t) : t.dim;
        stack.child(div().id(`usage-seg-${i}-${s}`).flex_none().w_full().h(flat ? 0 : h).bg(fade(c, (lit ? 1 : 0.25) * (open ? 0.5 : 1)))
          .when(!top, (d) => d.border_t(1).border_color(t.popover))
          .when(rising, (d) => d.transition("height", { duration: RISE_MS, easing: "ease-out" })));
        top = false;
      }
      bars.child(h_flex().id(`usage-bar-${i}`).flex_1().min_w(0).h_full().px(gap / 2).items_end().justify_center()
        .when(this.hoverBar === i, (d) => d.bg(fade(t.hover, 0.7)))
        .on_hover((on, cx) => {
          if (on && this.hoverBar !== i) { this.hoverBar = i; cx.notify(); }
          else if (!on && this.hoverBar === i) { this.hoverBar = null; cx.notify(); }
        })
        .child(stack));
      const tick = this.barTick(rv, b, i, n);
      // Centered under its own bar; the last one's ends with it, so it is never cut.
      labels.child(div().flex_1().min_w(0).pt(3).flex().when(i === n - 1 && n > 10, (d) => d.justify_end()).when(i < n - 1 || n <= 10, (d) => d.justify_center())
        .text_size(LABEL).text_color(t.dim).whitespace_nowrap().child(tick ?? ""));
    });
    area.child(bars);
    el.child(area).child(labels);
    if (rv.older) {
      const o = rv.older;
      el.child(div().mt(2).text_size(LABEL).text_color(t.muted).truncate().child(
        `Before ${o.before ? date(o.before) : "the first transcript"}: ${commas(o.msgs)} messages, ${commas(o.sessions)} sessions${o.since ? ` since ${date(o.since)}` : ""}`));
    }
    return el;
  }

  // A row of the models and machines: name, a thin bar to the group's top row, figures.
  barRow(t, { id, name, indent, bar, color, T, part }) {
    const r = (id ? h_flex().id(id) : h_flex()).flex_none().h(ROW_H).gap(8).items_center().text_size(BODY)
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().pl(indent ?? 0).children(name))
      .child(div().w(TRACK_W).h(3).flex_none().child(div().h_full().rounded(1.5).w(Math.max(bar > 0 ? 1 : 0, Math.min(1, bar) * TRACK_W)).bg(color ?? t.muted)));
    if (T !== undefined) r.child(div().w(TOK_W).flex_none().text_right().whitespace_nowrap().font_family(MONO).child(tokens(T)));
    r.child(div().w(SHARE_W).flex_none().text_right().font_family(MONO).text_color(t.muted).child(share(part)));
    return r;
  }

  // A foldable group's header: a chevron, an agent's icon, its name, its figures (kept when
  // folded); a click folds or unfolds it. `big`: drawn as a column's title.
  groupHead(t, id, name, agent, figures, big = false) {
    const shut = Boolean(this.folds[id]);
    const el = h_flex().id(`usage-fold-${id}`).flex_none().h(big ? 22 : ROW_H).when(big, (d) => d.mb(6)).gap(6).px(4).mx(-4).rounded(4)
      .items_center().text_size(big ? SECTION : BODY).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => this.fold(id, cx))
      .child(svg(shut ? CHEVRON.shut : CHEVRON.open).size(10).flex_none().text_color(t.dim));
    if (agent) el.child(agentIcon(agent, 13));
    el.child(div().flex_1().min_w(0).truncate().font_semibold().child(name));
    for (const f of figures) el.child(f);
    return el;
  }

  // The models, by agent. With three columns, the third, the models scrolling over the machines
  // pinned under them; with two, the left half of the row under them.
  models(t, rv, lay) {
    const three = lay.three;
    const el = v_flex().id("usage-models-col").min_w(0).pt(14)
      .when(three, (d) => d.w("28%").h_full().pl(16).pr(PAD))
      .when(!three, (d) => d.w("50%").pl(PAD).pr(16));
    el.child(this.title("Models", null, t));
    if (!rv) return el;
    // The models scroll inside what is left (three columns); every share is of all the range's tokens.
    const list = three ? v_flex().id("usage-models").flex_1().min_h(0).overflow_y_scroll().pb(6) : v_flex().flex_none();
    const top = Math.max(rv.claude[0]?.share ?? 0, rv.codex[0]?.share ?? 0) || 1;
    const group = (agent, g, ms) => {
      if (!ms.length) return;
      list.child(this.groupHead(t, agent, AGENTS[agent], agent, [
        div().font_family(MONO).whitespace_nowrap().child(tokens(g.T)),
        div().w(USD_W).flex_none().text_right().font_family(MONO).text_color(t.dim).whitespace_nowrap().child(g.cost > 0 ? money(g.cost, g.est) : ""),
      ]));
      if (this.folds[agent]) return;
      // The models under 1% of the range's tokens are one last dim line, so both groups
      // normally show whole; the list still scrolls when they don't. A group's biggest model
      // always has its row, so no group is a header alone.
      const small = ms.slice(1).filter((m) => m.share < 0.01);
      const fold = small.length >= 2;
      for (const m of fold ? ms.filter((x, i) => i === 0 || x.share >= 0.01) : ms) {
        list.child(this.barRow(t, {
          name: [div().min_w(0).truncate().child(m.name), ...(m.priced ? [] : [div().flex_none().text_size(LABEL).text_color(t.dim).child("no price")])],
          indent: CHILD, bar: m.share / top, part: m.share,
        }));
      }
      if (fold) {
        const sum = small.reduce((a, m) => a + m.share, 0);
        list.child(div().flex_none().h(ROW_H).pl(CHILD).flex().items_center().text_size(LABEL).text_color(t.dim)
          .child(`${small.length} more, ${sum < 0.01 ? "<1%" : share(sum)}`));
      }
    };
    group("claude", rv.cgroup, rv.claude);
    if (rv.claude.length && rv.codex.length) list.child(div().h(4).flex_none());
    group("codex", rv.xgroup, rv.codex);
    el.child(list);
    if (three) el.child(this.machines(t, rv, true));
    return el;
  }

  // The machines, each with its dev containers (foldable), and the subagents' share. `pinned`:
  // under the models, never scrolling; else a column of its own.
  machines(t, rv, pinned) {
    // A section like Models: its title, then the machines drawn as Models draws its groups (a
    // chevron where there are containers to fold, the name in semibold, at the model rows'
    // indent), their containers one indent further.
    const el = v_flex().flex_none()
      .when(pinned, (d) => d.pt(10).pb(10).border_t(1).border_color(t.border))
      .when(!pinned, (d) => d.w("50%").min_w(0).pl(16).pr(PAD).pt(14));
    const ms = rv?.machines ?? [];
    el.child(this.title("Machines", null, t));
    if (!rv) return el;
    const topM = Math.max(...ms.map((m) => m.T), 1);
    const seen = new Set();
    ms.forEach((m) => {
      seen.add(m.m);
      if (m.box === null) {
        const boxes = ms.filter((x) => x.m === m.m && x.box !== null).length;
        const id = `machine:${m.m || "here"}`;
        const shut = Boolean(this.folds[id]);
        // A machine with containers folds them: a chevron before its name, their number when folded.
        const name = [
          boxes ? svg(shut ? CHEVRON.shut : CHEVRON.open).size(10).flex_none().text_color(t.dim) : div().w(10).flex_none(),
          div().min_w(0).truncate().font_semibold().child(this.machineName(m.m)),
          ...(boxes && shut ? [div().flex_none().text_size(LABEL).text_color(t.dim).child(`${boxes} ${boxes === 1 ? "container" : "containers"}`)] : []),
        ];
        const row = this.barRow(t, { id: boxes ? `usage-fold-${id}` : null, name, indent: 0, bar: m.T / topM, T: m.T, part: m.share });
        if (boxes) row.px(4).mx(-4).rounded(4).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.fold(id, cx));
        el.child(row);
        return;
      }
      if (this.folds[`machine:${m.m || "here"}`]) return;
      const name = [div().min_w(0).truncate().child(this.hide ? "container" : m.box), ...(this.hide ? [] : [div().flex_none().text_size(LABEL).text_color(t.dim).child("container")])];
      // One indent further than a model row: a machine has no icon, so its name is at CHILD.
      el.child(this.barRow(t, { name, indent: 2 * CHILD, bar: m.T / topM, T: m.T, part: m.share }));
    });
    for (const st of this.snap.machines ?? []) {
      if (seen.has(st.name)) continue;
      el.child(h_flex().flex_none().h(ROW_H).gap(10).pl(CHILD).items_center().text_size(BODY)
        .child(div().flex_1().truncate().font_semibold().child(this.machineName(st.name)))
        .child(div().text_color(t.dim).child(st.ok ? "idle" : "unreachable")));
    }
    // Docker or OrbStack did not answer: no dev container was read there.
    const docker = Object.entries(this.snap.docker ?? {}).filter(([, v]) => v !== "ok" && v !== "absent");
    for (const [m, v] of docker) {
      el.child(div().text_size(LABEL).text_color(t.dim).mt(2).child(`${this.machineName(m)}: ${v === "timeout" ? "Docker did not answer" : `Docker failed: ${v}`}`));
    }
    if (!docker.length && this.snap.blocked) el.child(div().text_size(LABEL).text_color(t.dim).mt(2).child("OrbStack did not answer"));
    if (rv.sub !== null && rv.sub !== undefined) {
      el.child(h_flex().flex_none().mt(4).text_size(BODY).text_color(t.muted)
        .child(div().child("Subagents: "))
        .child(div().font_family(MONO).text_color(t.foreground).child(share(rv.sub)))
        .child(div().child(" of the tokens")));
    }
    return el;
  }

  // ---------------------------------------------------------------- the year

  // "less ▢▢▢▢▢ more": the five steps of a heat map.
  heatKey(t, cell) {
    return h_flex().flex_none().gap(2).items_center().text_size(LABEL).text_color(t.dim)
      .child(div().mr(3).child("less"))
      .children(STEPS.map((a) => div().size(cell).flex_none().bg(fade(t.accent, a))))
      .child(div().ml(3).child("more"));
  }

  // Cells drawn as shapes, one per step: made once per data version and pitch. `split`: the
  // column before which the gap is twice as wide.
  gridPaths(name, steps, cols, rows, pw, ph, gap, split) {
    return this.shape(`${name}|${this.version}|${pw}|${ph}`, () => {
      const builders = Array.from({ length: 6 }, () => null);
      for (let c = 0; c < cols; c++) {
        const shift = split !== null && split !== undefined && c >= split ? gap : 0;
        for (let r = 0; r < rows; r++) {
          const s = steps[c * rows + r];
          if (s < 0 || s === undefined) continue;
          const x = c * pw + shift, y = r * ph;
          builders[s] ??= PathBuilder.fill();
          builders[s].add_polygon([[x, y], [x + pw - gap, y], [x + pw - gap, y + ph - gap], [x, y + ph - gap]], true);
        }
      }
      return builders.map((b) => (b ? b.build() : null));
    });
  }

  // The weekly limits with earlier weeks: [agent, weeks].
  earlierGroups() {
    return ["claude", "codex"].map((a) => [a, this.snap?.weeks?.[a]?.earlier ?? []]).filter(([, e]) => e.length);
  }

  // The year, across the whole width: the calendar (its cells as big as the width allows, within
  // PITCH_MIN and PITCH_MAX), the records, and the earlier weeks taking what is left, up to the
  // right edge. Narrow: the calendar, then the records and the earlier weeks under it.
  year(t, lay) {
    const y = this.snap?.year;
    const el = v_flex().flex_none().px(PAD).pt(10).pb(10).border_t(1).border_color(t.border).id("usage-year");
    if (!y) return el;
    const pitch = lay.pitch, cell = pitch - CELL_GAP;
    const split = y.split ?? null;
    const colX = (c) => c * pitch + (split !== null && c >= split ? CELL_GAP * 2 : 0);
    const g = this.gridPaths("year", y.steps, YEAR_WEEKS, 7, pitch, pitch, CELL_GAP, split);
    const gridW = colX(YEAR_WEEKS - 1) + pitch;
    const cal = v_flex().flex_none();
    const months = div().relative().h(15).ml(YEAR_LABELS).w(gridW);
    for (const [c, name] of y.months) months.child(div().absolute().left(colX(c)).top(0).text_size(LABEL - 1).text_color(t.dim).child(name));
    const days = div().relative().w(YEAR_LABELS).h(pitch * 7).flex_none();
    for (const [r, d] of [[0, "Mon"], [2, "Wed"], [4, "Fri"]]) days.child(div().absolute().left(0).top(r * pitch + cell / 2 - 7).text_size(LABEL - 1).text_color(t.dim).child(d));
    const cells = div().id("usage-year-cells").relative().w(gridW).h(pitch * 7).flex_none()
      .on_mouse_move((e, cx) => {
        const z = this.zoom();
        const lx = (e.local_position?.x ?? -1) / z, ly = (e.local_position?.y ?? -1) / z;
        const c = split !== null && lx >= colX(split) ? split + Math.floor((lx - colX(split)) / pitch) : Math.floor(lx / pitch), r = Math.floor(ly / pitch);
        const i = c >= 0 && c < YEAR_WEEKS && r >= 0 && r < 7 && y.steps[c * 7 + r] >= 0 ? c * 7 + r : null;
        if (i !== this.hoverDay) { this.hoverDay = i; cx.notify(); }
      })
      .on_hover((on, cx) => { if (!on && this.hoverDay !== null) { this.hoverDay = null; cx.notify(); } });
    (g ?? []).forEach((p, st) => { if (p) cells.child(window.paint_path(p, st === 0 ? fade(t.hover, 0.6) : fade(t.accent, STEPS[st - 1])).absolute().top(0).left(0).size_full()); });
    if (this.hoverDay !== null) {
      const c = Math.floor(this.hoverDay / 7), r = this.hoverDay % 7;
      cells.child(div().absolute().left(colX(c) - 1).top(r * pitch - 1).size(cell + 2).border(1).border_color(t.foreground));
    }
    cal.child(months).child(h_flex().items_start().child(days).child(cells));
    cal.child(h_flex().mt(5).ml(YEAR_LABELS).w(gridW).h(14).gap(12).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(LABEL).text_color(t.dim).child(this.hoverDay !== null ? this.dayWords(y, this.hoverDay) : y.caption))
      .child(this.heatKey(t, cell)));
    // The title and the records.
    const rec = y.records;
    const groups = this.earlierGroups();
    const recs = v_flex().min_w(0).child(this.title("The year", null, t))
      .when(groups.length > 0, (d) => d.w(RECORDS_W).flex_none())
      .when(!groups.length, (d) => d.flex_1());
    const line = (label, value) => recs.child(h_flex().h(ROW_H).items_center().text_size(BODY)
      .child(div().flex_1().text_color(t.dim).child(label)).child(div().font_family(MONO).child(value)));
    if (rec) {
      line("Busiest day", rec.busiest ? `${date(rec.busiest.day)}, ${tokens(rec.busiest.T)}` : "—");
      line("Active days", rec.days ? `${rec.active} of ${rec.days}` : "—");
      line("Longest streak", `${rec.streak} ${rec.streak === 1 ? "day" : "days"}`);
    }
    // The earlier weeks, per agent, once there are any: to the right edge. One agent's bars are
    // twice as tall, so the block is as tall with one agent as with two.
    let ew = null;
    if (groups.length) {
      // The hovered week's days and peak, at the title's right end: a line reserved already.
      const hw = this.hoverWeek;
      const said = hw ? `${groups.length > 1 ? `${AGENTS[hw.agent]}, ` : ""}${weekSpan(hw.resets)}: ${hw.peak >= 100 ? "ran dry" : `${Math.round(hw.peak)}%`}` : null;
      ew = v_flex().flex_1().min_w(0).child(this.title("Earlier weeks", said, t));
      const h = groups.length === 1 ? 2 * EARLIER_H + 8 : EARLIER_H;
      // One pitch for both rows, from the room between the label and the percentage and the
      // longer row, so the rows' weeks line up from the newest.
      const areaW = Math.max(EARLIER_PITCH_MIN, lay.earlierW - EARLIER_LABEL - 8 - 6 - EARLIER_PCT);
      const most = Math.min(Math.max(...groups.map(([, e]) => e.length)), Math.floor(areaW / EARLIER_PITCH_MIN));
      const pitch = Math.min(areaW / most, EARLIER_BAR_MAX / 0.7);
      groups.forEach(([agent, earlier], i) => ew.child(this.earlierWeeks(t, agent, earlier.slice(-most), h, pitch).when(i > 0, (d) => d.mt(8))));
    }
    if (lay.yearOne) {
      const row = h_flex().items_start().gap(YEAR_GAP).child(cal).child(recs);
      if (ew) row.child(ew);
      return el.child(row);
    }
    const under = h_flex().mt(14).items_start().gap(YEAR_GAP).child(recs);
    if (ew) under.child(ew);
    return el.child(cal).child(under);
  }

  // An agent's weeks before this one, oldest left, on one scale to 100%, colored by where they
  // ended, `h` px tall, `pitch` apart, the newest against the percentage. A week that ran dry
  // has a cap in the foreground color on its bar, so it doesn't differ from a tight one by color
  // alone. The pointer on a week names it in the title (hoverWeek).
  earlierWeeks(t, agent, shown, h, pitch) {
    const bw = Math.max(4, Math.min(EARLIER_BAR_MAX, Math.round(pitch * 0.7)));
    // Each week a bar on a track of the full height, so a low week reads as low.
    const area = div().relative().h(h).w(Math.ceil(shown.length * pitch)).flex_none();
    shown.forEach((wk, i) => {
      const v = Math.max(2, Math.min(100, wk.peak) / 100 * h);
      const on = this.hoverWeek?.agent === agent && this.hoverWeek?.resets === wk.resets;
      const bar = div().id(`usage-ew-${agent}-${i}`).absolute().left(Math.round(i * pitch + (pitch - bw))).top(0).w(bw).h(h)
        .on_hover((hov, cx) => {
          if (hov) { if (!on) { this.hoverWeek = { agent, resets: wk.resets, peak: wk.peak }; cx.notify(); } }
          else if (this.hoverWeek?.agent === agent && this.hoverWeek?.resets === wk.resets) { this.hoverWeek = null; cx.notify(); }
        })
        .child(div().absolute().left(0).top(0).w(bw).h(h).rounded(1.5).bg(on ? t.selected : t.hover))
        .child(div().absolute().left(0).top(h - v).w(bw).h(v).rounded(1.5).bg(levelColor(endLevel(wk.peak), t)));
      if (wk.peak >= 100) bar.child(div().absolute().left(0).top(0).w(bw).h(2).rounded_t(1.5).bg(t.foreground));
      area.child(bar);
    });
    const last = shown[shown.length - 1];
    return h_flex().h(h).items_end().text_size(LABEL)
      .child(h_flex().w(EARLIER_LABEL).flex_none().gap(6).items_center().text_color(t.muted).child(agentIcon(agent, 12)).child(div().child(AGENTS[agent])))
      .child(div().flex_1().min_w(8))
      .child(area)
      .child(div().w(EARLIER_PCT).ml(6).flex_none().text_right().text_color(t.dim).font_family(MONO).child(`${Math.round(last.peak)}%`));
  }

  dayWords(y, i) {
    const d = shiftDay(y.first, i);
    const v = y.vals[i];
    const name = `${WEEKDAYS[new Date(d).getDay()]} ${date(d)}`;
    if (!v) return `${name}: no record`;
    const [T, cost, msgs] = v;
    if (msgs) return `${date(d)}: ${commas(msgs)} messages`;
    return `${name}: ${tokens(T)} tokens${cost > 0 ? `, ${money(cost)}` : ""}`;
  }

  // ---------------------------------------------------------------- the layout

  // The layout for the dialog's size (px at zoom 1, from the root's on_size_change): whether the
  // charts sit side by side, whether the lower zone has three columns and the year one row, the
  // calendar's pitch, the earlier weeks' width, and the heights of the charts and of the lower
  // columns. When everything fits, the charts get what the lower columns leave over their least;
  // when it doesn't, the charts fill the first screen with the zone "will it last" and the rest
  // scrolls.
  fit() {
    const W = this.dims?.width ?? 1280, H = this.dims?.height ?? 1040;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
    const n = this.snap ? this.reading().rulers.length : 2;
    const rulersH = n ? n * RULER_H + (n - 1) * RULER_GAP : NAME_H;
    const earlier = this.earlierGroups().length > 0;
    const yearOne = W >= YEAR_ONE_ROW;
    const inner = W - 2 * PAD;
    const calRoom = inner - YEAR_LABELS - (yearOne ? YEAR_GAP + RECORDS_W + (earlier ? YEAR_GAP + EARLIER_W_MIN : 0) : 0);
    const pitch = clamp(Math.floor(calRoom / YEAR_WEEKS), PITCH_MIN, PITCH_MAX);
    const calW = YEAR_LABELS + YEAR_WEEKS * pitch + 2 * CELL_GAP;
    const earlierW = yearOne ? inner - calW - YEAR_GAP - RECORDS_W - YEAR_GAP : inner - RECORDS_W - YEAR_GAP;
    const yearH = 1 + 10 + 15 + 7 * pitch + 5 + 14 + 10 + (yearOne ? 0 : 14 + 28 + 3 * ROW_H);
    const three = W >= THREE_COLUMNS;
    const burn = this.burnLines();
    const one = HEAD_H + HEADLINE_H + rulersH + CHART_FIXED + burnH(burn) + (this.failed ? 36 : 0);
    const spare = H - one - 1 - TOOLBAR_H - yearH;
    let chart, lower;
    if (three && spare >= CHART_MIN + LOWER_MIN) {
      chart = clamp(spare - LOWER_MIN, CHART_MIN, CHART_MAX);
      lower = clamp(spare - chart, LOWER_MIN, LOWER_MAX);
    } else {
      chart = clamp(H - one - 6, CHART_MIN, CHART_MAX - 20);
      lower = LOWER_MIN;
    }
    return { W, H, wide: W >= WIDE_CHARTS, three, yearOne, pitch, earlierW, chart, lower, burn };
  }

  // Burning now's lines, the same for every chart: as many as the fuller agent has (its rows and
  // its "N more" line), at least one.
  burnLines() {
    const r = this.snap?.recent;
    if (!r) return 1;
    let most = 1;
    for (const agent of this.weekly()) { const b = r[agent]; if (b) most = Math.max(most, b.rows.length + (b.more > 0 ? 1 : 0)); }
    return most;
  }

  // ---------------------------------------------------------------- render

  render(cx) {
    if (this.glance) return this.glance.render(cx);
    const t0 = Date.now();
    const el = this.draw(cx);
    this.drawMost = Math.max(this.drawMost, Date.now() - t0);
    return el;
  }

  draw(cx) {
    const t = theme();
    this.relink(cx);
    const rv = this.snap ? this.ensure(cx) : null;
    this.colors = this.palette(rv ?? this.snap?.ranges?.[this.range]);
    const range = RANGES.find((r) => r.id === this.range);
    const lay = this.fit();
    const root = v_flex().id("usage").size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(BODY)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => {
        const z = this.zoom();
        const d = { width: size.width / z, height: size.height / z };
        if (!this.dims || Math.abs(d.width - this.dims.width) > 1 || Math.abs(d.height - this.dims.height) > 1) { this.dims = d; cx.notify(); }
      })
      .child(this.header(t));
    const body = v_flex().id("usage-body").flex_1().min_h(0).overflow_y_scroll();
    if (this.failed) {
      body.child(h_flex().flex_none().px(PAD).py(8).gap(12).items_center().border_b(1).border_color(t.border).text_size(BODY)
        .child(div().flex_1().min_w(0).truncate().text_color(t.ansi1).child(this.failed))
        .child(div().id("usage-retry").px(8).py(3).rounded(5).cursor_pointer().text_color(t.muted)
          .hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => cx.spawn(async (cx) => this.collect(cx)))
          .child("Try again")));
    }
    // Zone one: will it last.
    body.child(this.headline(t));
    body.child(this.rulers(t));
    body.child(this.charts(t, lay));
    // Zone two: where it went. Three columns, or two with Models and Machines under them.
    const two = v_flex().flex_none().pt(10).border_t(1).border_color(t.border).child(this.toolbar(t, rv, range, lay));
    const top = h_flex().flex_none().h(lay.lower).child(this.projects(t, rv, lay)).child(this.middle(t, rv, lay));
    if (lay.three) two.child(top.child(this.models(t, rv, lay)));
    else two.child(top).child(h_flex().flex_none().items_start().pb(12).child(this.models(t, rv, lay)).child(this.machines(t, rv, false)));
    body.child(two);
    // Zone three: the year.
    body.child(this.year(t, lay));
    this.build(cx);
    return root.child(body);
  }
}
