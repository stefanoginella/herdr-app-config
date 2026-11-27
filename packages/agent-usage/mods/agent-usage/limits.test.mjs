// node --test limits.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from './limits.js';

const H = 3_600_000, DAY = 86_400_000;
const resets = new Date(2026, 10, 29, 6, 0).getTime(); // Sunday 06:00
const now = new Date(2026, 10, 25, 11, 0).getTime(); // Wednesday 11:00

test('the cache file: the highest of the reading, the peak and the samples of the same window', () => {
  const iso = new Date(resets).toISOString();
  const c = (o) => JSON.stringify({ fiveHour: null, fiveHourResets: null, sevenDay: 50, sevenDayResets: iso, ...o });
  assert.equal(L.fromCache(c({})).pct, 50);
  assert.equal(L.fromCache(c({ week: { resets: iso, peak: 61, samples: [[now, 58]] } })).pct, 61);
  assert.equal(L.fromCache(c({ week: { resets: iso, peak: 52, samples: [[now, 63]] } })).pct, 63);
  assert.equal(L.fromCache(c({ week: { resets: new Date(resets - 7 * DAY).toISOString(), peak: 90, samples: [[now, 95]] } })).pct, 50);
  // A statusline that keeps each session's last reading: its peak is the reading, a reset's too.
  assert.equal(L.fromCache(c({ sevenDay: 96, week: { resets: iso, peak: 71, samples: [[now, 71]], seen: { a: [71, now] } } })).pct, 71);
  assert.deepEqual(L.fromCache(c({ fiveHour: 12, fiveHourResets: iso })).fiveHour, { pct: 12, resets });
  assert.equal(L.fromCache('{'), null);
  assert.equal(L.fromCache('{"sevenDay":null}'), null);
});

test('the verdict in each case', () => {
  const v = (pct) => L.verdict({ pct, resets, samples: [] }, now, now);
  assert.equal(v(20).level, 'ok');
  assert.match(v(20).one, /^Claude is on pace to end the week at \d+%\.$/);
  assert.match(v(20).two, /^Using [\d.]+% a day\. Up to [\d.]+% would last\.$/);
  assert.equal(v(45).level, 'tight');
  assert.match(v(45).two, /^Using [\d.]+% a day\. [\d.]+% would last\.$/);
  assert.equal(v(70).level, 'over');
  assert.match(v(70).one, /^Claude runs dry (today|tomorrow|\w+day) around \d\d:(00|30), (\d+d )?\d+h before the reset\.$/);
  assert.match(v(70).two, /^Using [\d.]+% a day\. [\d.]+% would last\.$/);
  assert.equal(v(100).one, "Claude's week is dry.");
  assert.equal(v(100).two, 'Resets Sunday 06:00, in 3d 19h.');
  assert.equal(L.verdict(null, now, now).one, 'No limit reading yet.');
});

test('a burst is the second line; the first keeps the weekly pace\'s time', () => {
  const week = { pct: 80, resets, samples: [[now - 50 * 60_000, 70], [now - 30 * 60_000, 74]] };
  const v = L.verdict(week, now - 60_000, now);
  const calm = L.verdict({ ...week, samples: [] }, now - 60_000, now);
  assert.ok(v.burst);
  assert.equal(v.one, calm.one);
  assert.match(v.two, /^Last hour: [\d.]+% an hour, dry by \d\d:\d\d at that rate\.$/);
});

test('the run-out time is said to the half hour, the same in the verdict and the glances', () => {
  const b = L.limitBlock(70, resets, 7 * DAY, now);
  const r = L.dryAt(b.pace.runsOutAt);
  assert.equal(r % (30 * 60_000), 0);
  assert.ok(Math.abs(r - b.pace.runsOutAt) <= 15 * 60_000);
  assert.ok(L.verdict({ pct: 70, resets, samples: [] }, now, now).one.includes(`around ${L.clock(r)}`));
  assert.equal(L.short(b, now), `dry ${L.shortWhen(r, now).split(' ')[0]} ~${L.clock(r)}`);
});

test('a block: the even point, the words, the short words', () => {
  const b = L.limitBlock(61, resets, 7 * DAY, now);
  assert.ok(b.even > 40 && b.even < 50);
  assert.equal(L.paceWords(b), `${b.diff} points over pace`);
  assert.equal(L.paceWords({ diff: -36 }), '36 under pace');
  assert.equal(L.paceWords({ diff: -1 }), 'on pace');
  assert.equal(L.paceWords({ diff: 0 }), 'on pace');
  assert.match(L.short(b, now), /^dry \w+ ~\d\d:(00|30)$/);
  assert.equal(L.short(L.limitBlock(100, resets, 7 * DAY, now), now), 'dry until Sun 06:00');
  assert.equal(L.limitBlock(10, now - 1, 7 * DAY, now), null);
  // A five-hour window, by the clock.
  const f = L.limitBlock(30, now + 2.5 * H, 5 * H, now);
  assert.equal(Math.round(f.even), 50);
  assert.equal(f.level, 'ok');
});

test('words for spans', () => {
  assert.equal(L.dur(1.75 * DAY + 20 * 60_000), '1d 18h');
  assert.equal(L.dur(3 * DAY + 2 * H), '3d 2h');
  assert.equal(L.dur(5 * H + 29 * 60_000), '5h');
  assert.equal(L.dur(2 * H + 20 * 60_000), '2h 20m');
  assert.equal(L.dur(40 * 60_000), '40m');
  assert.equal(L.span(3 * DAY + 19 * H + 5 * 60_000), '3d 19h');
});

test('two weekly limits: the one most in danger speaks; both on pace share the first line', () => {
  const week = (pct) => ({ pct, resets, samples: [] });
  const two = (a, b) => L.judge([{ agent: 'claude', name: 'Claude', week: week(a), at: now }, { agent: 'codex', name: 'Codex', week: week(b), at: now }], now);
  const dry = two(20, 70);
  assert.equal(dry.agent, 'codex');
  assert.match(dry.one, /^Codex runs dry /);
  assert.equal(dry.one, L.verdict(week(70), now, now).one.replace('Claude', 'Codex'));
  const calm = two(20, 5);
  assert.equal(calm.level, 'ok');
  assert.match(calm.one, /^Claude is on pace to end the week at \d+%, Codex at \d+%\.$/);
  assert.equal(two(5, 20).agent, 'codex'); // the higher projection first
  assert.match(two(45, 5).one, /^Claude is on pace to end the week at \d+%\.$/); // tight: Claude alone
  assert.equal(two(100, 70).one, "Claude's week is dry.");
  assert.equal(L.judge([{ agent: 'codex', name: 'Codex', week: null, at: now }], now).level, 'none');
  const order = L.byDanger([L.limitBlock(20, resets, 7 * DAY, now), L.limitBlock(100, resets, 7 * DAY, now), L.limitBlock(70, resets, 7 * DAY, now)]);
  assert.deepEqual(order.map((b) => b.pct), [100, 70, 20]);
});
