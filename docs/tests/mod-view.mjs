// Exercise a mod's view methods with an isolated Herdr host. Test imports supply
// only the services the interaction uses. No owner's app state or CLI is read.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const sourceOf = url => readFileSync(url, "utf8").replace(/^import .*;$/gm, "");

export function functionsFrom(moduleURL, host, names) {
  const source = sourceOf(moduleURL).replace(/^export /gm, "");
  return runInNewContext(source + "\n({" + names.join(", ") + "})", host, { filename: moduleURL.pathname });
}

export function view(moduleURL, host = {}) {
  const source = sourceOf(moduleURL)
    .replace("export default class ", "const Mod = class ")
    .replace(/^export /gm, "");
  return runInNewContext(source + "\nnew Mod()", { View: class {}, ...host }, { filename: moduleURL.pathname });
}

export function events() {
  const jobs = [];
  const cx = { notify() {}, spawn(fn) { jobs.push(fn(cx)); } };
  return { cx, async settle() { while (jobs.length) await Promise.all(jobs.splice(0)); } };
}
