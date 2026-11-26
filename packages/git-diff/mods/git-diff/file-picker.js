// Search the file list belonging to the pane that opened this dialog.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { closeOverlay, theme, setShared, nextCommand, keys } from "herdr";

export const FILE_PICK = "git-diff.file-pick";
const ROW = 30;
let bound;

function bind(cx) {
  const signature = JSON.stringify(keys());
  if (bound === signature) return;
  cx.bind_keys([["up", "prev"], ["down", "next"]].map(([keystroke, direction]) => ({
    keystroke, action: "git-diff.picker-" + direction, context: "mod == git-diff > GitDiffFilePicker > Input",
  })));
  bound = signature;
}

export default class FilePicker {
  init(p, cx) {
    this.overlay = p.overlay;
    this.target = p.filePicker;
    this.rows = this.target.files;
    this.at = Math.max(0, this.rows.findIndex((f) => f.path === this.target.current?.path && f.group === this.target.current?.group));
    this.input = InputState.new({ placeholder: "Find a changed file" });
    this.scroll = VirtualListScrollHandle.new();
    this.scroll.scroll_to_item(this.at);
    this.input.on("change", (_e, cx) => {
      const words = this.input.value().trim().toLowerCase().split(/\s+/).filter(Boolean);
      this.rows = this.target.files.filter((f) => words.every((word) => f.path.toLowerCase().includes(word)));
      this.at = 0;
      this.scroll.scroll_to_item(0, "top");
      cx.notify();
    });
    this.input.on("submit", () => this.pick(this.rows[this.at]));
    bind(cx);
    this.input.focus();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if ((c !== "picker-prev" && c !== "picker-next") || !this.rows.length) continue;
        this.at = (this.at + (c === "picker-prev" ? -1 : 1) + this.rows.length) % this.rows.length;
        this.scroll.scroll_to_item(this.at);
        cx.notify();
      }
    });
  }

  pick(file) {
    if (!file) return;
    setShared(FILE_PICK, { target: this.target.id, path: file.path, group: file.group });
    closeOverlay(this.overlay);
  }

  render(cx) {
    if (bound !== JSON.stringify(keys())) cx.spawn(async (cx) => { await null; bind(cx); });
    const t = theme(), rows = this.rows, at = this.at;
    return v_flex().id("git-diff-file-picker").key_context("GitDiffFilePicker").size_full().min_h(0).items_stretch().p(14).gap(8).bg(t.popover).text_color(t.foreground)
      .child(div().font_semibold().child("Changed files"))
      .child(Input.new(this.input).w_full().h(32).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .child(div().flex_1().min_h(0).relative()
        .child(div().absolute().inset_0().child(rows.length
          ? v_virtual_list("gd-file-matches", rows.length, ROW, (i) => String(i), (range) => rows.slice(range.start, range.end).map((f, i) =>
            h_flex().w_full().h(ROW).px(8).gap(8).items_center().rounded(6).cursor_pointer().bg(range.start + i === at ? t.selected : t.popover)
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(f.path))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(f.label))))
            .track_scroll(this.scroll).size_full().on_item_click((key) => this.pick(rows[Number(key)]))
          : div().p(6).text_color(t.dim).child("No matching files")))
        .when(rows.length > 0, (e) => e.child(Scrollbar.vertical("gd-file-matches").viewport_from_layout().absolute().inset_0())));
  }
}
