// An agent row's right-click menu, opened as a popup with props { menu: { address } }.
// ↑/↓ move, Enter runs, Esc closes. Drawn like Herdr's own menu.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, run, props, closeOverlay, theme, keys } from "herdr";
import { marked, mark, unmark } from "./unread.js";

const MOD = "agents-unread";

// The key bound to a command, for the hint on the right.
function shortcut(name) {
  return keys().find((b) => b.action === name)?.keys ?? "";
}

function rows(address) {
  const a = agents().find((a) => a.address === address);
  if (!a) return [];
  const unread = marked(address);
  // The toggle key acts on the agent being looked at: its hint belongs on that row only.
  const hint = a.focused ? shortcut(`${MOD}.toggle`) : "";
  return [
    ...(unread ? [{ label: "Mark as read", icon: `mods/${MOD}/read.svg`, hint, act: () => unmark(address) }]
      : a.status === "idle" ? [{ label: "Mark as unread", icon: `mods/${MOD}/unread.svg`, hint, act: () => mark(address) }] : []),
    { label: a.pinned ? "Unpin" : "Pin to the top", icon: `mods/workspace-chrome/${a.pinned ? "pin-off" : "pin"}.svg`, act: () => run("terminal.pin", { terminal: address, pinned: !a.pinned }) },
    ...(a.status === "idle" && !unread && a.pane ? [{ label: "Close", icon: "mods/pane/close.svg", act: () => run("pane.close", { pane: a.pane }) }] : []),
  ];
}

export default class Menu {
  init(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const list = rows(p.menu?.address);
    const choose = (r) => {
      closeOverlay(p.overlay);
      r.act();
    };
    // The popup is as tall as its rows, so nothing here may scroll.
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") { if (list[this.at]) choose(list[this.at]); }
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((r, i) => h_flex()
        .id(`mi-${i}`)
        .flex_none()
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .justify_between()
        .text_color(t.foreground)
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => choose(r))
        .child(svg(r.icon).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(r.label))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.hint ?? ""))));
  }
}
