// Names a new branch or tag. Opened as a dialog with props { naming: { root, on, what:
// "branch" | "tag", at, go } }: `at` is the commit it starts at, and `go` switches to the new
// branch once it is made.
// Enter makes it, Esc cancels. Drawn like Herdr's own prompt. The change itself is the panel's
// (ops.js): this only asks for it.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import * as ops from "./ops.js";
import { nameError } from "./git.js";

export default class Naming {
  init(cx) {
    this.text = "";
    this.input = InputState.new({ value: "", placeholder: "Name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props(), n = p.naming ?? {};
    const name = this.text.trim();
    if (nameError(name) !== null) return;
    if (n.what === "tag") ops.request({ op: "tag", root: n.root, on: n.on, name, at: n.at });
    // Switching to it is only right while HEAD is still the commit it starts at.
    else ops.request({ op: "branch", root: n.root, on: n.on, name, at: n.at, go: Boolean(n.go), ...(n.go ? { expect: { refs: [["HEAD", n.at]] } } : {}) });
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {}, n = p.naming ?? {};
    const at = String(n.at ?? "").slice(0, 7);
    const title = n.what === "tag" ? `New tag at ${at}` : n.go ? "New branch" : `New branch at ${at}`;
    const error = nameError(this.text.trim());
    const ok = error === null;
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(primary && !ok, (el) => el.opacity(0.5))
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("naming").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(8).child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(n.what === "branch" && n.go ? "Name (it is switched to)" : "Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(error ? t.blocked : this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().h(18).pt(5).text_size(11).text_color(t.blocked).child(error ?? ""))
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(button("nm-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("nm-save", "Create", true, () => this.submit())));
  }
}
