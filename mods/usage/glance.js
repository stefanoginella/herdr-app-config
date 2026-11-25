// The glances of the limits: the sidebar widget (props `{ role: "side" }`) and the status bar's
// end (props `{ role: "bar" }`). A click on either opens the dialog.
//
// They never run the collector. Every TICK, while Herdr is the active app, they read the
// statusline's cache file (a few hundred bytes) and its age for Claude; every CODEX_EVERY, one
// small `sh` (CODEX_READ) prints the last rate_limits line of the newest Codex session file, and
// without one the dialog's snapshot stands in. They work the readings out with pace.js
// (limits.js) and draw again only when what they show changed.
//
// Sidebar: one row per agent with a reading (the two most in danger; "Claude 5h" when that
// agent's worst window is the short one), each with its agent's icon; then the verdict of the
// limit most in danger, after that agent's icon ("both on pace", without one, when two readings
// are both on pace), the working agents and the last hour's burn. With one reading, the older
// layout: its name and percentage, its track, its words. The rail: the worst limit's percentage
// and track. The status bar: each agent's icon and percentage, the worst one's words after its
// own ("on pace" first, alone, when both are).

import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile, exec, home, theme, settings, layout, run, checking, agents, window as app } from "herdr";
import { fromCache, limitBlock, short, levelColor, WEEKDAYS, clock, byDanger, danger } from "./limits.js";
import { WEEK_MS, HOUR_MS, burn, formatRate } from "./pace.js";

const CACHE = () => `${home()}/.claude/statusline/.usage-cache.json`;
const SNAPSHOT = () => `${home()}/.local/state/herdr-usage/view.json`;
const CODEX_SESSIONS = () => `${home()}/.codex/sessions`;
const TICK = 60_000;
const CODEX_EVERY = 5 * 60_000;
// A Claude reading older than this is drawn dim, with its time.
const OLD = 6 * 3_600_000;
// Readings of a Codex window whose resets are this close are of the same window.
const JITTER = 3 * HOUR_MS;
// The newest Codex session file of the last two day folders (<year>/<month>/<day>), and the last
// line of its tail with a reading. The folder is the script's argument, never part of its text.
const CODEX_READ = `cd "$1" 2>/dev/null || exit 0
set --
for d in $(ls -d [0-9]*/[0-9]*/[0-9]* 2>/dev/null | sort | tail -n 2); do
  for f in "$d"/*.jsonl; do [ -f "$f" ] && set -- "$@" "$f"; done
done
[ $# -gt 0 ] || exit 0
f=$(ls -1t "$@" | head -n 1)
tail -c 524288 "$f" | grep '"rate_limits":{' | tail -n 1`;
const MONO = () => settings()?.font_family ?? "JetBrains Mono";
// The agents' own icons, in full color, from the app's home.
export const ICON = { claude: "icons/claude.svg", codex: "icons/codex.svg" };
export const agentIcon = (agent, size) => image(ICON[agent] ?? ICON.claude).w(size).h(size).flex_none();

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}
// The sidebar's rail goes by its width, as in space-folders.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// A rate_limits line of a Codex session file: { at, week, short } (each { pct, resets, windowMs }).
export function codexLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const rl = o?.payload?.rate_limits;
  if (!rl || typeof rl !== "object") return null;
  const at = Date.parse(o.timestamp);
  const ws = [rl.primary, rl.secondary].filter((x) => x && typeof x.used_percent === "number" && typeof x.resets_at === "number" && x.window_minutes > 0)
    .map((x) => ({ pct: x.used_percent, resets: x.resets_at * 1000, windowMs: x.window_minutes * 60_000 }));
  return { at: Number.isFinite(at) ? at : null, week: ws.find((x) => x.windowMs === WEEK_MS) ?? null, short: ws.find((x) => x.windowMs < 86_400_000) ?? null };
}

// The fresher of two readings of a window; of the same window, the higher.
function fresher(a, b) {
  if (!a?.r) return b; if (!b?.r) return a;
  if (Math.abs(a.r.resets - b.r.resets) <= JITTER) return a.r.pct >= b.r.pct ? a : b;
  return (a.at ?? 0) >= (b.at ?? 0) ? a : b;
}

export default class Glance {
  init(cx, role) {
    this.role = role;
    this.reading = null;   // fromCache(), or null
    this.age = null;       // ms since the cache file was written, when known
    this.codex = null;     // { at, week, short }: the fresher of the session file's and the snapshot's
    this.codexAt = 0;
    this.sig = null;
    this.shown = null;     // what render() draws: worked out in look()
    if (checking()) return;
    cx.spawn(async (cx) => { await this.look(cx, true); });
    cx.timer.every(TICK, (cx) => {
      if (app()?.active === false) return;
      cx.spawn(async (cx) => this.look(cx, false));
    });
  }

  async look(cx, first) {
    const now = Date.now();
    let text = null, mtime = null;
    try { text = await readTextFile(CACHE()); } catch {}
    try {
      const mac = app()?.platform !== "linux";
      const r = await exec("stat", mac ? ["-f", "%m", CACHE()] : ["-c", "%Y", CACHE()], { timeout: 5000 });
      const s = Number(r.stdout.trim());
      if (r.code === 0 && Number.isFinite(s)) mtime = s * 1000;
    } catch {}
    if (first || now - this.codexAt >= CODEX_EVERY) {
      this.codexAt = now;
      this.codex = await this.readCodex();
    }
    this.reading = text ? fromCache(text) : null;
    this.age = mtime !== null ? now - mtime : null;
    const shown = this.work(now);
    const sig = JSON.stringify(shown);
    if (sig !== this.sig) { this.sig = sig; this.shown = shown; cx.notify(); }
  }

  // Codex's reading: the newest session file's, else the snapshot's; per window, the fresher.
  async readCodex() {
    let file = null, snap = null;
    try {
      const r = await exec("sh", ["-c", CODEX_READ, "sh", CODEX_SESSIONS()], { timeout: 5000 });
      if (r.code === 0 && r.stdout.trim()) file = codexLine(r.stdout.trim().split("\n").pop());
    } catch {}
    try {
      const s = JSON.parse(await readTextFile(SNAPSHOT()) ?? "null");
      const w = s?.weeks?.codex;
      const lx = s?.codex;
      const sh = [lx?.primary, lx?.secondary].find((x) => x && x.pct != null && x.resets && x.windowMinutes && x.windowMinutes < 1440);
      snap = {
        at: lx?.at ?? null,
        week: w && !w.none ? { pct: w.pct, resets: w.end, windowMs: WEEK_MS } : null,
        short: sh ? { pct: sh.pct, resets: sh.resets, windowMs: sh.windowMinutes * 60_000 } : null,
      };
    } catch {}
    if (!file && !snap) return null;
    const pick = (k) => fresher(file && { at: file.at, r: file[k] }, snap && { at: snap.at, r: snap[k] })?.r ?? null;
    return { week: pick("week"), short: pick("short") };
  }

  // What is drawn, as plain values: compared with the last to decide whether to draw again.
  work(now) {
    const r = this.reading;
    const old = this.age !== null && this.age > OLD;
    const blocks = [];
    const add = (agent, label, x, windowMs) => {
      const b = x ? limitBlock(x.pct, x.resets, windowMs, now) : null;
      if (b) blocks.push({ agent, label, b });
    };
    add("claude", "Claude", r && r.pct != null ? { pct: r.pct, resets: r.resets } : null, WEEK_MS);
    add("claude", "Claude 5h", r?.fiveHour?.pct != null && r.fiveHour.resets ? r.fiveHour : null, 5 * HOUR_MS);
    add("codex", "Codex", this.codex?.week, WEEK_MS);
    if (this.codex?.short) add("codex", "Codex 5h", this.codex.short, this.codex.short.windowMs);
    // Each agent's worst window, then the two most in danger.
    const perAgent = [];
    for (const agent of ["claude", "codex"]) {
      const worst = byDanger(blocks.filter((x) => x.agent === agent), (x) => x.b)[0];
      if (worst) perAgent.push(worst);
    }
    const rows = byDanger(perAgent, (x) => x.b).slice(0, 2);
    if (!rows.length) return { none: true };
    const worst = rows[0];
    const dimOf = (x) => x.agent === "claude" && old;
    const row = (x) => ({
      agent: x.agent, label: x.label, pct: Math.round(x.b.pct), even: Math.round(x.b.even * 2) / 2, level: x.b.level, old: dimOf(x),
      week: x.label === "Claude" || x.label === "Codex",
    });
    // Two readings, neither in any danger: the words speak for both, without an icon.
    const both = rows.length > 1 && rows.every((x) => danger(x.b)[0] === 0 && x.b.level === "ok") && !dimOf(worst);
    const bu = r && !old ? burn({ pct: r.pct, resets: r.resets, samples: r.samples }, now - (this.age ?? 0), now) : null;
    return {
      rows: rows.map(row),
      words: dimOf(worst) ? `as of ${WEEKDAYS[new Date(now - this.age).getDay()]} ${clock(now - this.age)}` : both ? "both on pace" : short(worst.b, now),
      bar: short(worst.b, now, true), level: worst.b.level, old: dimOf(worst), agent: both ? null : worst.agent,
      burn: bu ? `${formatRate(bu.perHour)}%/h` : null,
      // Each agent's percentage, for the status bar: its weekly one when there is one.
      each: ["claude", "codex"].map((a) => blocks.find((x) => x.agent === a && (x.label === "Claude" || x.label === "Codex")) ?? blocks.find((x) => x.agent === a))
        .filter(Boolean).map((x) => ({ agent: x.agent, pct: Math.round(x.b.pct), old: dimOf(x) })),
    };
  }

  render(_cx) {
    const t = theme();
    const s = this.shown ?? { none: true };
    return this.role === "bar" ? this.bar(t, s) : narrow() ? this.rail(t, s) : this.side(t, s);
  }

  open() { run("mod.open", { name: "usage" }); }

  track(t, x, h, tickH) {
    const color = x.old ? t.dim : levelColor(x.level, t);
    return div().relative().w_full().h(h).flex_none().rounded(h / 2).bg(t.hover)
      .child(div().absolute().left(0).top(0).h_full().w(`${Math.max(0, Math.min(100, x.pct))}%`).rounded(h / 2).bg(color))
      .when(tickH > 0, (d) => d.child(div().absolute().left(`${Math.max(0, Math.min(100, x.even))}%`).top((h - tickH) / 2).w(2).h(tickH).ml(-1).bg(x.old ? t.dim : t.foreground)));
  }

  wordsColor(t, s) { return s.old ? t.dim : s.level === "ok" ? t.muted : levelColor(s.level, t); }

  side(t, s) {
    const el = v_flex().id("usage-side").size_full().px(16).justify_center().gap(4).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click(() => this.open());
    if (s.none) return el.child(div().text_size(11.5).text_color(t.dim).child("No reading yet"));
    const mono = MONO();
    if (s.rows.length === 1) {
      // One reading: its name and percentage, its track, its words.
      const x = s.rows[0];
      el.child(h_flex().gap(5).items_center()
        .child(agentIcon(x.agent, 12))
        .child(div().flex_1().text_size(11.5).text_color(x.old ? t.dim : t.muted).child(x.week ? `${x.label} week` : x.label))
        .child(div().font_family(mono).text_size(13).font_semibold().text_color(x.old ? t.dim : t.foreground).child(`${x.pct}%`)));
      el.child(this.track(t, x, 4, 8));
      return el.child(this.foot(t, s));
    }
    // One row a limit: name, a track with the even pace's tick, the percentage.
    el.gap(5);
    for (const x of s.rows) {
      el.child(h_flex().h(13).gap(8).items_center()
        .child(h_flex().w(74).flex_none().gap(5).items_center()
          .child(agentIcon(x.agent, 12))
          .child(div().text_size(11.5).text_color(x.old ? t.dim : t.muted).child(x.label)))
        .child(div().flex_1().min_w(0).child(this.track(t, x, 4, 8)))
        .child(div().w(32).flex_none().text_right().font_family(mono).text_size(12).font_semibold().text_color(x.old ? t.dim : t.foreground).child(`${x.pct}%`)));
    }
    return el.child(this.foot(t, s));
  }

  // The verdict of the limit most in danger; the working agents and the last hour's burn.
  foot(t, s) {
    const working = agents().filter((a) => a.status === "working").length;
    const last = h_flex().gap(6).items_center().text_size(11.5)
      .when(Boolean(s.agent), (d) => d.child(agentIcon(s.agent, 12)))
      .child(div().flex_1().min_w(0).truncate().text_color(this.wordsColor(t, s)).child(s.words));
    if (working > 0) {
      last.child(div().size(5).rounded(2.5).flex_none().bg(t.working).loop("opacity", { from: 0.25, to: 1, period: 1600 }))
        .child(div().flex_none().text_color(t.muted).child(String(working)));
    }
    if (s.burn) last.child(div().flex_none().font_family(MONO()).text_size(11).text_color(t.muted).child(s.burn));
    return last;
  }

  rail(t, s) {
    const el = v_flex().id("usage-rail").size_full().items_center().justify_center().gap(5).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click(() => this.open());
    if (s.none) return el.child(div().text_size(11.5).text_color(t.dim).child("—"));
    const x = s.rows[0];
    return el
      .child(div().font_family(MONO()).text_size(13).font_semibold().text_color(x.old ? t.dim : levelColor(x.level, t)).child(`${x.pct}%`))
      .child(div().w(28).child(this.track(t, x, 3, 0)));
  }

  // The status bar's end, drawn as workspace-status draws the rest of the bar: each agent's icon
  // and percentage, the words of the limit most in danger after its own agent's.
  bar(t, s) {
    const el = h_flex().id("usage-bar").size_full().px(14).gap(6).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted).cursor_pointer()
      .hover((st) => st.text_color(t.foreground))
      .on_click(() => this.open());
    if (s.none) return el.child(div().text_color(t.dim).child("no limit reading"));
    const tone = s.old ? t.dim : s.level === "ok" ? t.muted : levelColor(s.level, t);
    if (!s.agent) el.child(div().size(6).rounded(3).flex_none().bg(s.old ? t.dim : levelColor(s.level, t))).child(div().mr(6).text_color(tone).child(s.old ? s.words : s.bar));
    s.each.forEach((x, i) => {
      el.child(i > 0 ? agentIcon(x.agent, 12).ml(10) : agentIcon(x.agent, 12))
        .child(div().text_color(x.old ? t.dim : t.foreground).child(`${x.pct}%`));
      if (s.agent === x.agent) el.child(div().text_color(t.dim).child("·")).child(div().text_color(tone).child(s.old ? s.words : s.bar));
    });
    return el;
  }
}
