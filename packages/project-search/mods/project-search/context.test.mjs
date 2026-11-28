import test from "node:test";
import assert from "node:assert/strict";
import { view, events, functionsFrom } from "../../../../docs/tests/mod-view.mjs";

const main = new URL("./main.js", import.meta.url);

test("undo follows project and machine even when the outstanding replacement finishes elsewhere", async () => {
  const { cx, settle } = events();
  const restored = [];
  let finish;
  const ops = {
    base: path => path.split("/").pop(),
    replace: () => new Promise(resolve => { finish = resolve; }),
    restore: async (on, files) => { restored.push([on, files[0].abs]); return { restored: 1, missed: [] }; },
  };
  const panel = view(main, { ops, checking: () => false, home: () => "/home", notify() {} });
  const options = { query: "before", to: "after", replacing: true };
  let location = { cwd: "/work", on: "remote" };
  Object.assign(panel, { undos: new Map(), placing: 0, options: () => options, location: () => location,
    top: async cwd => cwd, halt() {}, answer: () => false, go() {}, remember() {} });
  panel.place(cx); await settle();
  panel.result = { root: "/work", on: "remote", want: panel.want(), o: options,
    files: [{ path: "main.js", matches: [{ id: "match", start: 0, to: "after" }] }] };
  panel.replace(null, null, cx);
  location = { cwd: "/work", on: null };
  panel.place(cx);
  finish({ changed: [{ count: 1, path: "main.js", abs: "/work/main.js", before: "before", after: "after" }], missed: [] });
  await settle();
  panel.unreplace(cx); await settle();
  assert.deepEqual(restored, []);
  location = { cwd: "/work", on: "remote" };
  panel.place(cx); await settle();
  panel.unreplace(cx); await settle();
  assert.deepEqual(restored, [["remote", "/work/main.js"]]);
});

test("menu and confirmation act only on the originating panel and result revision", () => {
  const calls = [];
  const panel = view(main);
  const row = { path: "main.js", matches: [{ id: "same" }] };
  Object.assign(panel, { panelId: "A", result: { root: "/work", on: null, want: "query", revision: 1, files: [row] },
    place() {}, want: () => "query", replace: (...args) => calls.push(args.slice(0, 2)) });
  const request = { ...panel.target(panel.result), op: "replace", path: row.path, id: "same" };
  panel.act({ ...request, panel: "B" });
  panel.act({ ...request, on: "remote" });
  panel.act({ ...request, root: "/other" });
  panel.act(request);
  panel.result.revision++;
  panel.act(request);
  panel.act({ ...request, op: "replace-all" });
  panel.act({ ...request, revision: 2, op: "replace-all" });
  assert.deepEqual(calls, [["main.js", "same"], [null, null]]);
});

test("two panel menus can dispatch before either panel draws", () => {
  let pending;
  const ops = functionsFrom(new URL("./ops.js", import.meta.url), {
    shared: () => pending, setShared: (_key, value) => { pending = value; },
  }, ["request", "waiting", "take"]);
  ops.request({ panel: "left", op: "dismiss" });
  ops.request({ panel: "right", op: "replace" });
  assert.equal(ops.take("unknown"), null);
  assert.equal(ops.take("right").op, "replace");
  assert.ok(ops.waiting("left"));
  assert.equal(ops.take("left").op, "dismiss");
  assert.equal(pending, null);
});
