// What the dashboard shows, worked out from the collectors' documents. Nothing in it touches the
// app, so it runs under node: test a change to it there (reduce.test.mjs), against a real
// collect.mjs answer.
//
// Tokens are the unit everywhere (total: input, output, cache write and cache read); every figure
// also carries its dollars (Claude Code's own cost, and Codex's estimate from the collector's
// price table) and how much of them is an estimate (`est`, in dollars).
//
//   prepare()    the documents of every machine as one set of rows, each tagged with its
//                machine, project keys and names, the freshest limit readings, the biggest
//                sessions and what each project spent in the last hour ("Burning now")
//   weekView()   one agent's weekly limit: bands, even pace, projection, what each project ate,
//                the earlier weeks
//   rangeView()  the range's figures, its bars and the three columns, for one range and filter
//   yearView()   the calendar of the last 53 weeks and its records
//
// Every part of a v2 or v3 document (top, recent, limits.*.weeks, took.docker) is optional: an
// older document leaves that part out. The results are plain data, small enough to keep as the
// snapshot shown at the next open.

import { pace, verdict, burn, evenAt, bends, usableMsBetween, WEEK_MS, HOUR_MS } from "./pace.js";

export const DAY_MS = 86_400_000;
// Colored projects of a weekly limit: the rest are one band.
export const TOP = 4;
// The colors of the page: the projects past them are "other".
export const COLORS = 6;
// What each limit's points are kept for: the rest are summed.
const POINTS_MOST = 12;
// A range longer than this many days has one bar a week.
const WEEKLY_AFTER = 90;
// The projects of a range that get a sparkline.
const SPARK_MOST = 24;
// The biggest sessions listed: those at or over the range's average, at least and at most.
const SESSIONS_LEAST = 3, SESSIONS_MOST = 6;
// The calendar's columns.
export const YEAR_WEEKS = 53;
// Folders whose projects are summed as one row.
const SCRATCH = ["/private/tmp/", "/private/var/", "/tmp/", "/var/folders/"];
export const SCRATCH_KEY = "scratch";

export const RANGES = [
  { id: "day", label: "24 hours", title: "Last 24 hours", before: "the day before", empty: "Nothing ran in the last 24 hours." },
  { id: "week", label: "7 days", title: "Last 7 days", before: "the 7 days before", empty: "Nothing ran in the last 7 days." },
  { id: "month", label: "30 days", title: "Last 30 days", before: "the 30 days before", empty: "Nothing ran in the last 30 days." },
  { id: "all", label: "All", title: "Everything on record", before: null, empty: "Nothing on record yet." },
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => (n < 10 ? "0" : "") + n;
export const dayString = (ms) => { const t = new Date(ms); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
export function dayMs(d) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, m - 1, dd).getTime();
}
// Local days, by the calendar: a day with a clock change is not 24 hours long.
export function shiftDay(ms, k) {
  const t = new Date(ms);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() + k).getTime();
}
// 412M, 5.1M, 28k: one decimal under 10, none above. A value that rounds to 1000 of a unit is
// said in the next one ("1B", not "1000M").
const UNITS = [[1e3, "k"], [1e6, "M"], [1e9, "B"], [1e12, "T"]];
export function tokens(v) {
  const say = (x, u) => `${x < 10 ? Math.round(x * 10) / 10 : Math.round(x)}${u}`;
  const round = (x) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x));
  for (let i = UNITS.length - 1; i >= -1; i--) {
    const [d, u] = i >= 0 ? UNITS[i] : [1, ""];
    if (v < d && i >= 0) continue;
    if (round(v / d) >= 1000 && i + 1 < UNITS.length) return say(v / UNITS[i + 1][0], UNITS[i + 1][1]);
    return i >= 0 ? say(v / d, u) : String(Math.round(v));
  }
  return String(Math.round(v));
}

// A weekly window that ends at `resets`, as its days: "9–15 Nov", "30 Nov – 6 Dec". Its last
// day is the one 12 hours before the reset (a reset on Sunday morning ends the week on Saturday).
export function weekSpan(resets) {
  const a = new Date(resets - 7 * DAY_MS), b = new Date(resets - 12 * 3_600_000);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

export function monday(ms) {
  const t = new Date(ms);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)).getTime();
}
const round2 = (v) => Math.round(v * 100) / 100;

function scratch(p) { return SCRATCH.some((s) => p.startsWith(s) || p === s.slice(0, -1)); }
function base(p) { const s = p.replace(/\/+$/, ""); const i = s.lastIndexOf("/"); return i >= 0 ? s.slice(i + 1) || s : s; }
function parent(p) { const s = p.replace(/\/+$/, ""); const i = s.lastIndexOf("/"); return i > 0 ? base(s.slice(0, i)) : ""; }

// docs: [{ machine: null | name, doc }], every one that answered.
export function prepare(docs, now) {
  const days = new Map();
  const day = (d) => { let v = days.get(d); if (v === undefined) { v = dayMs(d); days.set(d, v); } return v; };
  const hours = new Map();
  const hour = (d, h) => {
    const k = d + h;
    let v = hours.get(k);
    if (v === undefined) { const [y, m, dd] = d.split("-").map(Number); v = new Date(y, m - 1, dd, h).getTime(); hours.set(k, v); }
    return v;
  };
  const projects = new Map();
  const project = (m, p) => {
    if (scratch(p)) {
      if (!projects.has(SCRATCH_KEY)) projects.set(SCRATCH_KEY, { key: SCRATCH_KEY, name: "Other folders", dim: "", path: null, machine: null });
      return SCRATCH_KEY;
    }
    const key = `${m ?? ""}\n${p}`;
    if (!projects.has(key)) projects.set(key, { key, name: base(p) || p, dim: "", path: p, machine: m, parent: parent(p) });
    return key;
  };
  const rows = [];
  const sessions = [];
  const top = [];
  const recent = new Map();
  const docker = {};
  let claude = null, codex = null, older = null, firstClaude = null, firstDay = null, tz = null, blocked = false;
  for (const { machine, doc } of docs) {
    if (!doc || !Array.isArray(doc.rows)) continue;
    if (machine === null) { older = doc.older ?? null; tz = doc.tz ?? null; }
    if (doc.took?.volumesBlocked) blocked = true;
    if (typeof doc.took?.docker === "string") docker[machine ?? ""] = doc.took.docker;
    const lc = doc.limits?.claude, lx = doc.limits?.codex;
    if (lc && (!claude || lc.at > claude.at)) claude = lc;
    if (lx && (!codex || lx.at > codex.at)) codex = lx;
    for (const r of doc.rows) {
      const p = project(machine, r.project ?? "");
      const dm = day(r.d);
      if (firstDay === null || dm < firstDay) firstDay = dm;
      if (r.agent === "claude" && (firstClaude === null || dm < firstClaude)) firstClaude = dm;
      const tok = [r.in ?? 0, r.out ?? 0, r.cw ?? 0, r.cr ?? 0];
      const priced = typeof r.cost === "number";
      rows.push({
        t: r.h === null || r.h === undefined ? null : hour(r.d, r.h), day: dm, a: r.agent, m: machine,
        box: r.where === "container" ? (r.box ?? "container") : null, p, model: r.model ?? "unknown", sub: !!r.sub,
        n: r.n ?? 0, cost: priced ? r.cost : 0, priced, est: priced && r.cost > 0 && r.est === true ? r.cost : 0,
        // Tokens: input (uncached, for both agents: the collector takes Codex's cached input out of
        // its input), output, cache write, cache read; T is their total.
        tok, T: tok[0] + tok[1] + tok[2] + tok[3],
      });
    }
    for (const s of doc.sessions ?? []) {
      sessions.push({ day: day(s.d), p: project(machine, s.project ?? ""), n: s.n ?? 0 });
    }
    for (const s of Array.isArray(doc.top) ? doc.top : []) {
      if (!s || !Number.isFinite(s.last)) continue;
      const cost = typeof s.cost === "number" ? s.cost : null;
      top.push({
        p: project(machine, s.project ?? ""), agent: s.agent === "codex" ? "codex" : "claude",
        title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : null, last: s.last,
        tok: typeof s.tok === "number" ? s.tok : 0, cost, est: s.est === true && cost !== null ? cost : 0, sub: typeof s.sub === "number" ? s.sub : 0,
      });
    }
    // What each project spent in the last hour, one entry a project and agent (its machines
    // together): each agent's Burning now lists its own, as percent of its own limit.
    for (const x of Array.isArray(doc.recent) ? doc.recent : []) {
      if (!x || !(x.n60 > 0)) continue;
      const p = project(machine, x.project ?? "");
      addRecent(recent, p, x);
    }
  }
  // The home folder, and folders that hold two or more projects right inside them (a
  // "Projects" folder), are no project: their rows join "Other folders". A project with one
  // project folder inside it (a plugin, a website) stays a project.
  const other = new Map();
  const list = [...projects.values()].filter((x) => x.key !== SCRATCH_KEY);
  for (const x of list) {
    const home = x.path.split("/").filter(Boolean).length <= 2;
    const base = x.path.replace(/\/+$/, "") + "/";
    const children = list.filter((y) => y !== x && y.machine === x.machine && y.path.startsWith(base) && !y.path.slice(base.length).includes("/")).length;
    if (home || children >= 2) other.set(x.key, SCRATCH_KEY);
  }
  if (other.size) {
    if (!projects.has(SCRATCH_KEY)) projects.set(SCRATCH_KEY, { key: SCRATCH_KEY, name: "Other folders", dim: "", path: null, machine: null });
    for (const k of other.keys()) projects.delete(k);
    for (const r of rows) r.p = other.get(r.p) ?? r.p;
    for (const x of sessions) x.p = other.get(x.p) ?? x.p;
    for (const x of top) x.p = other.get(x.p) ?? x.p;
    const merged = new Map();
    for (const x of recent.values()) addRecent(merged, other.get(x.p) ?? x.p, x);
    recent.clear();
    for (const [k, v] of merged) recent.set(k, v);
  }
  // A name shared by two projects gets its parent folder, or its machine, beside it.
  const byName = new Map();
  for (const pr of projects.values()) { const l = byName.get(pr.name) ?? []; l.push(pr); byName.set(pr.name, l); }
  for (const l of byName.values()) {
    if (l.length < 2) continue;
    const parents = new Set(l.map((x) => x.parent));
    for (const x of l) x.dim = parents.size === l.length ? x.parent : (x.machine ?? "this Mac");
  }
  top.sort((a, b) => b.tok - a.tok);
  // blocked: OrbStack's volumes did not answer on some machine (collector v1).
  return {
    now, rows, sessions, projects: Object.fromEntries(projects), claude, codex, older, firstClaude, firstDay, tz, blocked,
    top, docker, hasRecent: docs.some(({ doc }) => Array.isArray(doc?.recent)),
    recent: [...recent.values()].sort((a, b) => b.tok60 - a.tok60 || b.n60 - a.n60 || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
      .map((x) => ({ ...x, cost60: round2(x.cost60) })),
  };
}

// One entry a project and agent: { p, agent, tok60, cost60, est, n15, n60, last }.
function addRecent(map, p, x) {
  const agent = x.agent === "codex" ? "codex" : "claude";
  const k = `${agent}\n${p}`;
  const o = map.get(k) ?? { p, agent, tok60: 0, cost60: 0, est: false, n15: 0, n60: 0, last: 0 };
  const cost = x.cost60 ?? 0;
  o.tok60 += x.tok60 ?? 0; o.cost60 += cost; o.n15 += x.n15 ?? 0; o.n60 += x.n60 ?? 0;
  if (cost > 0 && (x.est || agent === "codex")) o.est = true;
  o.last = Math.max(o.last, x.last ?? 0);
  map.set(k, o);
}

// Each agent's Burning now: its first `most` projects of the last hour (by tokens), and what is
// left as a count and tokens. → { claude: { rows, more, moreTok }, codex: { ... } }
export function burning(recent, most) {
  const out = {};
  for (const agent of ["claude", "codex"]) {
    const mine = recent.filter((x) => x.agent === agent);
    const rest = mine.slice(most);
    out[agent] = { rows: mine.slice(0, most), more: rest.length, moreTok: rest.reduce((a, x) => a + x.tok60, 0) };
  }
  return out;
}

// A weekly limit's points are put on projects by their cost (Codex's: the estimate); an agent
// with no cost at all in the window, by tokens.
function weigher(rows) {
  for (const r of rows) if (r.cost > 0) return (x) => x.cost;
  return (x) => x.T;
}

// The rows of one agent in [start, upto), hourly only (the week fits in the collector's hourly days).
function windowRows(data, agent, start, upto) {
  const out = [];
  for (const r of data.rows) if (r.a === agent && r.t !== null && r.t + HOUR_MS > start && r.t < upto) out.push(r);
  return out;
}

// The project keys of a window, by weight: the first TOP are its colored ones.
function rank(rows, w) {
  const m = new Map();
  for (const r of rows) { const v = w(r); if (v > 0) m.set(r.p, (m.get(r.p) ?? 0) + v); }
  return [...m].sort((a, b) => b[1] - a[1]);
}

// One agent's weekly limit (`agent`: "claude" or "codex"), at `now`.
export function weekView(data, now, agent = "claude") {
  const lim = agent === "codex" ? data.codex : data.claude;
  const week = lim?.week;
  const earlier = (Array.isArray(lim?.weeks) ? lim.weeks : [])
    .filter((w) => w && typeof w.peak === "number" && (!week?.resets || w.resets < week.resets - 3 * HOUR_MS))
    .sort((a, b) => b.resets - a.resets).slice(0, 6).reverse().map((w) => ({ resets: w.resets, peak: w.peak }));
  // Without a reading the projects of the last seven days still get their colors.
  if (!week || week.pct == null || !week.resets || week.resets <= now) {
    const rows = windowRows(data, agent, now - WEEK_MS, now);
    return { agent, none: true, stale: week?.resets && week.resets <= now ? week.resets : null, top: rank(rows, weigher(rows)).slice(0, TOP).map(([k]) => k), fiveHour: lim?.fiveHour ?? null, at: lim?.at ?? null, earlier };
  }
  const end = week.resets, start = end - WEEK_MS, upto = Math.min(now, end);
  const rows = windowRows(data, agent, start, upto);
  const wt = weigher(rows);
  const ranked = rank(rows, wt);
  const top = ranked.slice(0, TOP).map(([k]) => k);
  const slot = new Map(top.map((k, i) => [k, i]));
  const slots = Math.max(1, Math.ceil((upto - start) / HOUR_MS));
  const bands = top.length + 1;
  const per = Array.from({ length: bands }, () => new Float64Array(slots));
  let total = 0, cost = 0, tok = 0, est = 0;
  for (const r of rows) {
    cost += r.cost; tok += r.T; est += r.est;
    const v = wt(r);
    if (!v) continue;
    const i = Math.min(slots - 1, Math.max(0, Math.floor((r.t - start) / HOUR_MS)));
    per[slot.get(r.p) ?? top.length][i] += v;
    total += v;
  }
  const times = [start];
  for (let i = 1; i < slots; i++) times.push(start + i * HOUR_MS);
  times.push(upto);
  // The limit's percentage is not in the rows: the weight so far is scaled to the readings. Where
  // the collector and the statusline kept readings of this week (trail, samples), the curve
  // passes through each of them, the weight between two readings scaled to the rise between
  // them; without any, the whole weight is scaled to today's reading. It only rises, but at a
  // restart (the limit was reset inside the window, `week.restarts`): there it holds until the
  // first lower reading, and falls to it.
  const C = [0];
  for (let i = 0; i < slots; i++) { let x = 0; for (let b = 0; b < bands; b++) x += per[b][i]; C.push(C[i] + x); }
  const costAt = (t) => {
    if (t <= start) return 0;
    for (let i = 0; i < slots; i++) if (t <= times[i + 1]) return C[i] + (C[i + 1] - C[i]) * (t - times[i]) / Math.max(1, times[i + 1] - times[i]);
    return C[slots];
  };
  const samples = Array.isArray(week.samples) ? week.samples : [];
  const readings = [...(Array.isArray(week.trail) ? week.trail : []), ...samples, [lim.at, week.pct]]
    .filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[0] > start && x[0] <= upto)
    .sort((a, b) => a[0] - b[0]);
  const restarts = (Array.isArray(week.restarts) ? week.restarts : []).filter((x) => Array.isArray(x) && Number.isFinite(x[0])).map((x) => x[0]);
  const pts = [[start, 0, 0]];
  for (const [t, v] of readings) {
    const last = pts[pts.length - 1];
    const fall = restarts.some((r) => r > last[0] && r <= t);
    const pv = fall ? Math.min(100, v) : Math.max(last[1], Math.min(100, v));
    if (t === last[0]) { last[1] = pv; continue; }
    if (fall && pv < last[1] && t - 1 > last[0]) pts.push([t - 1, last[1], costAt(t - 1)]);
    pts.push([t, pv, costAt(t)]);
  }
  // The rate after the last reading: that of the last stretch that weighed anything and didn't fall.
  let tail = total > 0 ? week.pct / total : 0;
  for (let k = pts.length - 1; k > 0; k--) {
    const dc = pts[k][2] - pts[k - 1][2], dv = pts[k][1] - pts[k - 1][1];
    if (dc > 0 && dv >= 0) { tail = dv / dc; break; }
  }
  const valueAt = (t) => {
    const c = costAt(t);
    let k = 0;
    while (k + 1 < pts.length && pts[k + 1][0] <= t) k++;
    const [, v0, c0] = pts[k];
    if (k + 1 >= pts.length) return Math.min(100, v0 + (c - c0) * tail);
    const [, v1, c1] = pts[k + 1];
    return c1 > c0 ? v0 + (c - c0) / (c1 - c0) * (v1 - v0) : v0;
  };
  const V = times.map(valueAt);
  // tops[b][i]: the top edge of band b (the bands under it included) at times[i]. Each hour's
  // rise is split among the bands as its weight was; a rise with none seen goes to the rest. At a
  // restart's fall every band shrinks by the same share, so they still add up to the curve.
  const run = new Float64Array(bands);
  const tops = Array.from({ length: bands }, () => [0]);
  for (let i = 0; i < slots; i++) {
    if (V[i + 1] < V[i] && V[i] > 0) { const k = Math.max(0, V[i + 1]) / V[i]; for (let b = 0; b < bands; b++) run[b] *= k; }
    const rise = Math.max(0, V[i + 1] - V[i]);
    const sum = C[i + 1] - C[i];
    for (let b = 0; b < bands; b++) run[b] += sum > 0 ? rise * per[b][i] / sum : b === bands - 1 ? rise : 0;
    let acc = 0;
    for (let b = 0; b < bands; b++) { acc += run[b]; tops[b].push(round2(acc)); }
  }
  // Each band's points of the limit so far: its share of the week's weight times the reading;
  // and every project's, the biggest first (`pts`), the rest summed (`ptsRest`).
  const bandCost = per.map((a) => a.reduce((x, y) => x + y, 0));
  const points = bandCost.map((c) => (total > 0 ? c / total * week.pct : 0));
  const share = ranked.map(([k, v]) => [k, round2(total > 0 ? v / total * week.pct : 0)]);
  const ptsRest = round2(share.slice(POINTS_MOST).reduce((a, x) => a + x[1], 0) + (total > 0 ? 0 : week.pct));
  const p = pace(week.pct, end, now);
  const v = p ? verdict(p) : null;
  const even = bends(start, end).map((t) => [t, evenAt(start, end, t)]);
  let projection = null;
  if (p?.state === "ok" && now < end) {
    const to = p.runsOutAt ?? end;
    const left = usableMsBetween(now, end);
    // Over: the week's own rate, which lands on 100 at runsOutAt. Not over: the line that ends
    // where the statusline says, also on the first day, when its elapsed time is floored.
    const rate = p.runsOutAt ? p.rate : left > 0 ? (p.projected - week.pct) / left : 0;
    projection = bends(now, to).map((t) => [t, Math.min(100, week.pct + rate * usableMsBetween(now, t))]);
  }
  return {
    agent, none: false, start, end, now: upto, pct: week.pct, at: lim.at, fiveHour: lim.fiveHour ?? null,
    samples, pace: p, verdict: v, burst: burn(week, lim.at, now), top, times, tops, even, projection,
    cost: round2(cost), tok, est: round2(est), earlier, points, pts: share.slice(0, POINTS_MOST), ptsRest,
    readings: pts.slice(1).map(([t, v]) => [t, v]),
  };
}

// The [from, to) of a range, and of the one before it.
function periods(id, now, data) {
  const today = shiftDay(now, 0);
  if (id === "day") return { hourly: true, from: now - DAY_MS, to: now + 1, prevFrom: now - 2 * DAY_MS, prevTo: now - DAY_MS };
  const len = id === "week" ? 7 : id === "month" ? 30 : null;
  if (len === null) return { hourly: false, from: data.firstDay ?? today, to: shiftDay(today, 1), prevFrom: null, prevTo: null };
  const from = shiftDay(today, 1 - len);
  return { hourly: false, from, to: shiftDay(today, 1), prevFrom: shiftDay(from, -len), prevTo: from };
}

// The periods a range's change is measured on: [from, to) and [prevFrom, from), the same length.
function fairPeriods(id, now) {
  if (id === "day") {
    const h = new Date(now); h.setMinutes(0, 0, 0);
    const to = h.getTime();
    return { hourly: true, from: to - DAY_MS, to, prevFrom: to - 2 * DAY_MS };
  }
  const len = id === "week" ? 7 : id === "month" ? 30 : null;
  if (len === null) return null;
  const to = shiftDay(now, 0), from = shiftDay(to, 1 - len);
  return { hourly: false, from, to, prevFrom: shiftDay(from, 1 - len) };
}

// One range's figures. `filter`: a project key, or null. `claims`: the colored keys the limits
// claim, the limit most in danger first: the range's own biggest follow, up to COLORS.
export function rangeView(data, id, filter, now, claims) {
  const today = shiftDay(now, 0);
  const w = periods(id, now, data);
  const inRange = w.hourly
    ? (r) => r.t !== null && r.t + HOUR_MS > w.from && r.t <= now
    : (r) => r.day >= w.from;
  const rows = [];
  for (const r of data.rows) if (inRange(r)) rows.push(r);
  // The colored projects: the limits' claims, then the range's own biggest that are not among
  // them, so its biggest project is never grey.
  const rankMap = new Map();
  for (const r of rows) rankMap.set(r.p, (rankMap.get(r.p) ?? 0) + r.T);
  const head = claims.slice(0, COLORS);
  const extra = [...rankMap].filter(([k, v]) => !head.includes(k) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, COLORS - head.length).map(([k]) => k);
  const segKeys = [...head, ...extra];
  const color = new Map(segKeys.map((k, i) => [k, i]));
  const mine = filter ? rows.filter((r) => r.p === filter) : rows;

  let T = 0, cost = 0, n = 0, est = 0;
  const tokens = [0, 0, 0, 0];
  for (const r of mine) { T += r.T; cost += r.cost; n += r.n; est += r.est; addTok(tokens, r.tok); }
  // Sessions are counted by day: a day's session started before the 24 hours counts too.
  const sFrom = w.hourly ? shiftDay(w.from, 0) : w.from;
  let sess = 0;
  const sessBy = new Map();
  for (const s of data.sessions) {
    if (s.day < sFrom) continue;
    sessBy.set(s.p, (sessBy.get(s.p) ?? 0) + s.n);
    if (!filter || s.p === filter) sess += s.n;
  }

  // The change against the period before, in tokens: full days only (today left out) against as
  // many full days before them; for 24 hours, the last 24 full hours against the 24 before. Said
  // only when the earlier period is wholly on record for Claude.
  let prev = null;
  const fair = fairPeriods(id, now);
  if (fair && data.firstClaude !== null && data.firstClaude <= shiftDay(fair.prevFrom, 0)) {
    let pv = 0, cv = 0;
    for (const r of data.rows) {
      if (filter && r.p !== filter) continue;
      const at = fair.hourly ? r.t : r.day;
      if (at === null) continue;
      if (at >= fair.prevFrom && at < fair.from) pv += r.T;
      else if (at >= fair.from && at < fair.to) cv += r.T;
    }
    if (pv > 0) prev = { value: pv, change: (cv - pv) / pv };
  }

  // The bars: an hour, a day or a week each, in tokens.
  let bars = [];
  let unit = "day";
  const slotOf = new Map();
  let slotFn;
  if (id === "day") {
    unit = "hour";
    const h0 = new Date(Math.floor(now / HOUR_MS) * HOUR_MS - 23 * HOUR_MS); h0.setMinutes(0, 0, 0);
    const first = h0.getTime();
    for (let i = 0; i < 24; i++) bars.push(bar(first + i * HOUR_MS));
    slotFn = (r) => { const i = Math.floor((r.t - first) / HOUR_MS); return i >= 0 && i < 24 ? i : -1; };
  } else {
    const span = Math.round((today - w.from) / DAY_MS) + 1;
    const weekly = id === "all" && span > WEEKLY_AFTER;
    unit = weekly ? "week" : "day";
    let at = weekly ? monday(w.from) : w.from;
    while (at <= today) { slotOf.set(at, bars.length); bars.push(bar(at)); at = shiftDay(at, weekly ? 7 : 1); }
    slotFn = (r) => slotOf.get(weekly ? monday(r.day) : r.day) ?? -1;
  }
  function bar(at) { return { at, segs: new Array(segKeys.length + 1).fill(0), cost: 0, est: 0, n: 0, tok: [0, 0, 0, 0] }; }
  for (const r of mine) {
    const i = slotFn(r);
    if (i < 0) continue;
    const b = bars[i];
    b.segs[color.get(r.p) ?? segKeys.length] += r.T; b.cost += r.cost; b.n += r.n; addTok(b.tok, r.tok);
    b.est += r.est;
  }
  let most = 0;
  bars = bars.map((b) => {
    const v = b.segs.reduce((a, x) => a + x, 0);
    if (v > most) most = v;
    return { at: b.at, segs: b.segs, v, cost: round2(b.cost), est: round2(b.est), n: b.n, tok: b.tok };
  });

  // Projects: the whole range, whatever the filter, so another one can be chosen.
  const pm = new Map();
  let all = 0;
  for (const r of rows) {
    let p = pm.get(r.p);
    if (!p) { p = { key: r.p, T: 0, cost: 0, est: 0, n: 0, tok: [0, 0, 0, 0] }; pm.set(r.p, p); }
    p.T += r.T; p.cost += r.cost; p.n += r.n; all += r.T; addTok(p.tok, r.tok);
    p.est += r.est;
  }
  const projects = [...pm.values()]
    .sort((a, b) => b.T - a.T || b.n - a.n)
    .map((p) => ({ key: p.key, T: p.T, cost: round2(p.cost), est: round2(p.est), n: p.n, tok: p.tok, sessions: sessBy.get(p.key) ?? 0, share: all > 0 && p.T > 0 ? p.T / all : null }));
  // The first projects' own buckets, for their sparklines, unfiltered.
  const sparks = {};
  const sparkKeys = new Set(projects.slice(0, SPARK_MOST).map((p) => p.key));
  for (const k of sparkKeys) sparks[k] = new Array(bars.length).fill(0);
  for (const r of rows) {
    const s = sparks[r.p];
    if (!s) continue;
    const i = slotFn(r);
    if (i >= 0) s[i] += r.T;
  }

  // The biggest sessions whose last reply is inside the range: those at or over the average of
  // the range's, at least SESSIONS_LEAST (when there are as many) and at most SESSIONS_MOST.
  const cands = data.top.filter((s) => s.last >= w.from && s.last <= now && (!filter || s.p === filter));
  const avg = cands.length ? cands.reduce((a, s) => a + s.tok, 0) / cands.length : 0;
  const biggest = cands.filter((s, i) => s.tok >= avg || i < SESSIONS_LEAST).slice(0, SESSIONS_MOST)
    .map((s) => ({ p: s.p, agent: s.agent, title: s.title, last: s.last, tok: s.tok, cost: s.cost === null ? null : round2(s.cost), est: round2(s.est), sub: s.sub }));

  // Machines: each machine's own folders, then its dev containers, one row a container project.
  const mm = new Map();
  for (const r of mine) {
    const k = `${r.m ?? ""}\n${r.box ?? ""}`;
    let m = mm.get(k);
    if (!m) { m = { m: r.m ?? "", box: r.box, T: 0, cost: 0, est: 0, n: 0 }; mm.set(k, m); }
    m.T += r.T; m.cost += r.cost; m.n += r.n; m.est += r.est;
  }
  const hostOf = new Map();
  for (const m of mm.values()) if (m.box === null) hostOf.set(m.m, m);
  for (const m of mm.values()) if (m.box !== null && !hostOf.has(m.m)) hostOf.set(m.m, { m: m.m, box: null, T: 0, cost: 0, est: 0, n: 0, none: true });
  const hosts = [...hostOf.values()].sort((a, b) => (a.m === "" ? -1 : b.m === "" ? 1 : b.T - a.T || b.n - a.n));
  const machines = [];
  const part = (x) => (T > 0 ? x.T / T : null);
  const mrow = (x) => ({ m: x.m, box: x.box, T: x.T, cost: round2(x.cost), est: round2(x.est), n: x.n, share: part(x) });
  for (const h of hosts) {
    machines.push(mrow(h));
    const boxes = [...mm.values()].filter((x) => x.m === h.m && x.box !== null).sort((a, b) => b.T - a.T || b.n - a.n);
    for (const b of boxes) machines.push(mrow(b));
  }

  // Models, one unit: each model's share is of every token of the range, both agents; each
  // agent's group keeps its own totals. A model with no price says so (`priced`).
  const groups = { claude: { T: 0, cost: 0, est: 0, models: new Map() }, codex: { T: 0, cost: 0, est: 0, models: new Map() } };
  let subT = 0;
  for (const r of mine) {
    const g = groups[r.a === "codex" ? "codex" : "claude"];
    g.T += r.T; g.cost += r.cost; g.est += r.est;
    if (r.sub) subT += r.T;
    const m = g.models.get(r.model) ?? { T: 0, cost: 0, est: 0, priced: false };
    m.T += r.T; m.cost += r.cost; m.est += r.est; if (r.priced) m.priced = true;
    g.models.set(r.model, m);
  }
  const list = (g) => [...g.models].filter(([, m]) => m.T > 0).sort((a, b) => b[1].T - a[1].T)
    .map(([mid, m]) => ({ id: mid, name: modelName(mid), T: m.T, cost: round2(m.cost), est: round2(m.est), priced: m.priced, share: T > 0 ? m.T / T : 0 }));
  const total = (g) => ({ T: g.T, cost: round2(g.cost), est: round2(g.est) });

  // Before the first transcript: only Claude Code's own daily counts.
  let older = null;
  if (id === "all" && !filter && data.older?.activity?.length) {
    let msgs = 0, sessions = 0, since = null;
    for (const a of data.older.activity) {
      msgs += a.messageCount ?? 0; sessions += a.sessionCount ?? 0;
      if (typeof a.date === "string" && (since === null || a.date < since)) since = a.date;
    }
    if (msgs > 0) older = { msgs, sessions, since: since ? dayMs(since) : null, before: data.firstClaude };
  }

  return {
    id, filter, segKeys, T, cost: round2(cost), est: round2(est), n, tokens, sessions: sess, unit, bars, most, prev, projects, sparks, biggest,
    machines, claude: list(groups.claude), codex: list(groups.codex), cgroup: total(groups.claude), xgroup: total(groups.codex),
    sub: T > 0 ? subT / T : null, older, empty: mine.length === 0,
  };
}

function addTok(to, t) { if (t) for (let i = 0; i < 4; i++) to[i] += t[i]; }

// Five steps, by where a value stands among its own kind's values.
function stepper(values) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  return (x) => {
    if (!(x > 0) || !v.length) return 0;
    let lo = 0, hi = v.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (v[mid] <= x) lo = mid + 1; else hi = mid; }
    // The smallest is 1, the largest 5.
    return v.length < 2 ? 5 : 1 + Math.floor((lo - 1) / (v.length - 1) * 4.999);
  };
}

// The last 53 weeks, Monday to Sunday. Days with rows are ranked by tokens into five steps, both
// agents together; days known only from Claude Code's own message counts have a rank of their
// own. The units differ; the ranks are comparable enough for a calendar. The records: the
// busiest day, the active days since the first record inside the 53 weeks, the longest streak.
export function yearView(data, now) {
  const today = shiftDay(now, 0);
  const first = shiftDay(monday(today), -7 * (YEAR_WEEKS - 1));
  const byDay = new Map();
  for (const r of data.rows) {
    if (r.day < first) continue;
    const d = byDay.get(r.day) ?? { T: 0, cost: 0, n: 0 };
    d.T += r.T; d.cost += r.cost; d.n += r.n;
    byDay.set(r.day, d);
  }
  const msgs = new Map();
  let lastOlder = null;
  for (const a of data.older?.activity ?? []) {
    if (typeof a.date !== "string") continue;
    const d = dayMs(a.date);
    if (lastOlder === null || d > lastOlder) lastOlder = d;
    if (d >= first && !byDay.has(d) && (a.messageCount ?? 0) > 0) msgs.set(d, a.messageCount);
  }
  const byTok = stepper([...byDay.values()].map((d) => d.T)), byMsgs = stepper([...msgs.values()]);
  const steps = [];
  const vals = {};
  let busiest = null, firstActive = null, active = 0, streak = 0, run = 0;
  for (let c = 0; c < YEAR_WEEKS; c++) {
    for (let r = 0; r < 7; r++) {
      const d = shiftDay(first, c * 7 + r);
      const i = c * 7 + r;
      if (d > today) { steps.push(-1); continue; }
      const x = byDay.get(d);
      const m = msgs.get(d);
      if (x || m) {
        if (firstActive === null) firstActive = d;
        active++; run++; if (run > streak) streak = run;
      } else run = 0;
      if (x) {
        steps.push(x.T > 0 ? byTok(x.T) : 1); vals[i] = [x.T, round2(x.cost), 0];
        if (!busiest || x.T > busiest.T) busiest = { day: d, T: x.T };
        continue;
      }
      if (m) { steps.push(byMsgs(m)); vals[i] = [0, 0, m]; continue; }
      steps.push(0);
    }
  }
  let days = 0;
  if (firstActive !== null) days = Math.round((today - firstActive) / DAY_MS) + 1;
  // A month's name above the first week that starts in it.
  const months = [];
  let lastMonth = null;
  for (let c = 0; c < YEAR_WEEKS; c++) {
    const m = new Date(shiftDay(first, c * 7)).getMonth();
    if (m !== lastMonth) { if (c > 0 || new Date(first).getDate() <= 7) months.push([c, MONTHS[m]]); lastMonth = m; }
  }
  // What the colors stand on, with the days between the two kinds of record.
  let caption = "";
  if (lastOlder !== null && data.firstClaude !== null && data.firstClaude > lastOlder) {
    const date = (ms) => { const t = new Date(ms); return `${t.getDate()} ${MONTHS[t.getMonth()]}`; };
    caption = `Before ${date(data.firstClaude)}: Claude Code's message counts.`;
    const a = shiftDay(lastOlder, 1), b = shiftDay(data.firstClaude, -1);
    if (b >= a) {
      const ta = new Date(a), tb = new Date(b);
      const from = ta.getMonth() === tb.getMonth() ? String(ta.getDate()) : date(a);
      caption += a === b ? ` ${date(a)}: no record.` : ` ${from}\u2013${date(b)}: no record.`;
    }
  }
  // The column where Claude's own rows begin, after its message counts: drawn with a wider gap.
  let split = null;
  if (lastOlder !== null && data.firstClaude !== null && data.firstClaude > first) split = Math.floor(Math.round((data.firstClaude - first) / DAY_MS) / 7);
  return { first, today, steps, vals, months, caption, split, records: { busiest, active, days, streak } };
}

// "claude-opus-5-5" is "Opus 5.5"; "gpt-5.1-codex-mini" is "GPT-5.1 Codex Mini".
export function modelName(id) {
  if (!id || id === "unknown") return "Unknown model";
  let m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] !== undefined ? "." + m[3] : ""}`;
  m = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/.exec(id);
  if (m) return `${cap(m[3])} ${m[1]}${m[2] !== undefined ? "." + m[2] : ""}`;
  m = /^gpt-([\d.]+)(?:-(.*))?$/.exec(id);
  if (m) return `GPT-${m[1]}${m[2] ? " " + m[2].split("-").map(cap).join(" ") : ""}`;
  return id.split("-").map(cap).join(" ");
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
