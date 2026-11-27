// Back and forward buttons, like Slack's: every space and tab you look at goes into a history,
// and the arrows step through it. A step is a tab; clicking around panes inside a tab only
// updates which pane that step comes back to.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, focused, nextCommand, panes, spaces, theme, run } from "herdr";

const MAX_STEPS = 100;
// A step runs space.select, tab.select and pane.focus in turn, and a render can land between them.
const ARRIVAL_WINDOW_MS = 1000;

const sameTab = (a, b) => a.space === b.space && a.tab === b.tab;

function tabExists(step, available) {
  const space = available.find((s) => s.id === step.space);
  return Boolean(space && space.tabs.some((t) => t.id === step.tab));
}

export default class BackForward extends View {
  init(_p, cx) {
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

  button(t, id, icon, direction, label, available) {
    const enabled = this.nextIndex(direction, available) !== null;
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(7)
      .text_color(enabled ? t.foreground : t.dim).opacity(enabled ? 1 : 0.45)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .tooltip(label)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => this.go(direction))
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(18));
  }

  render() {
    this.follow();
    const t = theme(), available = spaces();
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
