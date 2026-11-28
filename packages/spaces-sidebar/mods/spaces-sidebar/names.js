// Hide names: what the sidebar and its menus draw while shared `names.hidden` is on (alias.js).
// Only what is drawn changes: ids, the model, the order and every comparison use the real names.

import { shared } from "herdr";
import * as alias from "./alias.js";
import { title } from "./stacks.js";

export const hidden = () => shared("names.hidden") === true;

// Every folder's made-up name, by id, none the same as another's: given in the order of their ids,
// so the same folders get the same names in the sidebar and in the menus.
export function folderNames(folders) {
  const out = new Map(), taken = new Set();
  for (const f of [...folders].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const n = alias.folder(f.name, taken);
    taken.add(n);
    out.set(f.id, n);
  }
  return out;
}

// The rest, each the real name when names are shown.
export const space = (name) => (hidden() ? alias.project(name) : name);
export const machine = (name) => (name && hidden() ? alias.machine(name) : name);
export const repo = (name) => (hidden() ? alias.project(name) : name);
export const branch = (name) => (hidden() ? alias.branch(name) : name);
export const stack = (s) => title(hidden() ? { ...s, name: alias.project(s.name) } : s);
