// The weekly pace, as Claude Code's statusline works it out (~/.claude/statusline/statusline.mjs:
// getPace, usableMsBetween, addUsableMs, paceVerdict, getBurn). Ported, not imported: a mod can
// only import from its own folder. pace.test.mjs runs both on the same readings and fails on
// any difference, so keep the two the same.
//
// Time is counted in usable hours, DAY_START_HOUR to midnight, local time: nights add elapsed
// time but no usage, and the projection would otherwise swing through the day. The statusline
// reads CLAUDE_DAY_START_HOUR to move it; this view can't see that variable and keeps 8.
//
// Nothing here touches the app, so it runs under node.

export const DAY_START_HOUR = 8;
export const WEEK_MS = 7 * 86_400_000;
export const HOUR_MS = 3_600_000;
// One usable day: the elapsed time is never taken as less, so the week's first hours don't
// project to several hundred percent.
export const USABLE_DAY_MS = (24 - DAY_START_HOUR) * HOUR_MS;
const PACE_MAX_DAYS = 10;
// At or over this projected reading the pace is tight.
export const PACE_TIGHT_AT = 85;
export const PACE_SEGMENTS = 5;

// The burst: the rate of the last stretch, shown only when it empties the limit soon.
const BURN_KEEP_MS = 90 * 60_000;
const BURN_MIN_SPAN_MS = 20 * 60_000;
const BURN_MIN_RISE = 2;
const BURN_HORIZON_MS = 8 * HOUR_MS;

export function localMidnight(ms) {
  const m = new Date(ms);
  m.setHours(0, 0, 0, 0);
  return m.getTime();
}

// With setHours, not by adding 24 hours: a day with a clock change is 23 or 25 hours long.
export function nextLocalMidnight(ms) {
  const m = new Date(ms);
  m.setHours(24, 0, 0, 0);
  return m.getTime();
}

export function usableStart(dayMs) {
  const s = new Date(dayMs);
  s.setHours(DAY_START_HOUR, 0, 0, 0);
  return s.getTime();
}

// Usable milliseconds inside [from, to).
export function usableMsBetween(from, to) {
  let total = 0;
  let day = localMidnight(from);
  for (let i = 0; i < PACE_MAX_DAYS && day < to; i++) {
    const end = nextLocalMidnight(day);
    total += Math.max(0, Math.min(end, to) - Math.max(usableStart(day), from));
    day = end;
  }
  return total;
}

// The moment at which `ms` of usable time has passed after `from`, or null.
export function addUsableMs(from, ms) {
  let left = ms;
  let day = localMidnight(from);
  for (let i = 0; i < PACE_MAX_DAYS; i++) {
    const end = nextLocalMidnight(day);
    const start = Math.max(usableStart(day), from);
    const span = Math.max(0, end - start);
    if (left <= span) return Math.trunc(start + left); // as a Date would hold it
    left -= span;
    day = end;
  }
  return null;
}

// → null (no reading), { state: "out" }, or { state: "ok", projected, runsOutAt, budgetPerDay,
// rate }: `rate` is the week's average, in percent per usable millisecond (the floored one).
// `windowMs`: the limit's window; the statusline's is always a week. Codex's weekly window is
// measured the same way.
export function pace(pct, resets, now, windowMs = WEEK_MS) {
  if (pct == null || !resets || resets <= now) return null;
  if (pct >= 100) return { state: "out" };
  const windowStart = resets - windowMs;
  const total = usableMsBetween(windowStart, resets);
  if (total <= 0) return null;
  const elapsed = Math.min(total, Math.max(usableMsBetween(windowStart, now), USABLE_DAY_MS));
  const projected = pct * total / elapsed;
  let runsOutAt = null;
  if (projected > 100) {
    const at = addUsableMs(now, (100 - pct) * elapsed / pct);
    if (at !== null && at < resets) runsOutAt = at;
  }
  const left = usableMsBetween(now, resets);
  const budgetPerDay = left >= USABLE_DAY_MS ? (100 - pct) * USABLE_DAY_MS / left : null;
  return { state: "ok", projected, runsOutAt, budgetPerDay, rate: pct / elapsed };
}

// The five-segment gauge: more filled, more to spare at the reset.
//   ≤50 ▰▰▰▰▰   ≤70 ▰▰▰▰▱   <85 ▰▰▰▱▱   ≥85 ▰▰▱▱▱ tight   runs out early ▰▱▱▱▱ over
export function verdict(p) {
  if (p.state === "out") return { filled: 0, level: "out" };
  if (p.runsOutAt) return { filled: 1, level: "over" };
  if (p.projected >= PACE_TIGHT_AT) return { filled: 2, level: "tight" };
  return { filled: p.projected > 70 ? 3 : p.projected > 50 ? 4 : 5, level: "ok" };
}

// Rounded down, so the figure never overstates what can be spent.
export function formatBudget(v) {
  return String(v >= 10 ? Math.floor(v) : Math.floor(v * 10) / 10);
}

export function formatRate(v) {
  return String(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
}

// → null, or { perHour, runsOutAt }. The statusline works this out at the moment of a reading;
// here the reading is the one its cache file holds, so `at` (when it was written) stands for
// that moment, and a burst whose end has already passed is no longer one.
export function burn(week, at, now) {
  if (!week || week.pct == null || !week.resets || !Array.isArray(week.samples)) return null;
  const samples = week.samples.filter((s) => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[0] <= at && at - s[0] <= BURN_KEEP_MS);
  const peak = samples.reduce((m, s) => Math.max(m, s[1]), week.pct);
  const current = Math.max(week.pct, peak);
  if (current >= 100) return null;
  let base = null;
  for (const s of samples) if (at - s[0] >= BURN_MIN_SPAN_MS) base = s;
  if (!base || current - base[1] < BURN_MIN_RISE) return null;
  const perHour = (current - base[1]) / ((at - base[0]) / HOUR_MS);
  const msLeft = (100 - current) / perHour * HOUR_MS;
  if (msLeft > BURN_HORIZON_MS) return null;
  const runsOutAt = Math.trunc(at + msLeft);
  if (runsOutAt <= now || runsOutAt >= week.resets) return null;
  return { perHour, runsOutAt };
}

// The even pace at `t`: the share of the window's usable time gone by then.
export function evenAt(start, end, t) {
  const total = usableMsBetween(start, end);
  return total > 0 ? 100 * usableMsBetween(start, Math.min(Math.max(t, start), end)) / total : 0;
}

// Every moment in [from, to] where the even pace or the projection changes slope: the ends,
// each 08:00 and each midnight. Straight lines between them draw the staircase exactly.
export function bends(from, to) {
  const out = [from];
  let day = localMidnight(from);
  for (let i = 0; i < PACE_MAX_DAYS + 1 && day < to; i++) {
    const s = usableStart(day), e = nextLocalMidnight(day);
    if (s > from && s < to) out.push(s);
    if (e > from && e < to) out.push(e);
    day = e;
  }
  out.push(to);
  return out;
}
