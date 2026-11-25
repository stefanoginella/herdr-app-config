// node --test reduce.test.mjs
// What the dashboard works out, on a small made-up answer of collect.mjs from two machines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, weekView, rangeView, yearView, modelName, dayString, burning, tokens, weekSpan, SCRATCH_KEY } from './reduce.js';

const H = 3_600_000;
const now = new Date(2026, 10, 24, 18, 30).getTime(); // Tue 24 Nov, 18:30 local
const resets = new Date(2026, 10, 29, 6, 0).getTime(); // Sun 29 Nov, 06:00
const day = (k) => dayString(now + k * 86_400_000);
// Tokens default to ten for each dollar (as cache read), or `tk`.
const row = ({ tk, ...o }) => {
  const r = { h: null, agent: 'claude', where: 'host', box: null, model: 'claude-opus-5-5', sub: false, n: 1, in: 0, out: 0, cr: 0, cw: 0, cost: 1, ...o };
  if (!('cr' in o)) r.cr = tk ?? 10 * (typeof r.cost === 'number' ? r.cost : 1);
  return r;
};

const here = {
  tz: 'Europe/Rome',
  limits: { claude: { at: now - 60_000, fiveHour: null, week: { pct: 40, resets, samples: [], trail: [] } }, codex: { at: now - H, plan: 'pro', primary: { pct: 3, windowMinutes: 10080, resets }, secondary: null, week: { pct: 3, resets, trail: [[now - 3 * H, 2]] }, weeks: [{ resets: resets - 7 * 86_400_000, peak: 55 }] } },
  rows: [
    row({ d: day(0), h: 10, project: '/fixtures/u/a', cost: 30, n: 10 }),
    row({ d: day(0), h: 11, project: '/fixtures/u/b', cost: 10, n: 5, sub: true }),
    row({ d: day(-1), h: 15, project: '/private/tmp/x', cost: 5 }),
    row({ d: day(-1), h: 16, project: '/private/var/folders/y', cost: 5 }),
    row({ d: day(-1), h: 9, agent: 'codex', model: 'gpt-5.1-codex-mini', project: '/fixtures/u/c', cost: null, n: 7, tk: 70, est: true }),
    row({ d: day(-1), h: 12, where: 'container', box: 'proj', project: '/fixtures/u/a', cost: 2 }),
    row({ d: day(-200), project: '/fixtures/u/a', cost: 100, n: 50 }),
  ],
  sessions: [{ d: day(0), agent: 'claude', where: 'host', box: null, project: '/fixtures/u/a', n: 2 }],
  older: { activity: [{ date: '2026-01-01', messageCount: 10, sessionCount: 1 }, { date: '2026-01-02', messageCount: 5, sessionCount: 2 }], tokens: [] },
  // collector v2
  top: [
    { agent: 'claude', sessionId: 's1', project: '/fixtures/u/a', where: 'host', box: null, title: 'Milestone build', first: now - 3 * H, last: now - 2 * H, n: 9, tok: 250, cost: 25, model: 'claude-opus-5-5', sub: 0.7 },
    { agent: 'claude', sessionId: 's2', project: '/fixtures/u/b', where: 'host', box: null, title: null, first: now - 30 * H, last: now - 29 * H, n: 3, tok: 90, cost: 9, model: 'claude-opus-5-5', sub: 0 },
    { agent: 'claude', sessionId: 's3', project: '/fixtures/u/a', where: 'host', box: null, title: 'Old one', first: now - 20 * 86_400_000, last: now - 20 * 86_400_000, n: 3, tok: 400, cost: 40, model: 'claude-opus-5-5', sub: 0 },
  ],
  recent: [
    { agent: 'claude', where: 'host', box: null, project: '/fixtures/u/a', cost15: 2, cost60: 5, n15: 1, n60: 3, tok60: 500, last: now - 5 * 60_000 },
    { agent: 'codex', where: 'host', box: null, project: '/fixtures/u/a', cost15: 0, cost60: 0.5, n15: 0, n60: 2, tok60: 900, last: now - 20 * 60_000, est: true },
    { agent: 'claude', where: 'host', box: null, project: '/fixtures/u/b', cost15: 0, cost60: 1, n15: 0, n60: 1, tok60: 100, last: now - 40 * 60_000 },
  ],
  took: { docker: 'timeout' },
};
const there = {
  tz: 'Etc/UTC',
  limits: { claude: { at: now - 5 * H, fiveHour: { pct: 0, resets: null }, week: { pct: 20, resets, samples: [], trail: [] } }, codex: null },
  rows: [row({ d: day(0), h: 9, project: '/home/u/a', cost: 8 })],
  sessions: [],
};
const data = prepare([{ machine: null, doc: here }, { machine: 'server', doc: there }], now);

test('the freshest limit reading wins, from any machine', () => {
  assert.equal(data.claude.week.pct, 40);
  assert.equal(data.codex.plan, 'pro');
});

test('scratch folders are one project; a name two machines share gets the machine', () => {
  assert.ok(data.projects[SCRATCH_KEY]);
  const as = Object.values(data.projects).filter((p) => p.name === 'a');
  assert.equal(as.length, 2);
  assert.deepEqual(as.map((p) => p.dim).sort(), ['server', 'this Mac']);
});

test('the week: the used band ends at the limit, the even pace runs 0 to 100', () => {
  const w = weekView(data, now);
  assert.equal(w.agent, 'claude');
  assert.equal(w.pts[0][0], '\n/fixtures/u/a');
  assert.ok(Math.abs(w.pts.reduce((a, x) => a + x[1], 0) + w.ptsRest - 40) < 0.05);
  assert.equal(w.none, false);
  const top = w.tops[w.tops.length - 1];
  assert.ok(Math.abs(top[top.length - 1] - 40) < 1e-9);
  assert.equal(w.top[0], '\n/fixtures/u/a'); // 30 + 2 in the container
  assert.equal(w.even[0][1], 0);
  assert.equal(w.even[w.even.length - 1][1], 100);
  assert.equal(w.projection[0][1], 40);
  for (let i = 1; i < w.projection.length; i++) assert.ok(w.projection[i][1] >= w.projection[i - 1][1]);
});

test('no reading: the week says so and still ranks its projects', () => {
  const w = weekView({ ...data, claude: null }, now);
  assert.equal(w.none, true);
  assert.equal(w.top[0], '\n/fixtures/u/a');
});

test('ranges: tokens, dollars, filter, machines, models, subagents', () => {
  const claims = weekView(data, now).top;
  const week = rangeView(data, 'week', null, now, claims);
  assert.equal(week.T, 10 * (30 + 10 + 5 + 5 + 2 + 8) + 70);
  assert.equal(week.cost, 30 + 10 + 5 + 5 + 2 + 8); // Codex's row has no price
  assert.equal(week.est, 0);
  assert.equal(week.n, 10 + 5 + 1 + 1 + 7 + 1 + 1);
  assert.equal(week.sessions, 2);
  assert.equal(week.bars.length, 7);
  assert.equal(week.projects.find((p) => p.key === SCRATCH_KEY).T, 100);
  assert.equal(week.projects[0].key, '\n/fixtures/u/a');
  assert.deepEqual(week.machines.map((m) => [m.m, m.box]), [['', null], ['', 'proj'], ['server', null]]);
  assert.equal(week.machines[1].T, 20);
  // s1 and s2 are in the week: fewer than three, so both, whatever the average.
  assert.deepEqual(week.biggest.map((s) => s.title), ['Milestone build', null]);
  assert.equal(rangeView(data, 'day', null, now, claims).biggest.length, 1);
  assert.equal(rangeView(data, 'week', '\n/fixtures/u/b', now, claims).biggest.length, 1);
  assert.deepEqual([week.cgroup.T, week.xgroup.T, week.cgroup.cost], [600, 70, 60]);
  assert.equal(week.codex[0].name, 'GPT-5.1 Codex Mini');
  assert.equal(week.codex[0].priced, false);
  assert.equal(week.claude[0].priced, true);
  assert.ok(Math.abs(week.claude[0].share + week.codex[0].share - 1) < 1e-9); // one unit, both agents
  assert.ok(week.sparks['\n/fixtures/u/a'].length === 7);
  assert.equal(week.sub, 100 / 670);
  const only = rangeView(data, 'week', '\n/fixtures/u/b', now, claims);
  assert.equal(only.T, 100);
  assert.equal(only.projects.length, week.projects.length); // the list stays whole
  const dayv = rangeView(data, 'day', null, now, claims);
  assert.equal(dayv.bars.length, 24);
  assert.equal(dayv.bars.reduce((a, b) => a + b.v, 0), 10 * (30 + 10 + 8)); // yesterday's rows are before 18:30
});

test('biggest sessions: at or over the average, at least three, at most six', () => {
  const top = [900, 800, 100, 90, 80, 70, 60, 50].map((tok, i) => ({ agent: i === 2 ? 'codex' : 'claude', sessionId: `x${i}`, project: '/fixtures/u/a', title: `S${i}`, first: now - H, last: now - H, n: 1, tok, cost: tok / 100, est: i === 2, sub: 0 }));
  const d = prepare([{ machine: null, doc: { ...here, top } }], now);
  assert.deepEqual(rangeView(d, 'week', null, now, []).biggest.map((s) => s.tok), [900, 800, 100]); // average 268.75
  const even = top.map((x) => ({ ...x, tok: 10 }));
  assert.equal(rangeView(prepare([{ machine: null, doc: { ...here, top: even } }], now), 'week', null, now, []).biggest.length, 6);
  const b = rangeView(d, 'week', null, now, []).biggest[2];
  assert.deepEqual([b.agent, b.est, b.cost], ['codex', 1, 1]); // the estimated part, in dollars
});

test('all: a bar a week past 90 days, and the counts from before the transcripts', () => {
  const all = rangeView(data, 'all', null, now, []);
  assert.equal(all.unit, 'week');
  assert.ok(all.bars.length >= 28 && all.bars.length <= 31);
  assert.equal(all.cost, 160);
  assert.equal(all.T, 1600 + 70);
  assert.deepEqual([all.older.msgs, all.older.sessions], [15, 3]);
});

test('the change is per full day, against as many full days before, only when on record', () => {
  const rows = [row({ d: day(-20), project: '/fixtures/u/a', cost: 1 }), row({ d: day(0), h: 10, project: '/fixtures/u/a', cost: 100 })];
  for (let k = 1; k <= 12; k++) rows.push(row({ d: day(-k), project: '/fixtures/u/a', cost: k <= 6 ? 2 : 1 }));
  const d = prepare([{ machine: null, doc: { ...here, rows } }], now);
  const v = rangeView(d, 'week', null, now, []);
  assert.equal(v.prev.change, 1); // 6 days at 2 against 6 days at 1; today's 100 left out
  const young = prepare([{ machine: null, doc: { ...here, rows: rows.filter((r) => r.d >= day(-8)) } }], now);
  assert.equal(rangeView(young, 'week', null, now, []).prev, null);
  assert.equal(rangeView(d, 'all', null, now, []).prev, null);
});

test('v2 parts: earlier weeks, recent, docker; a v1 document leaves them out', () => {
  const v2 = prepare([{ machine: null, doc: { ...here, limits: { ...here.limits, claude: { ...here.limits.claude, weeks: [{ resets, peak: 40 }, { resets: resets - 7 * 86_400_000, peak: 91 }, { resets: resets - 14 * 86_400_000, peak: 100 }] } } } }], now);
  assert.deepEqual(weekView(v2, now).earlier, [{ resets: resets - 14 * 86_400_000, peak: 100 }, { resets: resets - 7 * 86_400_000, peak: 91 }]);
  assert.deepEqual(weekView(data, now).earlier, []);
  assert.deepEqual(data.recent.map((x) => [x.p, x.agent, x.cost60, x.n60, x.last]), [['\n/fixtures/u/a', 'codex', 0.5, 2, now - 20 * 60_000], ['\n/fixtures/u/a', 'claude', 5, 3, now - 5 * 60_000], ['\n/fixtures/u/b', 'claude', 1, 1, now - 40 * 60_000]]);
  assert.equal(data.hasRecent, true);
  assert.equal(data.docker[''], 'timeout');
  const v1 = prepare([{ machine: null, doc: { ...here, top: undefined, recent: undefined, took: undefined } }], now);
  assert.deepEqual([v1.top, v1.recent, v1.hasRecent], [[], [], false]);
});

test('the used curve passes through the week\'s readings', () => {
  const at1 = new Date(2026, 10, 23, 12).getTime(), at2 = new Date(2026, 10, 24, 9).getTime();
  const rows = [row({ d: day(-1), h: 10, project: '/fixtures/u/a', cost: 10 }), row({ d: day(0), h: 10, project: '/fixtures/u/b', cost: 10 })];
  const claude = { ...here.limits.claude, week: { pct: 40, resets, samples: [], trail: [[at1, 30]] } };
  const w = weekView(prepare([{ machine: null, doc: { ...here, rows, limits: { ...here.limits, claude } } }], now), now);
  const used = (t) => { const last = w.tops[w.tops.length - 1]; const i = w.times.findIndex((x) => x >= t); return last[i]; };
  assert.equal(used(at2), 30); // all of the first day's cost is the rise to the reading
  assert.equal(w.tops[w.tops.length - 1].at(-1), 40);
  assert.deepEqual(w.readings.map((r) => r[1]), [30, 40]);
  assert.deepEqual(w.points.map(Math.round), [20, 20, 0]);
  // Without readings: as before, the cost scaled to today's reading.
  const plain = weekView(prepare([{ machine: null, doc: { ...here, rows } }], now), now);
  assert.equal(plain.tops[plain.tops.length - 1].at(-1), 40);
});

test('the home folder and folders holding projects join "Other folders"', () => {
  const rows = [row({ d: day(0), h: 10, project: '/fixtures/u', cost: 3 }), row({ d: day(0), h: 10, project: '/fixtures/workspace', cost: 4 }),
    row({ d: day(0), h: 10, project: '/fixtures/workspace/app', cost: 5 }), row({ d: day(0), h: 10, project: '/fixtures/workspace/site', cost: 1 }),
    row({ d: day(0), h: 10, project: '/fixtures/workspace/app/plugin', cost: 2 })];
  const d = prepare([{ machine: null, doc: { ...here, rows } }], now);
  assert.equal(d.projects[SCRATCH_KEY].name, 'Other folders');
  assert.ok(!d.projects['\n/fixtures/u'] && !d.projects['\n/fixtures/workspace']);
  // A project with one project inside it stays a project, and so does the one inside.
  assert.ok(d.projects['\n/fixtures/workspace/app'] && d.projects['\n/fixtures/workspace/app/plugin']);
  assert.equal(rangeView(d, 'week', null, now, []).projects.find((p) => p.key === SCRATCH_KEY).cost, 7);
});

test('the colors: the limits\' claims first, then the range\'s own biggest, six at most', () => {
  const v = rangeView(data, 'month', null, now, ['\n/fixtures/u/b']);
  assert.equal(v.segKeys[0], '\n/fixtures/u/b');
  assert.ok(v.segKeys.includes('\n/fixtures/u/a'));
  assert.equal(v.bars[0].segs.length, v.segKeys.length + 1);
  const many = rangeView(data, 'month', null, now, ['k1', 'k2', 'k3', 'k4', 'k5']);
  assert.deepEqual(many.segKeys, ['k1', 'k2', 'k3', 'k4', 'k5', '\n/fixtures/u/a']);
  assert.equal(rangeView(data, 'month', null, now, ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']).segKeys.length, 6);
});

test('Codex\'s week: its own trail, its estimate as the weight, its earlier weeks', () => {
  const rows = [
    row({ d: day(0), h: 10, agent: 'codex', model: 'gpt-5.5', project: '/fixtures/u/c', cost: 4, est: true, tk: 4000 }),
    row({ d: day(0), h: 11, agent: 'codex', model: 'gpt-5.5', project: '/fixtures/u/d', cost: 1, est: true, tk: 9000 }),
    row({ d: day(0), h: 10, project: '/fixtures/u/a', cost: 50 }),
  ];
  const d = prepare([{ machine: null, doc: { ...here, rows } }], now);
  const w = weekView(d, now, 'codex');
  assert.equal(w.agent, 'codex');
  assert.equal(w.none, false);
  assert.deepEqual(w.top, ['\n/fixtures/u/c', '\n/fixtures/u/d']); // by estimated cost, not tokens
  assert.deepEqual(w.pts.map((x) => x[1]), [2.4, 0.6]);
  assert.deepEqual(w.readings.map((r) => r[1]), [2, 3]);
  assert.deepEqual([w.cost, w.tok, w.est], [5, 13000, 5]);
  assert.deepEqual(w.earlier, [{ resets: resets - 7 * 86_400_000, peak: 55 }]);
  assert.equal(weekView(d, now, 'claude').top[0], '\n/fixtures/u/a');
  // No cost at all: by tokens.
  const free = prepare([{ machine: null, doc: { ...here, rows: rows.map((r) => ({ ...r, cost: null })) } }], now);
  assert.deepEqual(weekView(free, now, 'codex').top, ['\n/fixtures/u/d', '\n/fixtures/u/c']);
  assert.equal(weekView({ ...d, codex: null }, now, 'codex').none, true);
});

test('recent: one entry a project and agent, merged across machines and into Other folders', () => {
  const a = data.recent.filter((x) => x.p === '\n/fixtures/u/a');
  assert.deepEqual(a.map((x) => [x.agent, x.tok60, x.cost60, x.est]), [['codex', 900, 0.5, true], ['claude', 500, 5, false]]);
  // Two machines' entries of one project and agent are one; a home folder joins Other folders.
  const more = { ...here, recent: [...here.recent,
    { agent: 'claude', where: 'container', box: 'proj', project: '/fixtures/u/a', cost15: 0, cost60: 2, n15: 0, n60: 1, tok60: 300, last: now - 2 * 60_000 },
    { agent: 'claude', where: 'host', box: null, project: '/fixtures/u', cost60: 1, n60: 1, tok60: 50, last: now - 60_000 }] };
  const d = prepare([{ machine: null, doc: more }], now);
  const ca = d.recent.find((x) => x.p === '\n/fixtures/u/a' && x.agent === 'claude');
  assert.deepEqual([ca.tok60, ca.cost60, ca.n60, ca.last], [800, 7, 4, now - 2 * 60_000]);
  assert.ok(d.recent.some((x) => x.p === SCRATCH_KEY && x.agent === 'claude' && x.tok60 === 50));
});

test('burning: each agent its own first rows, the rest counted', () => {
  const b = burning(data.recent, 1);
  assert.deepEqual(b.claude.rows.map((x) => x.p), ['\n/fixtures/u/a']);
  assert.deepEqual([b.claude.more, b.claude.moreTok], [1, 100]);
  assert.deepEqual(b.codex.rows.map((x) => [x.p, x.tok60]), [['\n/fixtures/u/a', 900]]);
  assert.deepEqual([b.codex.more, b.codex.moreTok], [0, 0]);
  assert.deepEqual(burning([], 3).claude, { rows: [], more: 0, moreTok: 0 });
});

test('the year: 53 weeks to this one, days ranked within their kind, the gap named', () => {
  const y = yearView(data, now);
  assert.equal(y.steps.length, 53 * 7);
  const todayIndex = Math.round((new Date(2026, 10, 24).getTime() - y.first) / 86_400_000);
  assert.ok(y.steps[todayIndex] >= 1);
  assert.equal(y.steps[todayIndex + 1], -1); // Wednesday: to come
  assert.ok(y.months.length >= 12);
  assert.equal(new Date(y.first).getDay(), 1);
  const gap = prepare([{ machine: null, doc: { ...here, rows: here.rows.filter((r) => r.d >= day(-1)), older: { activity: [{ date: dayString(now - 12 * 86_400_000), messageCount: 9, sessionCount: 1 }] } } }], now);
  const g = yearView(gap, now);
  assert.equal(g.caption, "Before 23 Nov: Claude Code's message counts. 13\u201322 Nov: no record.");
  assert.equal(g.split, Math.floor(Math.round((new Date(2026, 10, 23).getTime() - g.first) / 86_400_000) / 7));
});

test('the year\'s records: the busiest day, active days, the longest streak', () => {
  const rows = [3, 2, 1, 6, 7].map((k, i) => row({ d: day(-k), project: '/fixtures/u/a', cost: [5, 1, 2, 9, 1][i] }));
  rows.push(row({ d: day(0), h: 9, project: '/fixtures/u/a', cost: 1 }));
  const y = yearView(prepare([{ machine: null, doc: { ...here, rows, older: { activity: [] } } }], now), now);
  assert.deepEqual(y.records.busiest, { day: new Date(2026, 10, 18).getTime(), T: 90 });
  assert.deepEqual([y.records.active, y.records.days, y.records.streak], [6, 8, 4]);
  const i = Math.round((new Date(2026, 10, 21).getTime() - y.first) / 86_400_000);
  assert.deepEqual(y.vals[i], [50, 5, 0]);
});

test('tokens: input, output, cache write, cache read, for the range, a bar, a project and each agent', () => {
  const doc = { ...here, rows: [
    row({ d: day(0), h: 10, project: '/fixtures/u/a', in: 10, out: 20, cw: 30, cr: 400 }),
    row({ d: day(0), h: 11, project: '/fixtures/u/b', agent: 'codex', cost: null, in: 5, out: 6, cw: 0, cr: 70 }),
  ] };
  const d = prepare([{ machine: null, doc }], now);
  const v = rangeView(d, 'week', null, now, []);
  assert.deepEqual(v.tokens, [15, 26, 30, 470]);
  assert.deepEqual([v.cgroup.T, v.xgroup.T], [460, 81]);
  assert.deepEqual(v.bars[6].tok, [15, 26, 30, 470]);
  assert.deepEqual(v.projects.find((p) => p.key === '\n/fixtures/u/b').tok, [5, 6, 0, 70]);
  assert.deepEqual(rangeView(d, 'week', '\n/fixtures/u/a', now, []).tokens, [10, 20, 30, 400]);
});

test('model names', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(modelName('gpt-6.1-sol'), 'GPT-6.1 Sol');
  assert.equal(modelName('codex-auto-review'), 'Codex Auto Review');
  assert.equal(modelName('unknown'), 'Unknown model');
});

test('tokens: a value that rounds to 1000 of a unit is said in the next one', () => {
  assert.deepEqual([999, 999.6, 1500, 9_960, 999_400, 999_500, 5_120_000, 999_499_999, 999_500_000, 1_000_000_000, 1.25e12].map(tokens),
    ['999', '1k', '1.5k', '10k', '999k', '1M', '5.1M', '999M', '1B', '1B', '1.3T']);
});

test('weekSpan: the days of a weekly window', () => {
  assert.equal(weekSpan(new Date(2026, 10, 16, 6, 0).getTime()), '9–15 Nov');
  assert.equal(weekSpan(new Date(2026, 11, 7, 6, 0).getTime()), '30 Nov – 6 Dec');
});
