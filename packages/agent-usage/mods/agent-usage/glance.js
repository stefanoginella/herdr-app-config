// The glance of the limits: the sidebar widget (props `{ role: "side" }`). A click on it opens
// the dialog.
//
// They never run a collection. Every TICK, while Herdr is the active app, they run the collector's
// limits step for Claude (`collect.mjs --limits`: the statusline's cache file, a few hundred
// bytes, and limits.json, so the widget believes what the dialog does, a reset of the limit
// too); without node, they read the cache file and its age themselves. Every CODEX_EVERY, one
// small `sh` (CODEX_READ) prints the last rate_limits line of the newest Codex session file, and
// without one the dialog's snapshot stands in. Every dashboard collection publishes its limits
// to the widget. Its refresh button reads both agents immediately using the same light poll.
//
// Sidebar: one row per agent with a reading (the two most in danger; "Claude 5h" when that
// agent's worst window is the short one), each with its agent's icon; then the verdict of the
// limit most in danger, after that agent's icon ("both on pace", without one, when two readings
// are both on pace), the working agents and the last hour's burn. With one reading, the older
// layout: its name and percentage, its track, its words. The rail: the worst limit's percentage
// and track.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile, exec, home, appHome, theme, settings, layout, run, checking, agents, shared, setShared, window as app } from "herdr";
import { fromCache, limitBlock, short, levelColor, WEEKDAYS, clock, byDanger, danger } from "./limits.js";
import { WEEK_MS, HOUR_MS, burn, formatRate } from "./pace.js";

const CACHE = () => `${home()}/.claude/statusline/.usage-cache.json`;
const COLLECT = () => `${appHome()}/mods/agent-usage/collect.mjs`;
// The limits step waits for the state folder's lock while a collection holds it (up to 15 s).
const LIMITS_TIMEOUT = 20_000;
const SNAPSHOT = () => `${home()}/.local/state/herdr-usage/view.json`;
const CODEX_SESSIONS = () => `${home()}/.codex/sessions`;
const DASHBOARD_LIMITS = "agent-usage.limits";
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

function snapshotCodex(s) {
  const w = s?.weeks?.codex;
  const lx = s?.codex;
  const sh = [lx?.primary, lx?.secondary].find((x) => x && x.pct != null && x.resets && x.windowMinutes && x.windowMinutes < 1440);
  return {
    at: lx?.at ?? null,
    week: w && !w.none ? { pct: w.pct, resets: w.end, windowMs: WEEK_MS } : null,
    short: sh ? { pct: sh.pct, resets: sh.resets, windowMs: sh.windowMinutes * 60_000 } : null,
  };
}

export function publishLimits(s) {
  if ((shared(DASHBOARD_LIMITS)?.at ?? 0) >= s.at) return;
  const w = s.weeks.claude;
  const claude = w?.at != null ? { at: w.at, pct: w.pct ?? null, resets: w.end ?? null, samples: w.samples ?? [], fiveHour: w.fiveHour ?? null } : null;
  setShared(DASHBOARD_LIMITS, { at: s.at, claude, codex: snapshotCodex(s) });
}

export default class Glance {
  init(cx, role) {
    this.role = role;
    this.reading = null;   // Claude's limits and the time of their reading
    this.codex = null;     // { at, week, short }: the fresher of the session file's and the snapshot's
    this.codexAt = 0;
    this.dashboardAt = 0;
    this.pollId = 0;
    this.refreshing = false;
    this.sig = null;
    this.shown = null;     // what render() draws: worked out in look()
    if (checking()) return;
    cx.spawn(async (cx) => { await this.look(cx, true); });
    cx.timer.every(TICK, (cx) => {
      if (app()?.active === false) return;
      cx.spawn(async (cx) => this.look(cx, false));
    });
  }

  syncDashboard(now) {
    const update = shared(DASHBOARD_LIMITS);
    if (!update || update.at <= this.dashboardAt) return false;
    this.dashboardAt = update.at;
    this.reading = update.claude;
    this.codex = update.codex;
    this.codexAt = update.at;
    return this.updateShown(now);
  }

  async look(cx, forceCodex, manual = false) {
    if (this.refreshing) return;
    const id = ++this.pollId;
    if (manual) {
      this.refreshing = true;
      cx.notify();
    }
    const now = Date.now();
    if (this.syncDashboard(now)) cx.notify();
    const dashboardAt = this.dashboardAt;
    try {
      const checkCodex = forceCodex || now - this.codexAt >= CODEX_EVERY;
      const [local, codex] = await Promise.all([this.readClaude(), checkCodex ? this.readCodex() : this.codex]);
      if (this.syncDashboard(Date.now())) cx.notify();
      // A dashboard collection or a manual refresh can finish while a poll is in flight.
      if (id !== this.pollId || dashboardAt !== this.dashboardAt) return;
      const collected = shared(DASHBOARD_LIMITS)?.claude;
      // The limits step's reading is the newest of the collector's rule: it stands. Read from the
      // file alone, the local stat only has whole seconds: keep the collected peak for the same week.
      if (local?.checked) this.reading = local;
      else if (local && (local.at == null || local.at + 999 >= (collected?.at ?? 0))) {
        if (local.resets === collected?.resets) local.pct = Math.max(local.pct, collected.pct);
        this.reading = local;
      } else this.reading = collected ?? null;
      this.codex = codex;
      if (checkCodex) this.codexAt = now;
      if (this.updateShown(Date.now())) cx.notify();
    } finally {
      if (manual) {
        this.refreshing = false;
        cx.notify();
      }
    }
  }

  updateShown(now) {
    const shown = this.work(now);
    const sig = JSON.stringify(shown);
    if (sig === this.sig) return false;
    this.sig = sig;
    this.shown = shown;
    return true;
  }

  // Claude's reading: the collector's limits step, else the cache file alone (the highest of the
  // window, fromCache).
  async readClaude() {
    try {
      const r = await exec("node", [COLLECT(), "--limits"], { timeout: LIMITS_TIMEOUT });
      const c = r.code === 0 ? JSON.parse(r.stdout)?.limits?.claude : undefined;
      if (c === null) return null;
      if (c && typeof c === "object") {
        const w = c.week;
        return w && w.pct != null ? { pct: w.pct, resets: w.resets, samples: w.samples ?? [], fiveHour: c.fiveHour ?? null, at: c.at ?? null, checked: true } : null;
      }
    } catch {}
    let reading, at = null;
    try { reading = fromCache(await readTextFile(CACHE())); } catch {}
    if (!reading) return null;
    try {
      const mac = app()?.platform !== "linux";
      const r = await exec("stat", mac ? ["-f", "%m", CACHE()] : ["-c", "%Y", CACHE()], { timeout: 5000 });
      const s = Number(r.stdout.trim());
      if (r.code === 0 && Number.isFinite(s)) at = s * 1000;
    } catch {}
    return { ...reading, at };
  }

  // Codex's reading: the newest session file's, else the snapshot's; per window, the fresher.
  async readCodex() {
    let file = null, snap = shared(DASHBOARD_LIMITS)?.codex ?? null;
    try {
      const r = await exec("sh", ["-c", CODEX_READ, "sh", CODEX_SESSIONS()], { timeout: 5000 });
      if (r.code === 0 && r.stdout.trim()) file = codexLine(r.stdout.trim().split("\n").pop());
    } catch {}
    if (!snap) {
      try { snap = snapshotCodex(JSON.parse(await readTextFile(SNAPSHOT()) ?? "null")); } catch {}
    }
    if (!file && !snap) return null;
    const pick = (k) => fresher(file && { at: file.at, r: file[k] }, snap && { at: snap.at, r: snap[k] })?.r ?? null;
    return { week: pick("week"), short: pick("short") };
  }

  // What is drawn, as plain values: compared with the last to decide whether to draw again.
  work(now) {
    const r = this.reading;
    const old = r?.at != null && now - r.at > OLD;
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
    const bu = r && !old ? burn(r, r.at ?? now, now) : null;
    return {
      rows: rows.map(row),
      words: dimOf(worst) ? `as of ${WEEKDAYS[new Date(r.at).getDay()]} ${clock(r.at)}` : both ? "both on pace" : short(worst.b, now),
      level: worst.b.level, old: dimOf(worst), agent: both ? null : worst.agent,
      burn: bu ? `${formatRate(bu.perHour)}%/h` : null,
    };
  }

  render(_cx) {
    this.syncDashboard(Date.now());
    const t = theme();
    const s = this.shown ?? { none: true };
    return narrow()
      ? v_flex().size_full().items_center().pb(2).child(this.rail(t, s)).child(this.refreshButton(t))
      : this.side(t, s);
  }

  open() { run("mod.open", { name: "agent-usage" }); }

  refreshButton(t) {
    const b = div().id("usage-refresh").size(18).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.muted)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!this.refreshing) cx.spawn(async (cx) => this.look(cx, true, true));
      });
    if (this.refreshing) return b.tooltip("Refreshing usage").child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900));
    return b.cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .tooltip("Refresh usage").child(svg("mods/agent-usage/refresh.svg").size(12));
  }

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
    if (s.none) return el.child(h_flex().items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.dim).child("No reading yet"))
      .child(this.refreshButton(t)));
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
    return last.child(this.refreshButton(t));
  }

  rail(t, s) {
    const el = v_flex().id("usage-rail").flex_1().w_full().items_center().justify_center().gap(5).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click(() => this.open());
    if (s.none) return el.child(div().text_size(11.5).text_color(t.dim).child("—"));
    const x = s.rows[0];
    return el
      .child(div().font_family(MONO()).text_size(13).font_semibold().text_color(x.old ? t.dim : levelColor(x.level, t)).child(`${x.pct}%`))
      .child(div().w(28).child(this.track(t, x, 3, 0)));
  }
}
