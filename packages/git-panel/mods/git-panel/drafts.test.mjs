import test from "node:test";
import assert from "node:assert/strict";
import { view, events } from "../../../../docs/tests/mod-view.mjs";

const main = new URL("./main.js", import.meta.url);

test("a delayed writer preserves manual edits and drafts follow the resolved worktree and machine", async () => {
  const { cx, settle } = events();
  let finish, ready;
  const entered = new Promise(resolve => { ready = resolve; });
  const write = { writer: () => ({}), gather: async () => ({}), prompt: () => "",
    write: () => { ready(); return new Promise(resolve => { finish = resolve; }); } };
  const panel = view(main, { write });
  let field = "";
  Object.assign(panel, { root: "/work", on: null, status: { staged: [1], unstaged: [] }, drafts: new Map(), writers: new Map(), pending: {},
    input: { value: () => field, set_value: value => { field = value; } } });
  const local = JSON.stringify([null, "/work"]), remote = JSON.stringify(["host", "/work"]);
  panel.showDraft(local);
  panel.setDraft(local, "Original");
  panel.generate(cx); await entered;
  panel.setDraft(local, "My edit");
  panel.showDraft(remote); panel.setDraft(remote, "Other work");
  assert.equal(panel.writing, undefined);
  finish({ message: "Generated" }); await settle();
  assert.equal(field, "Other work");
  panel.showDraft(null); panel.showDraft(local);
  assert.equal(field, "My edit");
  panel.useGenerated();
  assert.equal(field, "Generated");
  assert.deepEqual(JSON.parse(panel.pending.commitDrafts), { [local]: "Generated", [remote]: "Other work" });
});
