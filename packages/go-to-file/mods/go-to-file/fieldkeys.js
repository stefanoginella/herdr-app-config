// The keys of this mod's text fields: the section `mod:<name> > Input` of keys.json.
//
// A text field (and the editor's text) binds keys of its own, Up, Down, Tab, Cmd+F, and passes
// nothing on: a binding has to sit as deep as the field to win. Up to Herdr 0.1.16 the section's
// name did that, read as the key context `mod == <name> > Input`. Since 0.1.17 a section's name
// is one literal mod name, so that section binds nothing by itself and Herdr says nothing about
// it (no keys.error).
//
// So the mod installs those keys itself (`cx.bind_keys`), under that context and with the same
// actions: Herdr runs a script's action as it runs one of keys.json, and the command arrives at
// `nextCommand()` as before. keys.json stays the one place to change them.
//
// Herdr drops every binding when keys.json changes, and puts back only its own. So the keys are
// installed again whenever `keys()` says anything else, in any section. A save of keys.json that
// changes nothing `keys()` shows (a space) drops them until the mod is loaded again.
//
// The same file is in go-to-file, project-search and file-editor (a mod imports from its own
// folder only): keep the three the same.
import { keys } from "herdr";

// What was last installed, for every copy of this mod: the keymap is the app's, not a copy's.
let bound = null;

const sign = () => JSON.stringify(keys() ?? []);

// Installs the keys unless they are in already. Not from render(): see watch().
export function bind(name, cx) {
  const all = sign();
  if (all === bound) return;
  const section = `mod:${name} > Input`;
  const list = (keys() ?? []).filter((k) => k.section === section && k.keys && k.action)
    .map((k) => ({ keystroke: k.keys, action: k.action, context: `mod == ${name} > Input` }));
  try {
    if (list.length) cx.bind_keys(list);
    bound = all;
  } catch (e) {
    console.log(`${name}: the keys of ${section} were not installed: ${e}`);
    bound = all; // not tried again until keys.json changes: the same list would fail the same way
  }
}

// From render(), which may not bind: installs them again a step later when keys.json changed.
export function watch(name, cx) {
  if (sign() === bound) return;
  cx.spawn(async (cx) => { await null; bind(name, cx); });
}
