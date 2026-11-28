import test from "node:test";
import assert from "node:assert/strict";
import { events, functionsFrom, view } from "../../../../docs/tests/mod-view.mjs";

test("a different space appearing first cannot claim the requested folder", async () => {
  const source = name => new URL(name, import.meta.url);
  const { cx, settle } = events();
  const raw = { root: [{ id: "folder", on: "host", name: "Group", spaces: [], folded: true }],
    next: { folder: "folder", at: Date.now() } };
  const model = functionsFrom(source("./model.js"), { shared: () => raw },
    ["load", "admit", "moveSpace", "setFolded", "machineOf"]);
  const m = model.load();
  let complete, launched;
  const started = new Promise(resolve => { launched = resolve; });
  const exec = async (cmd, args) => {
    if (cmd === "sh") return { stdout: "/home/test" };
    assert.equal(cmd, "herdr-app");
    assert.deepEqual([...args], ["do", "space.new", "--folder", "/home/test", "--machine", "host"]);
    launched(); return new Promise(resolve => { complete = resolve; });
  };
  const panel = view(source("./main.js"), { model, exec });
  panel.change = fn => fn(m);
  panel.newSpaceIn(m.root[0], cx);
  await started;
  model.admit(m, "host/unrelated", null);
  complete({ stdout: JSON.stringify({ space: "requested" }) });
  await settle();
  assert.equal(m.root[0].folded, false);
  assert.deepEqual([...m.root[0].spaces], ["host/requested"]);
  assert.ok(m.root.includes("host/unrelated"));
});
