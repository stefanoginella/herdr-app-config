// Run with node --test. The repository checks all shared helpers in docs/check-shared.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as alias from "./alias.js";

// Made-up inputs, none of them a word of the lists.
const NAMES = ["acme-portal", "zorblax", "Quintessa Shop", "widgetron-v2", "my_dotfiles", "kraftwerk-infra", "blorp.io", "x"];
const TITLES = ["Investigate zorblax crash on boot", "rewrite the quintessa importer", "acme portal: payments"];
const BRANCHES = ["feat/zorblax-sync", "fix/quintessa-crash", "acme-portal-rework", "release/2.4-acme", "zorblax"];
const HOME = "/home/someone";

const leaks = (out, input) => {
  const o = out.toLowerCase();
  // Every word of three letters or more of the input, kept out of the output.
  return String(input).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).filter((w) => o.includes(w));
};

test("the same input gives the same output", () => {
  for (const n of NAMES) {
    assert.equal(alias.project(n), alias.project(n));
    assert.equal(alias.title(n), alias.title(n));
    assert.equal(alias.machine(n), alias.machine(n));
    assert.equal(alias.folder(n), alias.folder(n));
    assert.equal(alias.branch(n), alias.branch(n));
  }
  // Case and surrounding spaces don't matter.
  assert.equal(alias.project("  Acme-Portal "), alias.project("acme-portal"));
  assert.equal(alias.title("FIX THE THING"), alias.title("fix the thing"));
});

test("what stays", () => {
  for (const b of ["main", "master", "develop", "dev", "staging", "production", "trunk", "HEAD", "(detached)"]) assert.equal(alias.branch(b), b);
  assert.equal(alias.project("~"), "~");
  assert.equal(alias.project(""), "");
  assert.equal(alias.title(""), "");
  assert.equal(alias.machine("This computer"), "This computer");
  assert.equal(alias.machine("This Mac"), "This Mac");
  assert.equal(alias.machine(""), "");
  assert.equal(alias.path(HOME, HOME, "x"), "~");
  assert.equal(alias.path(HOME + "/", HOME, "x"), "~");
  assert.equal(alias.path("", HOME, "x"), "");
  for (const l of ["3", "12", "zsh", "Terminal", "shell"]) assert.equal(alias.label(l), l);
  assert.equal(alias.label("Claude Code", "Claude Code"), "Claude Code");
  assert.notEqual(alias.label("zorblax work", "Claude Code"), "zorblax work");
});

test("branches keep a conventional prefix", () => {
  assert.match(alias.branch("feat/zorblax-sync"), /^feat\/[a-z-]+$/);
  assert.match(alias.branch("fix/quintessa-crash"), /^fix\/[a-z-]+$/);
  assert.match(alias.branch("Release/2.4-acme"), /^release\/[a-z-]+$/);
  assert.match(alias.branch("acme-portal-rework"), /^(feat|fix|chore|refactor)\/[a-z-]+$/);
});

test("paths show only made-up segments", () => {
  assert.equal(alias.path(`${HOME}/code/acme-portal`, HOME, "acme-portal"), `~/${alias.project("acme-portal")}`);
  assert.equal(alias.path(`${HOME}/code/acme-portal/src/lib`, HOME, "acme-portal"), `~/${alias.project("acme-portal")}/…`);
  assert.equal(alias.path(`${HOME}/code/zorblax/src`, HOME, "nothing-here"), `~/${alias.project("src")}`);
  assert.equal(alias.path("/srv/www/quintessa", HOME, ""), `~/${alias.project("quintessa")}`);
  for (const p of [`${HOME}/code/acme-portal/src`, "/mnt/kraftwerk/zorblax", `${HOME}/someone-else/widgetron`]) {
    const out = alias.path(p, HOME, "zorblax");
    assert.deepEqual(leaks(out, p), [], `${p} -> ${out}`);
  }
});

test("no real word leaks into the output", () => {
  for (const n of [...NAMES, ...TITLES]) {
    for (const f of [alias.project, alias.title, alias.machine, alias.folder, alias.label]) {
      const out = f(n);
      assert.deepEqual(leaks(out, n), [], `${f.name}(${n}) -> ${out}`);
    }
  }
  for (const b of BRANCHES) {
    const out = alias.branch(b);
    // The prefix is kept on purpose.
    assert.deepEqual(leaks(out.replace(/^[a-z]+\//, ""), b.replace(/^[a-z]+\//i, "")), [], `${b} -> ${out}`);
  }
});

test("enough projects that forty rarely collide", () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(alias.project(`project-number-${i}`));
  assert.ok(seen.size >= 36, `only ${seen.size} distinct of 40`);
});

test("folders avoid the names already taken", () => {
  const taken = new Set();
  for (let i = 0; i < 50; i++) {
    const f = alias.folder(`group ${i}`, taken);
    assert.ok(!taken.has(f), f);
    taken.add(f);
  }
  assert.match(alias.folder("anything", new Set()), /^[A-Z][a-z]+/);
});
