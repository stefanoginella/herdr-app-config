// A limit reading as words and as a block: the dialog's verdict and limits column, the sidebar
// widget and the status bar all say it this way. Nothing in it touches the app, so it runs under
// node (limits.test.mjs).
//
//   fromCache()  the statusline's cache file as a weekly reading (the collector's rule)
//   limitBlock() one limit: its percentage, the even-pace point, the verdict, the reset
//   danger()     how bad a block is; byDanger() sorts blocks, the most in danger first
//   judge()      the dialog's two sentences, for the weekly limit most in danger (verdict(): one)
//   short()      the glances' few words

import { pace, verdict as gauge, burn, usableMsBetween, formatBudget, formatRate, WEEK_MS, HOUR_MS, USABLE_DAY_MS, localMidnight } from "./pace.js";

const DAY_MS = 86_400_000;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n) => (n < 10 ? "0" : "") + n;
export const clock = (ms) => { const t = new Date(ms); return `${pad(t.getHours())}:${pad(t.getMinutes())}`; };

// "today", "tomorrow" or the weekday.
export function dayWord(ms, now) {
  const d = localMidnight(ms), today = localMidnight(now);
  if (d === today) return "today";
  const next = new Date(today); next.setDate(next.getDate() + 1);
  if (d === next.getTime()) return "tomorrow";
  return WEEKDAYS[new Date(ms).getDay()];
}
// "Fri 11:32", or "today 11:32".
export function shortWhen(ms, now) {
  const w = dayWord(ms, now);
  return `${w === "today" || w === "tomorrow" ? w : w.slice(0, 3)} ${clock(ms)}`;
}
// "3d 19h", "5h 12m", "40m".
export function span(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m % 60}m`;
}
// A span as said aloud: to the hour ("1d 21h", "5h"), with minutes under three hours ("2h 20m").
export function dur(ms) {
  if (ms < 3 * HOUR_MS) {
    const m = Math.max(0, Math.round(ms / 60_000)), h = Math.floor(m / 60);
    return h > 0 ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
  }
  const h = Math.round(ms / HOUR_MS), d = Math.floor(h / 24);
  return d > 0 ? (h % 24 ? `${d}d ${h % 24}h` : `${d}d`) : `${h}h`;
}

// A run-out time moves by many minutes between readings: it is said to the half hour.
export const HALF_HOUR = 30 * 60_000;
export function dryAt(ms) { return Math.round(ms / HALF_HOUR) * HALF_HOUR; }

// The statusline's cache: the highest of its 7-day reading, the week's peak and its samples, when
// they are of the same window (as collect.mjs's claudeLimits reads it).
export function fromCache(text) {
  let c;
  try { c = JSON.parse(text); } catch { return null; }
  if (!c || typeof c !== "object" || typeof c.sevenDay !== "number") return null;
  const ms = (x) => { if (x === null || x === undefined) return null; const t = typeof x === "number" ? x : Date.parse(x); return Number.isFinite(t) ? t : null; };
  const resets = ms(c.sevenDayResets);
  let pct = c.sevenDay;
  const w = c.week && typeof c.week === "object" ? c.week : null;
  const samples = w && Array.isArray(w.samples) && ms(w.resets) === resets ? w.samples.filter((s) => Array.isArray(s) && Number.isFinite(s[1])) : [];
  if (w && ms(w.resets) === resets && typeof w.peak === "number") pct = Math.max(pct, w.peak);
  for (const s of samples) pct = Math.max(pct, s[1]);
  const fiveHour = typeof c.fiveHour === "number" ? { pct: c.fiveHour, resets: ms(c.fiveHourResets) } : null;
  return { pct, resets, samples, fiveHour };
}

// One limit. `windowMs`: its window. Weeks are measured in usable hours, as the statusline does;
// a shorter window (five hours) by the clock. → null when there is no reading of this window.
export function limitBlock(pct, resets, windowMs, now) {
  if (pct == null || !resets || resets <= now) return null;
  const start = resets - windowMs;
  let even, p;
  if (windowMs >= DAY_MS) {
    const total = usableMsBetween(start, resets);
    even = total > 0 ? 100 * usableMsBetween(start, Math.min(now, resets)) / total : 0;
    p = pace(pct, resets, now, windowMs);
  } else {
    even = 100 * Math.max(0, Math.min(1, (now - start) / windowMs));
    const elapsed = Math.max(now - start, windowMs / 10);
    const projected = pct * windowMs / elapsed;
    const runsOutAt = pct < 100 && projected > 100 ? now + (100 - pct) * elapsed / pct : null;
    p = pct >= 100 ? { state: "out" } : { state: "ok", projected, runsOutAt: runsOutAt && runsOutAt < resets ? runsOutAt : null, budgetPerDay: null };
  }
  const level = p ? gauge(p).level : "ok";
  return { pct, resets, start, even, diff: Math.round(pct - even), level, pace: p };
}

// "23 points over an even pace".
// "17 points over pace", "36 under pace", "on pace" (within one point).
export function paceWords(b) {
  const d = b.diff;
  if (Math.abs(d) <= 1) return "on pace";
  const n = Math.abs(d);
  return d > 0 ? `${n} points over pace` : `${n} under pace`;
}

// The week's average per usable day, with the statusline's floor of one usable day.
export function perDay(pct, resets, now) {
  const start = resets - WEEK_MS;
  const elapsed = Math.min(usableMsBetween(start, resets), Math.max(usableMsBetween(start, now), USABLE_DAY_MS));
  return elapsed > 0 ? pct * USABLE_DAY_MS / elapsed : 0;
}

// How bad a block is, as [rank, projection]: dry 3, runs dry before its reset 2, tight 1, ok 0.
export function danger(b) {
  const p = b?.pace;
  if (!p) return [-1, 0];
  if (p.state === "out") return [3, 1000];
  if (p.runsOutAt) return [2, p.projected];
  return [b.level === "tight" ? 1 : 0, p.projected ?? b.pct];
}
// Blocks (or anything with a `block`), the most in danger first; the order is kept between equals.
export function byDanger(list, get = (x) => x.block ?? x) {
  return list.map((x, i) => [x, danger(get(x)), i]).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1] || a[2] - b[2]).map(([x]) => x);
}

// The dialog's verdict for the weekly limits: { level, one, two, burst, agent }. `limits`:
// [{ agent, name, week: { pct, resets, samples }, at }], `at` being when the reading was taken
// (for the burst). It speaks for the limit most in danger; when none is (all on pace and under
// the tight mark) and there are two, the first line names both.
export function judge(limits, now) {
  const live = limits.filter((l) => l.week && l.week.pct != null && l.week.resets && l.week.resets > now)
    .map((l) => ({ ...l, block: limitBlock(l.week.pct, l.week.resets, WEEK_MS, now) }));
  if (!live.length) return { level: "none", one: "No limit reading yet.", two: "The statusline writes one after the next reply." };
  const [first, ...rest] = byDanger(live);
  const v = { ...one(first.name, first.week, first.at, now), agent: first.agent };
  if (v.level === "ok" && rest.length && rest.every((l) => l.block.level === "ok")) {
    v.one = `${first.name} is on pace to end the week at ${Math.round(first.block.pace.projected)}%, ${rest.map((l) => `${l.name} at ${Math.round(l.block.pace.projected)}%`).join(", ")}.`;
  }
  return v;
}

// One weekly limit's verdict: { level, one, two }. `week`: { pct, resets, samples } or null.
export function verdict(week, at, now) {
  return judge([{ agent: "claude", name: "Claude", week, at }], now);
}

function one(name, week, at, now) {
  const b = limitBlock(week.pct, week.resets, WEEK_MS, now);
  const p = b.pace;
  if (p?.state === "out") {
    return { level: "out", one: `${name}'s week is dry.`, two: `Resets ${dayWord(week.resets, now)} ${clock(week.resets)}, in ${dur(week.resets - now)}.` };
  }
  const using = formatRate(perDay(week.pct, week.resets, now));
  const budget = p?.budgetPerDay != null ? formatBudget(p.budgetPerDay) : null;
  // The run-out time is always the week's average pace's. A burst is the second line only.
  const bu = burn(week, at ?? now, now);
  const burstLine = bu ? `Last hour: ${formatRate(bu.perHour)}% an hour, dry by ${shortWhen(bu.runsOutAt, now).replace(/^today /, "")} at that rate.` : null;
  const end = Math.round(p.projected);
  if (p.runsOutAt) {
    const r = dryAt(p.runsOutAt);
    return {
      level: "over", burst: bu,
      one: `${name} runs dry ${dayWord(r, now)} around ${clock(r)}, ${dur(week.resets - r)} before the reset.`,
      two: burstLine ?? `Using ${using}% a day.` + (budget ? ` ${budget}% would last.` : ""),
    };
  }
  if (b.level === "tight") {
    return { level: "tight", burst: bu, one: `${name} is on pace to end the week at ${end}%.`, two: burstLine ?? `Using ${using}% a day.` + (budget ? ` ${budget}% would last.` : "") };
  }
  return { level: "ok", burst: bu, one: `${name} is on pace to end the week at ${end}%.`, two: burstLine ?? `Using ${using}% a day.` + (budget ? ` Up to ${budget}% would last.` : "") };
}

// The glances' words: "dry Fri ~11:30", "tight: on pace for 97%", "on pace for 86%",
// "dry until Sun 06:00". `bar`: the status bar's shorter set.
export function short(b, now, bar = false) {
  if (!b) return bar ? "no reading" : "No reading yet";
  const p = b.pace;
  if (p?.state === "out") return bar ? "dry" : `dry until ${shortWhen(b.resets, now)}`;
  if (p?.runsOutAt) { const w = shortWhen(dryAt(p.runsOutAt), now).split(" "); return `dry ${w[0]} ~${w[1]}`; }
  if (b.level === "tight") return bar ? "tight" : `tight: on pace for ${Math.round(p.projected)}%`;
  return bar ? "on pace" : `on pace for ${Math.round(p?.projected ?? b.pct)}%`;
}

// Theme color of a level.
export function levelColor(level, t) {
  return level === "ok" ? t.ansi2 : level === "tight" ? t.ansi3 : level === "none" ? t.dim : t.ansi1;
}

export { HOUR_MS };
