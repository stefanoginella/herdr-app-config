// Hide names in a notification: the title and body the toast draws while shared `names.hidden` is
// on (alias.js). Pure: the live names come in as `world` ({ spaces, machines, panes, terminals,
// agents, home }), so it runs under `node` (names.test.mjs). Only what is drawn changes: the
// notification's action, and what a Copy copies, stay real.

import * as alias from "./alias.js";

// Herdr's own agent toast (`alert` in its window.rs): "<name> needs you" or "<name> finished", the
// name being the terminal's, else its program's, else "An agent"; "<space> / <tab>" below it; and a
// click that runs agent.focus on the agent.
const AGENT = /^(.+) (needs you|finished)$/s;
const ANYONE = "An agent";

// Letters, digits and `_` join a word: a name is replaced only as a whole word.
const WORD = "\\p{L}\\p{N}_";
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// The tab bar's program for a tab: its agent's, else its first pane's (as `tabs-names` finds it).
const lead = (tab, panes) => (panes.find((p) => p.tab === tab.id && p.program?.agent) ?? panes.find((p) => p.tab === tab.id))?.program?.name;
const tabName = (tab, panes) => alias.label(tab.name, lead(tab, panes));

// Every real name the window draws, by its lower case, with its made-up one. The first kind to
// claim a name keeps it: spaces, then machines, branches, tabs, panes and terminals. Names that
// stay as they are (`~`, a number, `main`, a program's) and one-letter ones are left out.
export function known(world) {
  const map = new Map();
  const add = (real, fake) => {
    const r = String(real ?? "").trim();
    if (r.length < 2 || String(fake ?? "").trim() === r || map.has(r.toLowerCase())) return;
    map.set(r.toLowerCase(), fake);
  };
  const spaces = world.spaces ?? [], panes = world.panes ?? [];
  for (const s of spaces) add(s.name, alias.project(s.name));
  for (const m of world.machines ?? []) if (m.name) add(m.name, alias.machine(m.name));
  for (const s of spaces) if (s.machine) add(s.machine, alias.machine(s.machine));
  for (const b of [...spaces, ...panes].map((x) => x.branch)) if (b) add(b, alias.branch(b));
  for (const s of spaces) for (const c of s.tabs ?? []) add(c.name, tabName(c, panes));
  for (const p of panes) if (p.name) add(p.name, alias.label(p.name, p.program?.name));
  for (const t of world.terminals ?? []) if (t.name) add(t.name, alias.label(t.name, t.program?.name));
  return map;
}

// A function from any text to the same text with every known name made up, and this computer's
// home folder as `~`.
export function hider(world) {
  const map = known(world);
  const reals = [...map.keys()].sort((a, b) => b.length - a.length);
  const names = reals.length ? new RegExp(`(^|[^${WORD}])(${reals.map(escape).join("|")})(?![${WORD}])`, "giu") : null;
  const home = String(world.home ?? "").replace(/\/+$/, "");
  const homes = home.length > 1 ? new RegExp(`${escape(home)}(?![${WORD}.-])`, "gu") : null;
  return (text) => {
    let out = String(text ?? "");
    if (homes) out = out.replace(homes, "~");
    if (names) out = out.replace(names, (_m, before, name) => before + (map.get(name.toLowerCase()) ?? name));
    return out;
  };
}

// The title and body to draw for notification `p`.
export function shown(p, world) {
  const hide = hider(world);
  const title = String(p.title ?? ""), body = String(p.body ?? "");
  const agent = p.action?.name === "agent.focus" ? AGENT.exec(title) : null;
  if (!agent) return { title: hide(title), body: hide(body) };
  // A program's name stays, also when its terminal is gone by the time this draws: any program's
  // name the window knows.
  const programs = [world.terminals, world.agents, world.panes].flatMap((list) => (list ?? []).map((x) => x.program?.name)).filter(Boolean);
  const who = agent[1] === ANYONE ? ANYONE : alias.label(agent[1], ...programs);
  return { title: `${who} ${agent[2]}`, body: place(body, world) ?? hide(body) };
}

// "<space> / <tab>" as the sidebar and the tab bar draw them, or null when it names no tab now.
function place(body, world) {
  const panes = world.panes ?? [];
  for (const s of world.spaces ?? []) {
    for (const c of s.tabs ?? []) if (body === `${s.name} / ${c.name}`) return `${alias.project(s.name)} / ${tabName(c, panes)}`;
  }
  return null;
}
