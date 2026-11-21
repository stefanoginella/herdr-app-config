// Folders for the spaces sidebar: one level deep, kept in shared "space.folders":
//
//   { root:     [ spaceId | { id, name, folded, spaces: [spaceId] } ],   the sidebar, top to bottom
//     projects: { projectKey: folderId },   where a project was filed, for the next space opened on it
//     next:     { folder, at } | null }     "New space here": the folder waiting for the next new space
//
// The sidebar, its menu and its naming dialog all change it through these functions:
// load(), change the copy, save().

import { shared, setShared } from "herdr";

export const KEY = "space.folders";
// How long "New space here" waits for its space to appear.
const NEXT_MS = 30000;

const isFolder = (e) => e !== null && typeof e === "object";
const ref = (e) => (isFolder(e) ? e.id : e);

export function clean(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

// A copy of the stored model, repaired: anything malformed is dropped, a space listed twice stays where it's first.
export function load() {
  const raw = shared(KEY);
  const spacesSeen = new Set();
  const ids = new Set();
  const own = (id) => typeof id === "string" && id !== "" && !spacesSeen.has(id) && Boolean(spacesSeen.add(id));
  const root = [];
  for (const e of Array.isArray(raw?.root) ? raw.root : []) {
    if (typeof e === "string") {
      if (own(e)) root.push(e);
    } else if (isFolder(e) && typeof e.id === "string" && e.id !== "" && !ids.has(e.id)) {
      ids.add(e.id);
      root.push({ id: e.id, name: clean(e.name) || "Folder", folded: Boolean(e.folded), spaces: (Array.isArray(e.spaces) ? e.spaces : []).filter(own) });
    }
  }
  const projects = {};
  if (isFolder(raw?.projects)) for (const [k, v] of Object.entries(raw.projects)) if (ids.has(v)) projects[k] = v;
  const next = isFolder(raw?.next) && ids.has(raw.next.folder) ? { folder: raw.next.folder, at: Number(raw.next.at) || 0 } : null;
  return { root, projects, next };
}

// The same text for the same model, however the store orders an object's keys.
export function canon(m) {
  return JSON.stringify([
    m.root.map((e) => (isFolder(e) ? [e.id, e.name, e.folded, e.spaces] : e)),
    Object.entries(m.projects).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    m.next ? [m.next.folder, m.next.at] : null,
  ]);
}

// Writes only a real change: every write redraws every mod.
export function save(m) {
  if (canon(m) === canon(load())) return false;
  setShared(KEY, m);
  return true;
}

export const folders = (m) => m.root.filter(isFolder);
export const folder = (m, id) => m.root.find((e) => isFolder(e) && e.id === id) ?? null;
export const folderOf = (m, space) => m.root.find((e) => isFolder(e) && e.spaces.includes(space)) ?? null;
export const has = (m, space) => m.root.includes(space) || Boolean(folderOf(m, space));

function take(m, space) {
  for (const list of [m.root, ...folders(m).map((f) => f.spaces)]) {
    const i = list.indexOf(space);
    if (i !== -1) list.splice(i, 1);
  }
}

// Where in `list` a destination { start } | { before: ref } | { after: ref } points; the end otherwise.
// A ref is a space id or, at the root, a folder id.
function slot(list, { start, before, after }) {
  const at = (r) => list.findIndex((e) => ref(e) === r);
  if (start) return 0;
  if (before !== undefined && at(before) !== -1) return at(before);
  if (after !== undefined && at(after) !== -1) return at(after) + 1;
  return list.length;
}

// Puts a space at dest: { folder: id | null (the root), start | before | after }.
export function moveSpace(m, space, dest = {}) {
  const f = dest.folder ? folder(m, dest.folder) : null;
  if (dest.folder && !f) return false;
  take(m, space);
  const list = f ? f.spaces : m.root;
  list.splice(slot(list, dest), 0, space);
  return true;
}

// Remembers where a space's project is filed now. `keys`: space id -> project key (null: nothing to
// remember it by). Out of every folder, the project is forgotten unless another of its spaces is still filed there.
export function remember(m, space, keys = {}) {
  const key = keys[space];
  if (!key) return;
  const f = folderOf(m, space);
  if (f) {
    m.projects[key] = f.id;
    return;
  }
  const was = folder(m, m.projects[key]);
  if (!was || !was.spaces.some((s) => keys[s] === key)) delete m.projects[key];
}

// A person's move: the space, the worktree spaces drawn under it (`kids`) right after it, and the memory.
export function file(m, space, dest, { kids = [], keys = {} } = {}) {
  if (!moveSpace(m, space, dest)) return false;
  const into = folderOf(m, space)?.id ?? null;
  let last = space;
  for (const kid of kids) {
    moveSpace(m, kid, { folder: into, after: last });
    last = kid;
  }
  remember(m, space, keys);
  return true;
}

// A space the model hasn't seen: into the folder waiting for it ("New space here"), else the folder
// its project was filed in, else the end of the root.
export function admit(m, space, key, now) {
  if (has(m, space)) return false;
  const waiting = m.next && now - m.next.at < NEXT_MS ? folder(m, m.next.folder) : null;
  m.next = null;
  const f = waiting ?? (key ? folder(m, m.projects[key]) : null);
  (f ? f.spaces : m.root).push(space);
  if (waiting && key) m.projects[key] ??= waiting.id;
  return true;
}

// Drops the spaces `gone(id)` says are closed. Folders stay, empty or not.
export function prune(m, gone) {
  m.root = m.root.filter((e) => isFolder(e) || !gone(e));
  for (const f of folders(m)) f.spaces = f.spaces.filter((s) => !gone(s));
}

export function addFolder(m, name, dest = { start: true }) {
  const f = { id: `fd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: clean(name) || "Folder", folded: false, spaces: [] };
  m.root.splice(slot(m.root, dest), 0, f);
  return f.id;
}

export function renameFolder(m, id, name) {
  const f = folder(m, id);
  if (!f || !clean(name)) return false;
  f.name = clean(name);
  return true;
}

// Moves a folder among the root's entries: { start | before | after }, the end otherwise.
export function moveFolder(m, id, dest = {}) {
  const i = m.root.findIndex((e) => isFolder(e) && e.id === id);
  if (i === -1 || dest.before === id || dest.after === id) return false;
  const [f] = m.root.splice(i, 1);
  m.root.splice(slot(m.root, dest), 0, f);
  return true;
}

// Removes a folder; its spaces take its place in the root. Nothing is closed.
export function removeFolder(m, id) {
  const i = m.root.findIndex((e) => isFolder(e) && e.id === id);
  if (i === -1) return false;
  m.root.splice(i, 1, ...m.root[i].spaces);
  for (const [k, v] of Object.entries(m.projects)) if (v === id) delete m.projects[k];
  if (m.next?.folder === id) m.next = null;
  return true;
}

export function setFolded(m, id, folded) {
  const f = folder(m, id);
  if (f) f.folded = Boolean(folded);
}

// "New space here": the next new space goes into this folder.
export function expect(m, id, now) {
  if (folder(m, id)) m.next = { folder: id, at: now };
}
