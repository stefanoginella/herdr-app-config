// Asks before a file goes to the Trash. Opened as a dialog with props { confirm: { title, detail,
// button, request } }: Enter confirms (leaves `request` for the panel, see ops.js), Esc cancels.
// Drawn like Herdr's own confirm, which can only run an app command.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import * as ops from "./ops.js";

export default class Confirm {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  yes() {
    const p = props();
    closeOverlay(p.overlay);
    ops.request(p.confirm.request);
  }

  render() {
    const t = theme();
    const p = props() ?? {}, c = p.confirm ?? {};
    const button = (id, label, bg, fg, onClick) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(id === "no" ? t.input : bg).bg(bg).text_color(fg).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    return v_flex()
      .id("confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        // Not the Enter that chose this in the menu, still held down.
        if (e.key === "enter") { if (!e.is_held) this.yes(); }
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().items_center().gap(8).child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(c.title ?? "Are you sure?")).child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_1().min_h(0).text_color(t.muted).child(c.detail ?? ""))
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .text_size(12)
          .child(button("no", "Cancel", t.raised, t.foreground, () => closeOverlay(p.overlay)))
          .child(button("yes", c.button ?? "Confirm", t.solid, t.solid_foreground, () => this.yes())),
      );
  }
}
