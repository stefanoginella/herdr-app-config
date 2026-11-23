// Names a folder: a new one (optionally around a space), or one being renamed. Opened as a dialog
// with props { naming: { title, value?, folder? (rename it), around? (a space to put in the new one),
// kids?, keys?, on? (the new one's machine; around a space, that space's) } }. Enter saves, Esc cancels. Drawn like Herdr's own prompt.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import * as model from "./model.js";

export default class Naming {
  init(cx) {
    this.text = props()?.naming?.value ?? "";
    this.input = InputState.new({ value: this.text, placeholder: "Folder name" });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
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
    const p = props();
    const n = p.naming ?? {};
    const name = model.clean(this.text);
    if (!name) return;
    const m = model.load();
    if (n.folder) model.renameFolder(m, n.folder, name);
    else {
      // Around a space: the folder appears where that space was.
      const from = n.around ? model.folderOf(m, n.around) : null;
      const on = n.around ? model.machineOf(n.around) : n.on ?? null;
      const id = model.addFolder(m, name, !n.around ? { start: true } : from ? { after: from.id } : { before: n.around }, on);
      if (n.around) model.file(m, n.around, { folder: id }, { kids: n.kids ?? [], keys: n.keys ?? {} });
    }
    model.save(m);
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const n = p.naming ?? {};
    const ok = Boolean(model.clean(this.text));
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(primary && !ok, (el) => el.opacity(0.5))
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("naming").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(n.title ?? "Folder"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("nm-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("nm-save", "Save", true, () => this.submit())));
  }
}
