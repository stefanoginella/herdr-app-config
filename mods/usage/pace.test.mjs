// node --test pace.test.mjs
// The port in pace.js against the statusline itself, on the same readings. Skipped when the
// statusline is not on this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as mine from './pace.js';

const SL = path.join(os.homedir(), '.claude', 'statusline', 'statusline.mjs');
const has = fs.existsSync(SL) && process.env.CLAUDE_DAY_START_HOUR === undefined;
const theirs = has ? await import(pathToFileURL(SL).href) : null;

// A small deterministic random walk over a few weeks, clock changes included.
function* readings() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const base = Date.parse('2026-03-20T00:00:00Z');
  for (let i = 0; i < 4000; i++) {
    const resets = base + Math.floor(rnd() * 240) * 3_600_000 + Math.floor(rnd() * 60) * 60_000;
    const now = resets - Math.floor(rnd() * 7 * 86_400_000);
    const pct = Math.floor(rnd() * 105);
    yield { pct, resets, now };
  }
}

test('pace equals the statusline', { skip: !has }, () => {
  for (const { pct, resets, now } of readings()) {
    const a = mine.pace(pct, resets, now);
    const b = theirs.getPace({ sevenDay: pct, sevenDayResets: new Date(resets) }, new Date(now));
    if (b === null) { assert.equal(a, null); continue; }
    assert.equal(a.state, b.state);
    if (b.state === 'out') continue;
    assert.equal(a.projected, b.projected);
    assert.equal(a.runsOutAt, b.runsOutAt ? b.runsOutAt.getTime() : null);
    assert.equal(a.budgetPerDay, b.budgetPerDay);
    assert.deepEqual(mine.verdict(a), theirs.paceVerdict(b));
    if (a.budgetPerDay !== null) assert.equal(mine.formatBudget(a.budgetPerDay), theirs.formatBudget(a.budgetPerDay));
  }
});

test('usable time equals the statusline', { skip: !has }, () => {
  for (const { resets, now } of readings()) {
    const from = resets - mine.WEEK_MS;
    assert.equal(mine.usableMsBetween(from, now), theirs.usableMsBetween(new Date(from), new Date(now)));
    const ms = (now % 50) * 3_600_000;
    const b = theirs.addUsableMs(new Date(now), ms);
    assert.equal(mine.addUsableMs(now, ms), b ? b.getTime() : null);
  }
});

test('burst equals the statusline at the moment of the reading', { skip: !has }, () => {
  const resets = Date.parse('2026-11-29T04:00:00Z');
  const at = Date.parse('2026-11-24T15:00:00Z');
  const cases = [
    [[at - 40 * 60_000, 80], [at - 10 * 60_000, 84]],
    [[at - 60 * 60_000, 50], [at - 30 * 60_000, 60]],
    [[at - 30 * 60_000, 89]],
    [[at - 5 * 60_000, 80]],
  ];
  for (const samples of cases) for (const pct of [85, 90, 95, 99]) {
    const peak = Math.max(pct, ...samples.map((s) => s[1]));
    const b = theirs.getBurn({ sevenDay: pct, sevenDayResets: new Date(resets), week: { peak, samples } }, new Date(at));
    const a = mine.burn({ pct, resets, samples }, at, at - 1);
    if (b === null) { assert.equal(a, null); continue; }
    assert.equal(a.perHour, b.perHour);
    assert.equal(a.runsOutAt, b.runsOutAt.getTime());
  }
});

test('the staircase is flat at night and whole by the reset', () => {
  const resets = Date.parse('2026-11-29T04:00:00Z');
  const start = resets - mine.WEEK_MS;
  assert.equal(mine.evenAt(start, resets, start), 0);
  assert.equal(mine.evenAt(start, resets, resets), 100);
  const b = mine.bends(start, resets);
  for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1]);
  for (let i = 1; i < b.length; i++) {
    const h = new Date((b[i] + b[i - 1]) / 2).getHours();
    const flat = mine.evenAt(start, resets, b[i]) === mine.evenAt(start, resets, b[i - 1]);
    assert.equal(flat, h < mine.DAY_START_HOUR);
  }
});
