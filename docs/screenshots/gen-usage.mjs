#!/usr/bin/env node
// gen-usage.mjs: a fake but realistic usage dataset for screenshots of the `usage` mod.
//
//   node gen-usage.mjs <sandbox home>        (the home must have "herdr-app-demo" in its path)
//
// Writes, after deleting them: <home>/.claude/projects, <home>/.claude/statusline/.usage-cache.json,
// <home>/.claude/stats-cache.json, <home>/.codex/sessions, <home>/.local/state/herdr-usage/.
// Nothing else. Everything is relative to Date.now(); the rest comes from seeded random numbers
// keyed by the local date, so two runs on the same day give the same picture.
//
// Run it in the time zone the app runs in: days and hours are local ones.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ARG = process.argv[2];
if (!ARG || !/herdr-app-demo/.test(path.resolve(ARG))) {
  console.error('usage: node gen-usage.mjs <sandbox home>  (its path must contain "herdr-app-demo")');
  process.exit(2);
}
fs.mkdirSync(ARG, { recursive: true });
const HOME = path.resolve(ARG); // spelled as given: /var/tmp, since the mod files /private/var under "Other folders"
const DEV = path.join(HOME, 'Developer');
if (['/private/var/', '/private/tmp/', '/tmp/', '/var/folders/'].some((s) => (DEV + '/').startsWith(s))) {
  console.error(`gen-usage: warning: ${DEV} is under a folder the dialog treats as scratch (reduce.js SCRATCH): every project will read "Other folders".`);
}

const NOW = Date.now();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000, WEEK = 7 * DAY;

// ------------------------------------------------------------ random, dates

const sha = (s) => crypto.createHash('sha256').update(s).digest();
function rng(seed) {
  let a = sha(seed).readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (seed, n) => sha(seed).toString('hex').slice(0, n);
const uuid = (seed) => { const h = hex(seed, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const logn = (r, median, sigma) => { const u = Math.max(1e-9, r()), v = r(); return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function pick(r, weights) {
  const tot = weights.reduce((a, [, w]) => a + w, 0);
  let x = r() * tot;
  for (const [k, w] of weights) { if ((x -= w) < 0) return k; }
  return weights[weights.length - 1][0];
}

const pad = (n) => (n < 10 ? '0' : '') + n;
const dayStr = (ms) => { const t = new Date(ms); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const midnight = (ms) => { const t = new Date(ms); return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(); };
const shift = (ms, k) => { const t = new Date(ms); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + k).getTime(); };
const at = (dm, h, m = 0) => { const t = new Date(dm); return new Date(t.getFullYear(), t.getMonth(), t.getDate(), h, m).getTime(); };
const iso = (ms) => new Date(ms).toISOString();
const TODAY = midnight(NOW);
const ago = (dm) => Math.round((TODAY - dm) / DAY);

const T_FROM = shift(TODAY, -29);      // transcripts and sessions: the last 30 days
const H_FROM = shift(TODAY, -345);     // history.json day rows before that
const S_FROM = shift(TODAY, -372);     // stats-cache.json message counts before that

// ------------------------------------------------------------ the world

const P = (n) => path.join(DEV, n);
const SCRATCH = '/private/tmp/bench-scratch';
const PROJECTS = ['herdr-app', 'atlas-api', 'nimbus-web', 'ledger-cli', 'fieldnotes', 'quarry'];

function claudeWeights(a) {
  return [
    [P('herdr-app'), a < 260 ? (a < 60 ? 0.47 : a < 120 ? 0.42 : 0.3) : 0],
    [P('atlas-api'), a > 200 ? 0.34 : a < 60 ? 0.09 : 0.2],
    [P('nimbus-web'), a > 140 ? 0.27 : 0.15],
    [P('ledger-cli'), 0.1],
    [P('fieldnotes'), a > 240 ? 0.16 : 0.07],
    [P('quarry'), a < 75 ? 0.09 : a < 150 ? 0.03 : 0],
    [DEV, 0.025],
    [SCRATCH, 0.015],
  ].filter(([, w]) => w > 0);
}
function codexWeights(a) {
  return [
    [P('ledger-cli'), 0.28], [P('quarry'), a < 75 ? 0.24 : 0.05], [P('herdr-app'), 0.2],
    [P('atlas-api'), 0.16], [P('nimbus-web'), 0.1], [P('fieldnotes'), 0.02],
  ];
}

const TITLES = {
  'herdr-app': ['Add ruler ticks to usage chart', 'Port files panel to 0.1.18', 'Fix drag and drop between folders', 'Keep the wheel inside the projects list',
    'Wire the git panel to gh workflow runs', 'Split the find bar into its own module', 'Read Codex limits in the sidebar widget', 'Debounce folder watches in the files panel',
    'Fold model groups in the usage dialog', 'Draw the commit graph lanes once', 'Hide names for screen shares', 'Fix stale drafts after a rename'],
  'atlas-api': ['Refactor search index', 'Add rate limiting to the public API', 'Migrate orders table to UUID keys', 'Fix N+1 queries in invoice export',
    'Write OpenAPI spec for webhooks', 'Add idempotency keys to payments', 'Upgrade Postgres driver', 'Cache tenant settings in Redis'],
  'nimbus-web': ['Migrate auth middleware to sessions v2', 'Fix hydration mismatch on the pricing page', 'Add dark mode tokens to the design system',
    'Speed up the dashboard first paint', 'Replace the date picker', 'Move forms to server actions'],
  'ledger-cli': ['Fix flaky date parsing in CI', 'Add CSV import for bank statements', 'Support multi-currency balances', 'Rewrite the report renderer', 'Add a budget command'],
  'fieldnotes': ['Add full-text search to notes', 'Sync attachments in the background', 'Fix markdown table export', 'Add backlinks panel'],
  'quarry': ['Set up the ingestion pipeline', 'Add retries to the S3 uploader', 'Profile the parquet writer', 'Design the job scheduler schema', 'Backfill March events'],
  'Developer': ['Compare lockfiles across repos', 'Bump shared ESLint config everywhere', 'Audit CI secrets usage'],
  'bench-scratch': ['Benchmark JSON parsers', 'Try the new test runner'],
};
const titleNext = new Map();
function titleFor(project, r) {
  if (r() < 0.04) return null;
  const list = TITLES[path.basename(project)] || ['Quick fix'];
  const i = titleNext.get(project) ?? Math.floor(r() * list.length);
  titleNext.set(project, i + 1);
  return list[i % list.length];
}

// USD per 1M tokens [input, output, cache read, cache write]: what Claude Code's cost-state adds up.
const CLAUDE_PRICE = {
  'claude-fable-5-2': [10, 50, 1.0, 12.5],
  'claude-opus-5-5': [5, 25, 0.5, 6.25],
  'claude-sonnet-5-5': [3, 15, 0.3, 3.75],
  'claude-haiku-5-5': [1, 5, 0.1, 1.25],
};
const claudeCost = (m, u) => { const p = CLAUDE_PRICE[m]; return (u.in * p[0] + u.out * p[1] + u.cr * p[2] + u.cw * p[3]) / 1e6; };
// From collect.mjs's CODEX_PRICES [input, cached input, output, cache write]
const CODEX_PRICE = { 'gpt-6.2-sol': [2, 0.1, 10, 2.5], 'gpt-6.2-astra': [8, 0.4, 40, 10], 'gpt-6-luna': [0.1, 0.01, 0.5, 0.125] };
const codexCost = (m, e) => { const p = CODEX_PRICE[m]; return ((e.input - e.cached) * p[0] + e.cached * p[1] + e.out * p[2]) / 1e6; };

// A day's activity, 0 for none. Weekdays busier, weekends often off, a two-week August holiday,
// Christmas, some quiet days and days off; rising over the year.
function intensity(dm, kind) {
  const a = ago(dm);
  if (kind === 'codex' && a > 185) return 0;
  const t = new Date(dm);
  const mo = t.getMonth(), d = t.getDate(), dow = t.getDay();
  if (mo === 7 && d >= 8 && d <= 23) return 0;
  if ((mo === 11 && (d === 24 || d === 25 || d === 26 || d === 31)) || (mo === 0 && d === 1)) return 0;
  const r = rng(`int:${kind}:${dayStr(dm)}`);
  const weekend = dow === 0 || dow === 6;
  if (weekend && r() < 0.5) return a === 0 ? 0.4 : 0;
  if (!weekend && r() < 0.035 && a > 0) return 0;
  const base = [0.2, 0.95, 1.0, 1.05, 1.0, 0.85, 0.35][dow];
  const quiet = r() < 0.08 ? 0.25 : 1;
  const noise = 0.65 + r() * 0.6;
  let trend;
  if (kind === 'claude') trend = a > 300 ? 0.5 : a > 60 ? 0.5 + 0.5 * (300 - a) / 240 : a > 21 ? 1.05 : 1.12;
  else trend = a > 40 ? 0.3 + 0.7 * (185 - a) / 145 : 1.05;
  const v = base * quiet * noise * trend;
  return a === 0 ? Math.max(0.8, v) : v;
}
// Session start hours: a working day with a lunch dip and some evenings.
const HOURS = [0, 0, 0, 0, 0, 0, 0, 0.15, 0.7, 1.5, 1.6, 1.4, 0.6, 0.5, 1.3, 1.5, 1.5, 1.3, 1, 0.55, 0.35, 0.55, 0.45, 0.15].map((w, h) => [h, w]);

// ------------------------------------------------------------ Claude Code sessions

function claudeSession(seed, o) {
  const r = rng(seed);
  const sid = uuid(seed);
  const msgs = [];
  let seq = 0;
  const gap = 60_000 / o.rate;
  const upto = Math.min(o.upto ?? Infinity, NOW - 75_000);
  const reply = (ts, model, ctx, sub, cwOverride) => {
    const out = Math.round(clamp(logn(r, sub ? 380 : 520, 0.9), 40, 12000));
    const add = Math.round(400 + logn(r, sub ? 900 : 1500, 0.8));
    const u = { in: 1 + Math.floor(r() * (r() < 0.1 ? 40 : 6)), out, cr: ctx.v === 0 ? 0 : ctx.v, cw: cwOverride ?? (ctx.v === 0 ? ctx.first : add) };
    ctx.v = (ctx.v === 0 ? ctx.first : ctx.v + add) + out;
    const id = 'msg_01' + hex(`${seed}:${seq++}`, 22);
    return { id, ts: Math.round(ts), model, sub, u, cost: claudeCost(model, u) };
  };
  let t = o.start;
  const ctx = { v: 0, first: 14000 + Math.floor(r() * 10000) };
  for (let i = 0; i < o.replies; i++) {
    if (t > upto) break;
    const model = r() < 0.92 ? o.model : o.model === 'claude-fable-5-2' ? 'claude-opus-5-5' : 'claude-fable-5-2';
    let cw;
    if (ctx.v > 165000) { ctx.v = 0; ctx.first = 26000 + Math.floor(r() * 9000); }
    msgs.push(reply(t, model, ctx, false, cw));
    t += gap * (0.4 + 1.2 * r()) + (r() < 0.03 ? (5 + r() * 20) * MIN : 0);
  }
  const subs = [];
  if (msgs.length > 20) for (let k = 0; k < o.subs; k++) {
    const sm = [];
    const sctx = { v: 0, first: 9000 + Math.floor(r() * 5000) };
    const model = r() < 0.7 ? 'claude-haiku-5-5' : 'claude-sonnet-5-5';
    let st = msgs[Math.floor(r() * (msgs.length - 10))].ts + 5000;
    const n = 20 + Math.floor(r() * 80);
    for (let i = 0; i < n && st <= upto; i++) {
      if (sctx.v > 95000) { sctx.v = 0; sctx.first = 12000; }
      sm.push(reply(st, model, sctx, true));
      st += 8000 + r() * 20000;
    }
    if (sm.length) subs.push({ agent: hex(`${seed}:agent:${k}`, 16), msgs: sm });
  }
  return { sid, project: o.project, title: o.title, start: o.start, msgs, subs, all: [...msgs, ...subs.flatMap((s) => s.msgs)] };
}

// ------------------------------------------------------------ Codex sessions

function codexSession(seed, o) {
  const r = rng(seed);
  const id = uuid(seed);
  const upto = Math.min(o.upto ?? Infinity, NOW - 75_000);
  const run = (n, model, t0, ctx0, sub) => {
    const ev = [];
    let ctx = ctx0, prev = 0, t = t0;
    for (let i = 0; i < n && t <= upto; i++) {
      const add = Math.round(1000 + logn(r, 2500, 0.8));
      const input = ctx + add;
      const cached = prev === 0 ? 0 : Math.min(input, prev - Math.floor(r() * 400));
      const out = Math.round(clamp(logn(r, sub ? 500 : 900, 0.9), 30, 16000));
      const e = { ts: Math.round(t), model, input, cached: Math.max(0, cached), out, reasoning: Math.round(out * (0.3 + r() * 0.3)) };
      e.cost = codexCost(model, e);
      ev.push(e);
      ctx = input + out; prev = input;
      if (ctx > 240000) { ctx = 28000 + Math.floor(r() * 6000); prev = 0; }
      t += (40 + r() * 80) * 1000 * (o.slow ?? 1) + (r() < 0.03 ? (4 + r() * 15) * MIN : 0);
    }
    return ev;
  };
  const events = run(o.events, o.model, o.start, 9000 + Math.floor(r() * 5000), false);
  const forks = [];
  if (events.length > 15) for (let k = 0; k < o.forks; k++) {
    const t0 = events[Math.floor(r() * (events.length - 5))].ts + 3000;
    const ev = run(10 + Math.floor(r() * 40), 'gpt-6-luna', t0, 7000, true);
    if (ev.length) forks.push({ id: uuid(`${seed}:fork:${k}`), events: ev });
  }
  return { id, project: o.project, start: o.start, events, forks, all: [...events, ...forks.flatMap((f) => f.events)] };
}

// ------------------------------------------------------------ the last 30 days

const claude = [];
const codex = [];
const D = (k) => shift(TODAY, -k);
// The week's biggest sessions (made below; their replies count in their day's budget).
const HEROES = [
  [1, 9, 20, 'herdr-app', 'Port files panel to 0.1.18', 820, 'claude-fable-5-2', 3],
  [6, 10, 5, 'atlas-api', 'Refactor search index', 560, 'claude-fable-5-2', 2],
  [3, 14, 10, 'nimbus-web', 'Migrate auth middleware to sessions v2', 560, 'claude-opus-5-5', 1],
  [4, 9, 40, 'ledger-cli', 'Fix flaky date parsing in CI', 480, 'claude-fable-5-2', 2],
  [5, 15, 0, 'fieldnotes', 'Add full-text search to notes', 430, 'claude-sonnet-5-5', 1],
  [2, 9, 30, 'herdr-app', 'Draw the commit graph lanes once', 520, 'claude-fable-5-2', 1],
];
const XHEROES = [[1, 9, 30, 'quarry', 420, 'gpt-6.2-sol'], [3, 10, 30, 'ledger-cli', 330, 'gpt-6.2-astra']];
const heroBudget = (list, i, n) => list.filter((h) => D(h[0]) === i).reduce((a, h) => a + h[n] * 1.15, 0);
for (let dm = T_FROM; dm <= TODAY; dm = shift(dm, 1)) {
  const ds = dayStr(dm), a = ago(dm);
  const ic = intensity(dm, 'claude');
  const rc = rng(`cday:${ds}`);
  for (let total = heroBudget(HEROES, dm, 5) + (dm === TODAY ? 500 : 0), n = 0, target = Math.round(ic * 1150); total < target; n++) {
    const size = Math.round(clamp(logn(rc, 110, 0.8), 15, 420));
    const start = at(dm, pick(rc, HOURS), Math.floor(rc() * 60));
    if (start > NOW) { total += size; continue; }
    const project = pick(rc, claudeWeights(a));
    const model = pick(rc, [['claude-fable-5-2', 0.68], ['claude-opus-5-5', 0.2], ['claude-sonnet-5-5', 0.12]]);
    const s = claudeSession(`c:${ds}:${n}`, { project, start, replies: size, rate: 1.4 + rc() * 1.4, model, subs: rc() < 0.45 ? 1 + Math.floor(rc() * 3) : 0, title: titleFor(project, rc) });
    total += s.msgs.length + 0.3 * (s.all.length - s.msgs.length);
    if (s.msgs.length) claude.push(s);
  }
  const ix = intensity(dm, 'codex');
  const rx = rng(`xday:${ds}`);
  for (let total = heroBudget(XHEROES, dm, 4) + (dm === TODAY ? 80 : 0), n = 0, target = Math.round(ix * 240); total < target; n++) {
    const size = Math.round(clamp(logn(rx, 45, 0.8), 6, 260));
    total += size;
    const start = at(dm, pick(rx, HOURS), Math.floor(rx() * 60));
    if (start > NOW) continue;
    const model = rx() < 0.75 ? 'gpt-6.2-sol' : 'gpt-6.2-astra';
    const s = codexSession(`x:${ds}:${n}`, { project: pick(rx, codexWeights(a)), start, events: size, model, forks: rx() < 0.3 ? 1 + Math.floor(rx() * 2) : 0 });
    if (s.events.length) codex.push(s);
  }
}
// The week's biggest sessions, and what runs right now (Burning now: within 15 and 60 minutes).
for (const [k, h, m, p, title, replies, model, subs] of HEROES) {
  const start = at(D(k), h, m);
  if (start < NOW) claude.push(claudeSession(`hero:${title}`, { project: P(p), start, replies, rate: 2.2, model, subs, title }));
}
for (const [k, h, m, p, events, model] of XHEROES) {
  const start = at(D(k), h, m);
  if (start < NOW) codex.push(codexSession(`xhero:${p}:${k}`, { project: P(p), start, events, model, forks: 2 }));
}
claude.push(claudeSession('live:herdr', { project: P('herdr-app'), start: NOW - 150 * MIN, replies: 9999, rate: 3.5, model: 'claude-fable-5-2', subs: 2, title: 'Fold model groups in the usage dialog' }));
claude.push(claudeSession('live:atlas', { project: P('atlas-api'), start: NOW - 55 * MIN, upto: NOW - 19 * MIN, replies: 9999, rate: 1.2, model: 'claude-opus-5-5', subs: 0, title: 'Cache tenant settings in Redis' }));
claude.push(claudeSession('live:nimbus', { project: P('nimbus-web'), start: NOW - 38 * MIN, upto: NOW - 4 * MIN, replies: 9999, rate: 1.5, model: 'claude-sonnet-5-5', subs: 1, title: 'Replace the date picker' }));
codex.push(codexSession('live:ledger', { project: P('ledger-cli'), start: NOW - 70 * MIN, replies: 0, events: 9999, model: 'gpt-6.2-sol', forks: 1 }));
codex.push(codexSession('live:quarry', { project: P('quarry'), start: NOW - 52 * MIN, upto: NOW - 26 * MIN, events: 9999, model: 'gpt-6.2-astra', forks: 0, slow: 1.3 }));

// ------------------------------------------------------------ the limits

// Usable time, as pace.js counts it: 08:00 to midnight, local.
function usable(from, to) {
  let total = 0;
  for (let day = midnight(from); day < to; day = shift(day, 1)) {
    const s = at(day, 8), e = shift(day, 1);
    total += Math.max(0, Math.min(e, to) - Math.max(s, from));
  }
  return total;
}
function paceFraction(start, end) { return Math.min(1, Math.max(usable(start, NOW), 16 * HOUR) / usable(start, end)); }

// Cumulative cost over sorted [ts, cost]: W(t), the cost in (from, t].
function cumulative(items) {
  const xs = items.slice().sort((a, b) => a[0] - b[0]);
  const ts = xs.map((x) => x[0]);
  const cs = [];
  let acc = 0;
  for (const x of xs) { acc += x[1]; cs.push(acc); }
  return (from, t) => {
    const lo = (v) => { let a = 0, b = ts.length; while (a < b) { const m = (a + b) >> 1; if (ts[m] <= v) a = m + 1; else b = m; } return a; };
    const i = lo(t), j = lo(from);
    return (i ? cs[i - 1] : 0) - (j ? cs[j - 1] : 0);
  };
}

// Claude: the window began 4.4 days ago; the reading is where a "tight" week stands (~94%
// projected), around 61% at this point of the week.
const AT = NOW - 60_000; // when the statusline file was written
const C_START = Math.round((NOW - 4.4 * DAY) / HOUR) * HOUR;
const C_RESETS = C_START + WEEK;
const C_PCT = clamp(Math.round(94 * paceFraction(C_START, C_RESETS)), 45, 75);
const Wc = cumulative(claude.flatMap((s) => s.all.map((m) => [m.ts, m.cost])));
const cNow = Wc(C_START, AT) || 1;
const cPct = (t) => Math.floor(C_PCT * Wc(C_START, t) / cNow + 1e-9);
const cTrail = [];
for (let t = C_START + HOUR; t < AT - 25 * MIN; t += HOUR) {
  const v = cPct(t);
  if (v > (cTrail.length ? cTrail[cTrail.length - 1][1] : 0)) cTrail.push([t - Math.floor(rng(`ct:${t}`)() * 40) * MIN, v]);
}
const samples = [];
// The statusline's last samples: under 20 minutes of them, so no burst line (pace.js burn()).
for (let t = AT - 15 * MIN; t < AT; t += 5 * MIN) samples.push([t, cPct(t)]);
samples.push([AT, C_PCT]);

// An earlier week's trail: readings each active day, rising to its peak.
function syntheticTrail(resets, peak, kind) {
  const start = resets - WEEK;
  const days = [];
  for (let dm = midnight(start); dm < resets; dm = shift(dm, 1)) days.push([dm, intensity(dm, kind)]);
  const total = days.reduce((a, [, v]) => a + v, 0) || 1;
  const trail = [];
  let acc = 0;
  for (const [dm, v] of days) {
    if (!v) continue;
    for (const [h, part] of [[13, 0.45], [19, 0.9], [23, 1]]) {
      const t = at(dm, h, 10);
      if (t <= start || t >= resets) continue;
      const pct = Math.round(peak * (acc + v * part) / total);
      if (pct > (trail.length ? trail[trail.length - 1][1] : 0)) trail.push([t, pct]);
    }
    acc += v;
  }
  if (!trail.length || trail[trail.length - 1][1] < peak) trail.push([resets - 3 * HOUR, peak]);
  return trail;
}
const C_PEAKS = [84, 100, 71, 38, 79, 88, 66, 73, 100, 62, 70]; // k = 1, 2, ...: newest first
const claudeWeeks = { [String(C_RESETS)]: cTrail };
C_PEAKS.forEach((peak, i) => { const r = C_RESETS - (i + 1) * WEEK; claudeWeeks[String(r)] = syntheticTrail(r, peak, 'claude'); });

// Codex: the window began 3.9 days ago; comfortably on pace (~58% projected), around 34%.
const X_START = Math.round((NOW - 3.9 * DAY) / MIN) * MIN + 17_000;
const X_RESETS = X_START + WEEK;
const X_PCT = clamp(Math.round(58 * paceFraction(X_START, X_RESETS)), 25, 45);
const X_PEAKS = [62, 74, 100, 58, 81, 29, 69, 77, 64, 86, 71];
const xEvents = codex.flatMap((s) => s.all);
const Wx = cumulative(xEvents.map((e) => [e.ts, e.cost]));
const xLast = Math.max(...xEvents.map((e) => e.ts));
// Only the weekly window: the pictures show no five-hour limits.
function codexLimits(e) {
  const k = Math.floor((X_RESETS - 1 - e.ts) / WEEK);
  const R = X_RESETS - k * WEEK;
  const pct = k === 0 ? Math.round(X_PCT * Wx(X_START, e.ts) / (Wx(X_START, xLast) || 1))
    : Math.round(X_PEAKS[k - 1] * Wx(R - WEEK, e.ts) / (Wx(R - WEEK, R) || 1));
  const jitter = Math.floor(rng(`jit:${e.ts}`)() * 9) - 4;
  return {
    secondary: { used_percent: clamp(pct, 0, 100), window_minutes: 10080, resets_at: Math.round(R / 1000) + jitter },
    plan_type: 'pro',
  };
}
const codexWeeks = {};
X_PEAKS.forEach((peak, i) => { const r = X_RESETS - (i + 1) * WEEK; if (r <= T_FROM) codexWeeks[String(r)] = syntheticTrail(r, peak, 'codex'); });

// ------------------------------------------------------------ history before the transcripts

const rows = [], sessRows = [];
const MEAN = {
  main: { in: 6, out: 640, cr: 88000, cw: 2500 },
  sub: { in: 5, out: 380, cr: 30000, cw: 1700 },
  xmain: { input: 118000, cachedShare: 0.94, out: 1100 },
  xsub: { input: 40000, cachedShare: 0.92, out: 500 },
};
for (let dm = H_FROM; dm < T_FROM; dm = shift(dm, 1)) {
  const ds = dayStr(dm), a = ago(dm);
  const r = rng(`hist:${ds}`);
  const split = (weights, total) => {
    const ws = weights.map(([k, w]) => [k, w * (0.5 + r())]);
    const tot = ws.reduce((x, [, w]) => x + w, 0);
    return ws.map(([k, w]) => [k, Math.round(total * w / tot)]).filter(([, n]) => n >= 3);
  };
  const ic = intensity(dm, 'claude');
  if (ic > 0) for (const [project, n] of split(claudeWeights(a), Math.round(ic * 1150))) {
    for (const [model, share, sub] of [['claude-fable-5-2', 0.6, false], ['claude-opus-5-5', 0.2, false], ['claude-sonnet-5-5', 0.13, false], ['claude-haiku-5-5', 0.07, true]]) {
      const k = Math.round(n * share * (0.7 + 0.6 * r()));
      if (k < 1) continue;
      const m = MEAN[sub ? 'sub' : 'main'];
      const f = () => k * (0.85 + 0.3 * r());
      const u = { in: Math.round(f() * m.in), out: Math.round(f() * m.out), cr: Math.round(f() * m.cr), cw: Math.round(f() * m.cw) };
      rows.push({ d: ds, h: null, agent: 'claude', where: 'host', box: null, project, model, sub, n: k, ...u, cost: Math.round(claudeCost(model, u) * 1e6) / 1e6 });
    }
    sessRows.push({ d: ds, agent: 'claude', where: 'host', box: null, project, n: Math.max(1, Math.round(n / 140)) });
  }
  const ix = intensity(dm, 'codex');
  if (ix > 0) for (const [project, n] of split(codexWeights(a), Math.round(ix * 240))) {
    for (const [model, share, sub] of [['gpt-6.2-sol', 0.7, false], ['gpt-6.2-astra', 0.22, false], ['gpt-6-luna', 0.08, true]]) {
      const k = Math.round(n * share * (0.7 + 0.6 * r()));
      if (k < 1) continue;
      const m = MEAN[sub ? 'xsub' : 'xmain'];
      const input = Math.round(k * m.input * (0.85 + 0.3 * r()));
      const cr = Math.round(input * m.cachedShare);
      rows.push({ d: ds, h: null, agent: 'codex', where: 'host', box: null, project, model, sub, n: k, in: input - cr, out: Math.round(k * m.out * (0.85 + 0.3 * r())), cr, cw: 0, cost: null });
    }
    sessRows.push({ d: ds, agent: 'codex', where: 'host', box: null, project, n: Math.max(1, Math.round(n / 50)) });
  }
}
const activity = [], modelTokens = [];
for (let dm = S_FROM; dm < H_FROM; dm = shift(dm, 1)) {
  const ic = intensity(dm, 'claude');
  if (!ic) continue;
  const r = rng(`stats:${dayStr(dm)}`);
  const n = Math.round(ic * 1150);
  activity.push({ date: dayStr(dm), messageCount: Math.round(n * (1.6 + 0.3 * r())), sessionCount: Math.max(1, Math.round(n / 140)), toolCallCount: Math.round(n * (0.8 + 0.2 * r())) });
  modelTokens.push({ date: dayStr(dm), tokensByModel: { 'claude-opus-5-5': Math.round(n * 520 * (0.9 + 0.2 * r())), 'claude-sonnet-5-5': Math.round(n * 120 * (0.9 + 0.2 * r())) } });
}

// ------------------------------------------------------------ writing

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
for (const p of ['.claude/projects', '.claude/statusline/.usage-cache.json', '.claude/stats-cache.json', '.codex/sessions', '.local/state/herdr-usage']) rm(path.join(HOME, p));
const files = [];
function put(file, lines, mtime) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  files.push([file, mtime]);
}
const encode = (p) => p.replace(/[/._]/g, '-');
const VERSION = '2.3.14';
const branchOf = (title) => (title ? 'feat/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) : 'main');

for (const s of claude) {
  const dir = path.join(HOME, '.claude', 'projects', encode(s.project));
  const branch = branchOf(s.title);
  const asst = (m, sub, agentId) => ({
    parentUuid: uuid(`${m.id}:p`), isSidechain: sub, userType: 'external', cwd: s.project, sessionId: s.sid, version: VERSION, gitBranch: branch,
    ...(agentId ? { agentId } : {}),
    message: { id: m.id, type: 'message', role: 'assistant', model: m.model, content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: m.u.in, cache_creation_input_tokens: m.u.cw, cache_read_input_tokens: m.u.cr, output_tokens: m.u.out,
        cache_creation: { ephemeral_5m_input_tokens: m.u.cw, ephemeral_1h_input_tokens: 0 }, service_tier: 'standard' } },
    requestId: 'req_011' + m.id.slice(6, 26), type: 'assistant', uuid: uuid(`${m.id}:u`), timestamp: iso(m.ts),
  });
  const mu = {};
  for (const m of s.all) {
    const x = (mu[m.model] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 });
    x.inputTokens += m.u.in; x.outputTokens += m.u.out; x.cacheReadInputTokens += m.u.cr; x.cacheCreationInputTokens += m.u.cw; x.costUSD += m.cost;
  }
  if (!mu['claude-haiku-5-5']) mu['claude-haiku-5-5'] = { inputTokens: 1400, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.00155 }; // the title call
  const total = Object.values(mu).reduce((a, x) => a + x.costUSD, 0);
  for (const x of Object.values(mu)) x.costUSD = Math.round(x.costUSD * 1e6) / 1e6;
  const last = s.all.reduce((a, m) => Math.max(a, m.ts), s.start);
  const lines = [
    { parentUuid: null, isSidechain: false, userType: 'external', cwd: s.project, sessionId: s.sid, version: VERSION, gitBranch: branch, type: 'user',
      message: { role: 'user', content: s.title ? s.title + '.' : 'Look at the failing build.' }, uuid: uuid(`${s.sid}:first`), timestamp: iso(s.start - 4000) },
  ];
  s.msgs.forEach((m, i) => { lines.push(asst(m, false)); if (i === 0 && s.title) lines.push({ type: 'ai-title', aiTitle: s.title, sessionId: s.sid }); });
  lines.push({ type: 'cost-state', sessionId: s.sid, totalCostUSD: Math.round(total * 1e6) / 1e6, startTime: s.start, modelUsage: mu });
  put(path.join(dir, `${s.sid}.jsonl`), lines, last);
  for (const sub of s.subs) put(path.join(dir, s.sid, 'subagents', `agent-${sub.agent}.jsonl`), sub.msgs.map((m) => asst(m, true, sub.agent)), sub.msgs[sub.msgs.length - 1].ts);
}

for (const s of codex) {
  const write = (id, meta, model, events) => {
    const t0 = events[0].ts - 2000;
    const lt = new Date(t0);
    const folder = path.join(HOME, '.codex', 'sessions', String(lt.getFullYear()), pad(lt.getMonth() + 1), pad(lt.getDate()));
    const name = `rollout-${lt.getFullYear()}-${pad(lt.getMonth() + 1)}-${pad(lt.getDate())}T${pad(lt.getHours())}-${pad(lt.getMinutes())}-${pad(lt.getSeconds())}-${id}.jsonl`;
    const tot = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
    const lines = [
      { timestamp: iso(t0), type: 'session_meta', payload: { id, timestamp: iso(t0), cwd: s.project, originator: 'codex_cli_rs', cli_version: '0.98.0', model_provider: 'openai', ...meta } },
      { timestamp: iso(t0 + 500), type: 'turn_context', payload: { cwd: s.project, approval_policy: 'on-request', sandbox_policy: { mode: 'workspace-write' }, model, effort: 'medium', summary: 'auto' } },
    ];
    for (const e of events) {
      const last = { input_tokens: e.input, cached_input_tokens: e.cached, output_tokens: e.out, reasoning_output_tokens: e.reasoning, total_tokens: e.input + e.out };
      for (const k of Object.keys(tot)) tot[k] += last[k];
      lines.push({ timestamp: iso(e.ts), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { ...tot }, last_token_usage: last, model_context_window: 272000 }, rate_limits: codexLimits(e) } });
    }
    put(path.join(folder, name), lines, events[events.length - 1].ts);
  };
  write(s.id, { source: 'cli' }, s.events[0].model, s.events);
  for (const f of s.forks) write(f.id, { session_id: s.id, forked_from_id: s.id, source: { subagent: { thread_spawn: { parent_thread_id: s.id } } }, thread_source: 'subagent' }, 'gpt-6-luna', f.events);
}

// Files in time order, each with the time of its last line (the glance takes the newest Codex file).
for (const [f, m] of files) fs.utimesSync(f, new Date(m), new Date(m));

const statusline = path.join(HOME, '.claude', 'statusline', '.usage-cache.json');
fs.mkdirSync(path.dirname(statusline), { recursive: true });
fs.writeFileSync(statusline, JSON.stringify({
  sevenDay: C_PCT, sevenDayResets: iso(C_RESETS),
  week: { resets: iso(C_RESETS), peak: C_PCT, samples },
}));
fs.utimesSync(statusline, new Date(AT), new Date(AT));

fs.writeFileSync(path.join(HOME, '.claude', 'stats-cache.json'), JSON.stringify({
  version: 2, lastComputedDate: dayStr(shift(TODAY, -1)), dailyActivity: activity, dailyModelTokens: modelTokens,
}));

const state = path.join(HOME, '.local', 'state', 'herdr-usage');
fs.mkdirSync(state, { recursive: true });
fs.writeFileSync(path.join(state, 'history.json'), JSON.stringify({ v: 1, rows, sessions: sessRows }));
fs.writeFileSync(path.join(state, 'limits.json'), JSON.stringify({ v: 1, claudeWeeks, codexWeeks }));

const replies = claude.reduce((a, s) => a + s.all.length, 0), events = codex.reduce((a, s) => a + s.all.length, 0);
console.log(`gen-usage: ${HOME}: ${claude.length} Claude sessions (${replies} replies), ${codex.length} Codex sessions (${events} events), ` +
  `${rows.length} history rows, ${activity.length} stats days; Claude week ${C_PCT}%, Codex week ${X_PCT}%`);
