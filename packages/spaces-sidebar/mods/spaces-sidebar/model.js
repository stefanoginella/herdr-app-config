// Folders for the spaces sidebar: one level deep, kept in shared "space.folders":
//
//   { root:     [ spaceId | { id, name, folded, on, spaces: [spaceId] } ],   the sidebar, top to bottom
//     projects: { projectKey: folderId } }  where a project was filed, for the next space opened on it
//
// A folder belongs to one machine (`on`: its name, null for this computer) and holds only that
// machine's spaces, so each machine has folders of its own. The root list holds every machine's
// entries; the sidebar draws each machine's part under its header.
//
// The sidebar, its menu and its naming dialog all change it through these functions:
// load(), change the copy, save().

import { shared, setShared } from "herdr";

export const KEY = "space.folders";
export const CREATE = "spaces-sidebar.create";

const isFolder = (e) => e !== null && typeof e === "object";
const ref = (e) => (isFolder(e) ? e.id : e);
// A space's id says its machine: "<machine>/<id>" away, bare here.
export const machineOf = (id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null);
const machineName = (v) => (typeof v === "string" && v !== "" ? v : null);
// The machine a project key is for: its value is a JSON [machine, path] after "repo:" or "dir:".
function keyMachine(key) {
  try { return machineName(JSON.parse(key.slice(key.indexOf(":") + 1))[0]); } catch { return undefined; }
}

export function clean(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

// A copy of the stored model, repaired: anything malformed is dropped, a space listed twice stays where
// it's first. A folder holding another machine's spaces gives them to a folder of the same name on that
// machine, right after it: that is also how folders from before `on` existed are split.
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
      const spaces = (Array.isArray(e.spaces) ? e.spaces : []).filter(own);
      const on = "on" in e ? machineName(e.on) : spaces.length ? machineOf(spaces[0]) : null;
      const name = clean(e.name) || "Folder";
      const split = new Map([[on, { id: e.id, name, folded: Boolean(e.folded), on, spaces: [] }]]);
      for (const s of spaces) {
        const at = machineOf(s);
        if (!split.has(at)) split.set(at, { id: `${e.id}~${at ?? "local"}`, name, folded: Boolean(e.folded), on: at, spaces: [] });
        split.get(at).spaces.push(s);
      }
      for (const f of split.values()) if (!ids.has(f.id)) {
        ids.add(f.id);
        root.push(f);
      }
    }
  }
  const projects = {};
  const byId = new Map(root.filter(isFolder).map((f) => [f.id, f]));
  if (isFolder(raw?.projects)) for (const [k, v] of Object.entries(raw.projects)) {
    const f = byId.get(v);
    const on = keyMachine(k);
    if (!f || on === undefined) continue;
    // A project of another machine than its folder's: the split folder of the same name there.
    const there = f.on === on ? f : byId.get(`${v}~${on ?? "local"}`);
    if (there) projects[k] = there.id;
  }
  return { root, projects };
}

// The same text for the same model, however the store orders an object's keys.
export function canon(m) {
  return JSON.stringify([
    m.root.map((e) => (isFolder(e) ? [e.id, e.name, e.folded, e.on, e.spaces] : e)),
    Object.entries(m.projects).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
}

// Writes only a real change: every write redraws every mod. A store from before `on` is written once,
// so the machines worked out for its folders stay theirs.
export function save(m) {
  const old = (shared(KEY)?.root ?? []).some((e) => isFolder(e) && !("on" in e));
  if (!old && canon(m) === canon(load())) return false;
  setShared(KEY, m);
  return true;
}

export const folders = (m) => m.root.filter(isFolder);
// The folders of one machine (null: this computer).
export const foldersOn = (m, on) => folders(m).filter((f) => f.on === (on ?? null));
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

// Puts a space at dest: { folder: id | null (the root), start | before | after }. A folder of another
// machine than the space's is refused.
export function moveSpace(m, space, dest = {}) {
  const f = dest.folder ? folder(m, dest.folder) : null;
  if (dest.folder && (!f || f.on !== machineOf(space))) return false;
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

// A newly discovered space follows its project's folder on the same machine.
export function admit(m, space, key) {
  if (has(m, space)) return false;
  const f = key ? folder(m, m.projects[key]) : null;
  (f && f.on === machineOf(space) ? f.spaces : m.root).push(space);
  return true;
}

// Drops the spaces `gone(id)` says are closed. Folders stay, empty or not.
export function prune(m, gone) {
  m.root = m.root.filter((e) => isFolder(e) || !gone(e));
  for (const f of folders(m)) f.spaces = f.spaces.filter((s) => !gone(s));
}

// A new folder on machine `on` (null: this computer).
export function addFolder(m, name, dest = { start: true }, on = null) {
  const f = { id: `fd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: clean(name) || "Folder", folded: false, on: machineName(on), spaces: [] };
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
  return true;
}

export function setFolded(m, id, folded) {
  const f = folder(m, id);
  if (f) f.folded = Boolean(folded);
}
