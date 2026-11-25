// Which icon a file or a folder gets, as VS Code picks one from an icon theme: the whole name
// first, then its extensions from the longest ("d.ts" before "ts"), then the plain one.
// The icons and their table are Material Icon Theme's (icons/, MIT).

import { FILE, FOLDER, NAMES, EXTS, FOLDERS, LIGHT, OPEN } from "./icons/map.js";

const at = (icon) => `mods/files-actions/icons/${icon}.svg`;

// `parent`: the name of the folder it is in, for the few entries that name one (".github/workflows").
function find(table, light, name, parent) {
  const tables = light ? [light, table] : [table];
  for (const t of tables) {
    const hit = (parent && t[`${parent}/${name}`]) || t[name];
    if (hit) return hit;
  }
  return null;
}

export function fileIcon(name, parent, dark) {
  const n = name.toLowerCase(), p = parent?.toLowerCase();
  const light = dark ? null : LIGHT;
  const named = find(NAMES, light?.names, n, p);
  if (named) return at(named);
  for (let dot = n.indexOf("."); dot !== -1; dot = n.indexOf(".", dot + 1)) {
    const ext = find(EXTS, light?.exts, n.slice(dot + 1));
    if (ext) return at(ext);
  }
  return at(FILE);
}

export function folderIcon(name, parent, open, dark) {
  const closed = find(FOLDERS, dark ? null : LIGHT.folders, name.toLowerCase(), parent?.toLowerCase()) ?? FOLDER;
  return at(open ? (OPEN[closed] ?? `${closed}-open`) : closed);
}
