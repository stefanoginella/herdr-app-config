import test from "node:test";
import assert from "node:assert/strict";
import { view } from "../../../../docs/tests/mod-view.mjs";

test("keyboard navigation follows visible tree rows and the explicit reveal opens only the ancestor path", () => {
  const opened = [], scrolled = [], toggled = [];
  let file = "lib/src/main.js", refreshed = 0;
  const parent = p => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const panel = view(new URL("./main.js", import.meta.url), { ops: { parent }, notify() {} });
  const cx = { notify() {}, stop_propagation() {} };
  Object.assign(panel, {
    handle: { focus() {}, is_focused: () => true }, scroll: { scroll_to_item(i) { scrolled.push(i); } },
    folders: new Set(["docs"]), activeFile: () => file, refresh() { refreshed++; },
    entry: p => ({ dir: ["lib", "lib/src"].includes(p) }), open: p => opened.push(p),
    toggle: p => { toggled.push(p); panel.folders.delete(p); },
    tree: ["docs", "lib", "lib/src", file, "readme.md"],
  });
  panel.reveal(cx);
  assert.equal(refreshed, 1);
  assert.equal(panel.cursor, file);
  assert.deepEqual([...panel.folders], ["docs", "lib", "lib/src"]);
  const key = key => panel.treeKey({ key, modifiers: {} }, cx);
  key("left"); assert.equal(panel.cursor, "lib/src");
  key("right"); key("enter"); assert.deepEqual(opened, [file]);
  key("up"); key("left"); assert.deepEqual(toggled, ["lib/src"]);
  key("down"); assert.equal(scrolled.at(-1), 3);
  file = null; panel.reveal(cx); assert.equal(refreshed, 1);
});
