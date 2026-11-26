// node --test mods/git-diff/review.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as review from "./review.js";
import { hunkPatch, parse, split, unified } from "./diff.js";
import { colorPieces, language, spans } from "./syntax.js";

test("review a committed branch, then its follow-up, and detect a rewritten branch or a moved fork", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "branch-review-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (args) => {
    const r = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const run = (...args) => { const r = git(args); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); };
  const source = { branch: "refs/heads/topic", base: "refs/heads/main" };
  const commit = (name, value) => { writeFileSync(join(cwd, name), value); run("add", "--", name); run("commit", "-qm", "Change file"); };
  run("init", "-q", "-b", "main"); commit("story", "old\n"); run("switch", "-qc", "topic");
  commit("story", "changed\n"); commit("notes[1]", "other\n");
  writeFileSync(join(cwd, "story"), "unsaved\n");
  const first = await review.range(git, source, null);
  assert.equal(first.incremental, false);
  assert.equal(first.fork, run("rev-parse", "main"));
  assert.equal(first.tip, run("rev-parse", "topic"));
  assert.doesNotMatch(run(...review.patchArgs(first.fork, first.tip, "story")), /unsaved/);
  const checkpoint = { fork: first.fork, tip: first.tip };
  commit("story", "follow-up\n");
  const next = await review.range(git, source, checkpoint);
  assert.equal(next.incremental, true);
  assert.equal(next.from, first.tip);
  assert.equal((await review.range(git, source, checkpoint, "full")).from, first.fork);
  const list = (from, tip) => review.rawFiles(git(["diff", "--raw", "--no-abbrev", "--no-renames", "-z", from, tip]).stdout);
  const initial = list(first.fork, first.tip), all = list(next.fork, next.tip), since = list(next.from, next.tip);
  assert.equal(initial.get("notes[1]").signature, all.get("notes[1]").signature);
  assert.deepEqual([...since.keys()], ["story"]);
  const file = { ...since.get("story"), full: all.get("story") };
  const unread = {}; review.markSince(unread, file, "full"); assert.deepEqual(unread, {});
  const viewed = { full: initial.get("story").signature }; review.markSince(viewed, file, "full");
  assert.equal(viewed.full, all.get("story").signature);
  run("branch", "-f", "main", first.tip);
  assert.match((await review.range(git, source, checkpoint)).notice, /common ancestor changed/);
  run("branch", "-f", "main", first.fork);
  run("switch", "-q", "main"); run("branch", "-f", "topic", first.fork);
  const replaced = await review.range(git, source, checkpoint);
  assert.equal(replaced.incremental, false); assert.match(replaced.notice, /outside this history/);
  await assert.rejects(review.range(git, { ...source, base: "refs/heads/gone" }, null), /unavailable/);
});

test("line notes track changed lines on their own side, with exact original text and unambiguous context", () => {
  const lines = (patch) => review.anchors(parse(patch, true));
  const original = lines("@@ -1,3 +1,3 @@\n before\n-old\n+\tnew\n after\n");
  const at = original.get("new2");
  assert.equal(at.text, "\tnew");
  assert.equal(original.get("old2").text, "old");
  const moved = lines("@@ -8,3 +8,3 @@\n before\n-old\n+\tnew\n after\n");
  assert.equal(review.relocate(at, moved).line, 9);
  const ambiguous = new Map([...moved, ["new20", { ...moved.get("new9"), line: 20 }]]);
  assert.equal(review.relocate(at, ambiguous), null);
  assert.equal(review.relocate(at, lines("@@ -1 +1 @@\n-old\n+    new\n")), null);
  const src = { branch: "refs/heads/topic", base: "refs/remotes/origin/main" };
  const tip = "a".repeat(40);
  const text = review.feedback(src, tip, [{ note: { anchor: at, revision: tip, body: "Keep the existing name", path: "odd\nname" }, line: 9 }]);
  assert.ok(text.includes(tip)); assert.ok(text.includes('"odd\\nname":9 (new side')); assert.ok(text.includes(at.text));
});

test("stage and unstage just one hunk, keeping CRLF, the final newline state, and mode changes separate", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "stage-hunk-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const file = "literal [1].js", path = join(cwd, file);
  const git = (args, input) => {
    const r = spawnSync("git", ["--literal-pathspecs", "-c", "user.name=Fixture", "-c", "user.email=fixture",
      "-c", "commit.gpgsign=false", "-c", "core.filemode=true", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", input });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const patch = (...range) => parse(git(["diff", "--full-index", "--no-color", "-U3", ...range, "--", file]), false, true);
  git(["init", "-q"]);
  const old = Array.from({ length: 36 }, (_, i) => `const field${i} = ${i};`);
  writeFileSync(path, old.join("\r\n"), { mode: 0o644 });
  git(["add", "--", file]); git(["commit", "-qm", "Baseline"]);
  const edited = old.slice();
  edited[3] = "\tconst initial = 16;";
  edited[35] = "\tconst final = 29;";
  writeFileSync(path, edited.join("\r\n"));
  chmodSync(path, 0o755);
  const parsed = patch();
  assert.equal(parsed.hunks.length, 2);
  const picked = hunkPatch(parsed, 1);
  assert.doesNotMatch(picked, /new mode|old mode/);
  assert.match(picked, /No newline at end of file/);
  git(["apply", "--cached", "-"], picked);
  const staged = old.slice(); staged[35] = edited[35];
  assert.equal(git(["show", `:${file}`]), staged.join("\r\n"));
  assert.match(git(["diff", "--summary"]), /mode change 100644 => 100755/);
  assert.equal(readFileSync(path, "utf8"), edited.join("\r\n"));
  git(["apply", "--cached", "--reverse", "-"], hunkPatch(patch("--cached"), 0));
  assert.equal(git(["show", `:${file}`]), old.join("\r\n"));
  assert.equal(readFileSync(path, "utf8"), edited.join("\r\n"));
});

test("expand one gap in both layouts with independent old and new line numbers", () => {
  const patch = parse("@@ -2 +2,2 @@ const first\n-old\n+new\n+also new\n@@ -9 +10 @@ const last\n-one\n+two\n");
  const expanded = new Map([[1, ["context 7", "context 8"]]]);
  const one = unified(patch, expanded);
  const two = split(patch, expanded);
  assert.equal(one.filter((row) => row.kind === "hunk").length, 2);
  assert.deepEqual(one.filter((row) => row.kind === "gap").map((row) => [row.action, row.count, row.showing]),
    [["show", 1, 0], ["show", 6, 2], ["hide", 6, 2]]);
  assert.deepEqual(one.filter((row) => row.kind === " ").map((row) => [row.old, row.next]), [[7, 8], [8, 9]]);
  assert.deepEqual(two.filter((row) => row.left?.kind === " ").map((row) => [row.left.n, row.right.n]), [[7, 8], [8, 9]]);
});

test("syntax colors and word marks overlap without dropping text", () => {
  const line = 'const name = "quoted"; // const';
  const pieces = colorPieces(line, [[15, 20]], spans(line, language("demo.ts")));
  assert.equal(pieces.map((p) => p.text).join(""), line);
  assert.equal(pieces.find((p) => p.marked).tone, "string");
  assert.equal(pieces.at(-1).tone, "comment");
  assert.equal(language("README.md"), null);
});
