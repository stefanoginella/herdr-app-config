// Modified from Herdr's `workspace-status` mod (version 0.1.18, Apache-2.0): see NOTICE at the
// repository root. Changes, each marked "names:": made-up names for the machine and the branch
// while shared `names.hidden` is on (alias.js), the command `status-names.toggle` that turns it on
// and off, and turning it off when the app has started again since it was turned on.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, shared, setShared, nextCommand, exec, checking } from "herdr";
import * as alias from "./alias.js";

// names: the Herdr app's own process (its id and when it started), read through the parent of a
// program it runs. Its executable is called Herdr on macOS.
const BOOT = 'ps -o comm= -p "$PPID"; echo "$PPID $(ps -o lstart= -p "$PPID")"';

export default class WorkspaceStatus extends View {
  // names: the toggle, and the start check.
  init(_props, cx) {
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") setShared("names.hidden", shared("names.hidden") !== true);
        cx.notify();
      }
    });
    // Names hidden in an earlier run of the app are shown again: the mode is for a screenshot.
    cx.spawn(async () => {
      try {
        const r = await exec("sh", ["-c", BOOT], { timeout: 5000 });
        const [comm, id] = r.stdout.trim().split("\n").map((l) => l.trim());
        if (r.code !== 0 || !/(^|\/)Herdr$/i.test(comm ?? "") || !id) return;
        const boot = id.replace(/\s+/g, " ");
        if (shared("names.boot") === boot) return;
        if (shared("names.hidden") === true) setShared("names.hidden", false);
        setShared("names.boot", boot);
      } catch { /* no ps: the flag stays as it is */ }
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    // names: made up while hidden.
    const hidden = shared("names.hidden") === true;
    const machine = space?.machine ? (hidden ? alias.machine(space.machine) : space.machine) : "This computer";
    const branch = hidden ? alias.branch(space?.branch) : space?.branch;
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", machine))
      .when(Boolean(space?.branch), el => el.child(label("branch", branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
