import test from "node:test";
import assert from "node:assert/strict";
import { tabLabels } from "./edit.js";

test("tab labels add just enough of each path, including the machine for identical paths", () => {
  const paths = ["/x/a/src/index.js", "/x/b/src/index.js", "/lib/index.js", "/lib/index.js", "/x/unique.md"];
  const docs = paths.map((path, id) => ({ path, id, name: path.split("/").pop(), on: id === 3 ? "host" : null }));
  const labels = tabLabels(docs);
  assert.deepEqual([...labels.values()], ["a/src/index.js", "b/src/index.js", "this computer: lib/index.js", "host: lib/index.js"]);
  assert.equal(tabLabels([docs[0], docs[4]]).size, 0);
});
