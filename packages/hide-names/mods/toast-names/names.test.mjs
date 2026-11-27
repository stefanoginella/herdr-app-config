// node --test, in this folder: the made-up names a toast draws while names are hidden (names.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as alias from "./alias.js";
import { shown, hider } from "./names.js";

// A made-up window, none of its names a word of alias.js's lists.
const claude = { key: "claude", name: "Claude Code", agent: true };
const zsh = { key: "shell", name: "zsh", agent: false };
const WORLD = {
  home: "/home/someone",
  machines: [{ name: null }, { name: "kraftwerk" }],
  spaces: [
    { id: "s1", name: "zorblax", machine: null, branch: "feat/zorblax-sync", tabs: [
      { id: "c1", name: "1", named: false },
      { id: "c2", name: "quintessa importer", named: true },
      { id: "c3", name: "Claude Code", named: true },
    ] },
    { id: "s2", name: "acme-portal", machine: "kraftwerk", branch: "main", tabs: [{ id: "c4", name: "2", named: false }] },
  ],
  panes: [
    { pane: "p1", tab: "c1", terminal: "t1", name: null, branch: "feat/zorblax-sync", program: claude },
    { pane: "p2", tab: "c2", terminal: "t2", name: "widgetron notes", branch: null, program: zsh },
    { pane: "p3", tab: "c3", terminal: "t3", name: null, branch: null, program: claude },
    { pane: "p4", tab: "c4", terminal: "kraftwerk/t4", name: null, branch: "main", program: claude },
  ],
  terminals: [
    { address: "t1", name: "", program: claude },
    { address: "t5", name: "blorp-reviewer", program: claude },
    { address: "kraftwerk/t4", name: "", program: claude },
  ],
  agents: [{ address: "t1", program: claude }, { address: "kraftwerk/t4", program: claude }],
};
const REAL = ["zorblax", "quintessa", "acme", "portal", "kraftwerk", "widgetron", "blorp", "someone"];
const leaks = (s) => REAL.filter((w) => s.toLowerCase().includes(w));
const toast = (title, body, terminal) => ({ title, body, level: "info", action: terminal ? { name: "agent.focus", args: { terminal } } : undefined });

test("an agent's toast: its program stays, its space and tab read as the sidebar and the tab bar do", () => {
  const out = shown(toast("Claude Code finished", "zorblax / quintessa importer", "t1"), WORLD);
  assert.equal(out.title, "Claude Code finished");
  assert.equal(out.body, `${alias.project("zorblax")} / ${alias.label("quintessa importer", "zsh")}`);
  assert.deepEqual(leaks(out.body), []);
});

test("an agent's toast: a tab's number and a tab named after its program stay", () => {
  assert.equal(shown(toast("Claude Code needs you", "zorblax / 1", "t1"), WORLD).body, `${alias.project("zorblax")} / 1`);
  assert.equal(shown(toast("Claude Code needs you", "zorblax / Claude Code", "t3"), WORLD).body, `${alias.project("zorblax")} / Claude Code`);
  assert.equal(shown(toast("Claude Code finished", "acme-portal / 2", "kraftwerk/t4"), WORLD).body, `${alias.project("acme-portal")} / 2`);
});

test("an agent's toast: a name someone gave the terminal is made up, An agent stays", () => {
  const named = shown(toast("blorp-reviewer needs you", "zorblax / 1", "t5"), WORLD);
  assert.equal(named.title, `${alias.label("blorp-reviewer")} needs you`);
  assert.deepEqual(leaks(named.title), []);
  assert.equal(shown(toast("An agent finished", "zorblax / 1", "t9"), WORLD).title, "An agent finished");
});

test("an agent's toast: a program's name stays when its terminal is gone", () => {
  assert.equal(shown(toast("Claude Code finished", "zorblax / 1", "t9"), WORLD).title, "Claude Code finished");
  assert.equal(shown(toast("Claude Code finished", "zorblax / 1", "t9"), { ...WORLD, terminals: [], agents: [] }).title, "Claude Code finished");
});

test("an agent's toast whose place is no tab now: the known names in it are made up", () => {
  const out = shown(toast("Claude Code finished", "zorblax / gone tab", "t1"), WORLD);
  assert.equal(out.body, `${alias.project("zorblax")} / gone tab`);
});

test("any other toast: every known name is made up, as a whole word, whatever its case", () => {
  const hide = hider(WORLD);
  assert.equal(hide("Couldn't start Zorblax: the stack is down"), `Couldn't start ${alias.project("zorblax")}: the stack is down`);
  assert.equal(hide("layout on kraftwerk unavailable: offline"), `layout on ${alias.machine("kraftwerk")} unavailable: offline`);
  assert.equal(hide("Pushed feat/zorblax-sync"), `Pushed ${alias.branch("feat/zorblax-sync")}`);
  assert.equal(hide("zorblaxes and xzorblax and zorblax_2"), "zorblaxes and xzorblax and zorblax_2");
  assert.equal(hide("acme-portal, acme-portal."), `${alias.project("acme-portal")}, ${alias.project("acme-portal")}.`);
  assert.deepEqual(leaks(hide("widgetron notes / blorp-reviewer / quintessa importer")), []);
});

test("any other toast: the home folder is ~, and text with no name stays", () => {
  const hide = hider(WORLD);
  assert.equal(hide("No such file: /home/someone/code/zorblax/a.txt"), `No such file: ~/code/${alias.project("zorblax")}/a.txt`);
  assert.equal(hide("/home/someone"), "~");
  assert.equal(hide("/home/someone2/x"), "/home/someone2/x");
  for (const s of ["Saved", "Replaced 3 matches", "in main", "Terminal failed to start", ""]) assert.equal(hide(s), s);
});

test("a window with no names leaves every text as it is", () => {
  assert.deepEqual(shown(toast("Saved", "in “a.txt”"), {}), { title: "Saved", body: "in “a.txt”" });
});
