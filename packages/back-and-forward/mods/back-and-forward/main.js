// Back and forward buttons, like Slack's: every space and tab you look at goes into a history,
// and the arrows step through it. A step is a tab; clicking around panes inside a tab only
// updates which pane that step comes back to.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, closeOverlay, focused, nextCommand, openOverlay, panes, props, run, shared, spaces, theme } from "herdr";
import * as alias from "./alias.js";

const MAX_STEPS = 100;
const ROW_HEIGHT = 28;
// A step runs space.select, tab.select and pane.focus in turn, and a render can land between them.
const ARRIVAL_WINDOW_MS = 1000;

const sameTab = (a, b) => a.space === b.space && a.tab === b.tab;

function tabExists(step, available) {
  const space = available.find((s) => s.id === step.space);
  return Boolean(space && space.tabs.some((t) => t.id === step.tab));
}

export default class BackForward extends View {
  init(_p, cx) {
    const p = props();
    if (p?.overlay && Array.isArray(p.recent)) {
      this.menu = p;
      return;
    }
    this.recent = [];
    this.steps = [];
    this.index = -1;
    this.goingTo = null;
    if (!checking()) cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "back" || command === "forward") this.go(command === "back" ? -1 : 1);
        cx.notify();
      }
    });
  }

  // Render runs on every focus change, so this is where the history follows along.
  follow() {
    const f = focused();
    if (!f?.space || !f.tab) return;
    if (this.recent[0] !== f.space) {
      this.recent = [f.space, ...this.recent.filter((id) => id !== f.space)].slice(0, MAX_STEPS);
    }
    if (this.goingTo !== null) {
      const target = this.steps[this.goingTo.index];
      if (target && sameTab(target, f)) {
        this.goingTo = null;
        this.index = this.steps.indexOf(target);
        if (f.pane) target.pane = f.pane;
        return;
      }
      if (target && Date.now() - this.goingTo.at < ARRIVAL_WINDOW_MS) return;
      this.goingTo = null;
    }
    const current = this.steps[this.index];
    if (current && sameTab(current, f)) {
      if (f.pane) current.pane = f.pane;
      return;
    }
    this.steps = this.steps.slice(0, this.index + 1);
    this.steps.push({ space: f.space, tab: f.tab, pane: f.pane });
    if (this.steps.length > MAX_STEPS) this.steps.shift();
    this.index = this.steps.length - 1;
  }

  // The nearest step in that direction whose tab still exists and isn't the one already shown.
  // Closing the tab between two visits to another leaves those visits side by side in the history.
  nextIndex(direction, available) {
    const from = this.goingTo?.index ?? this.index;
    const current = this.steps[from];
    for (let i = from + direction; i >= 0 && i < this.steps.length; i += direction) {
      const step = this.steps[i];
      if (tabExists(step, available) && !(current && sameTab(step, current))) return i;
    }
    return null;
  }

  go(direction) {
    const i = this.nextIndex(direction, spaces());
    if (i === null) return;
    // Keep the destination pane even if space.select causes a render on the right tab first.
    const { space, tab, pane } = this.steps[i];
    this.goingTo = { index: i, at: Date.now() };
    if (focused()?.space !== space) run("space.select", { id: space });
    run("tab.select", { id: tab });
    if (pane && panes().some((p) => p.tab === tab && p.pane === pane)) run("pane.focus", { pane });
  }

  mouseHistory(e, cx) {
    const m = e.modifiers;
    if (!m.alt || m.shift || m.control || m.platform || m.function) return;
    if (e.button !== "back" && e.button !== "forward") return;
    cx.stop_propagation();
    this.go(e.button === "back" ? -1 : 1);
  }

  recentMenu(t, available) {
    const byId = new Map(available.map((space) => [space.id, space]));
    const recent = this.menu.recent.map((id) => byId.get(id)).filter(Boolean);
    const hidden = shared("names.hidden");
    const row = (space) => {
      const name = hidden ? alias.project(space.name) : space.name;
      const machine = hidden ? alias.machine(space.machine) : space.machine;
      return h_flex().id(`recent-${space.id}`).h(ROW_HEIGHT).flex_none().items_center().gap(7).px(7).rounded(5)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip(machine ? `${name} · ${machine}` : name)
        .on_click(() => {
          closeOverlay(this.menu.overlay);
          if (spaces().some((s) => s.id === space.id && !s.active)) run("space.select", { id: space.id });
        })
        .child(div().size(14).flex_none().when(space.active, (el) =>
          el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.accent))))
        .child(div().flex_1().min_w(0).truncate().child(name))
        .when(Boolean(machine), (el) => el.child(div().max_w(100).truncate().text_size(11).text_color(t.muted).child(machine)));
    };
    return v_flex().w_full().min_h(0).p(5).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(div().px(7).py(4).flex_none().text_size(11).font_semibold().text_color(t.muted).child("Recent workspaces"))
      .child(recent.length
        ? v_flex().id("recent-list").min_h(0).h(ROW_HEIGHT * Math.min(10, recent.length)).overflow_y_scrollbar().children(recent.map(row))
        : div().px(7).py(6).text_color(t.muted).child("No recent workspaces"));
  }

  button(t, id, icon, direction, label, available) {
    const enabled = this.nextIndex(direction, available) !== null;
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7)
      .text_color(enabled ? t.foreground : t.dim).opacity(enabled ? 1 : 0.45)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .tooltip(`${label} · Right-click for recent workspaces`)
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "back-and-forward", kind: "popup", at: e.position, width: 260, props: { recent: this.recent } });
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => this.go(direction))
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(18));
  }

  render() {
    const t = theme(), available = spaces();
    if (this.menu) return this.recentMenu(t, available);
    this.follow();
    // Outside the status block, capture the press before the editor or diff gets it.
    // Inside, the same gesture goes through the block's own button handlers.
    const press = (e, cx) => this.mouseHistory(e, cx);
    return h_flex().size_full().bg(t.chrome).px(6).gap(2).items_center()
      .on_mouse_down_out(press)
      .on_mouse_down("back", press)
      .on_mouse_down("forward", press)
      .child(this.button(t, "back", "chevron-left", -1, "Back", available))
      .child(this.button(t, "forward", "chevron-right", 1, "Forward", available));
  }
}
