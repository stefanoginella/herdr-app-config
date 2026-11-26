// The two branch pickers use the refs the panel has already read on the checkout's machine.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { props, closeOverlay, theme, nextCommand, keys } from "herdr";
import { request } from "./ops.js";

const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
const ROW = 44;
let bound;

function bind(cx) {
  const signature = JSON.stringify(keys());
  if (bound === signature) return;
  cx.bind_keys([["up", "prev"], ["down", "next"]].map(([keystroke, direction]) => ({
    keystroke, action: `git-panel.picker-${direction}`, context: "mod == git-panel > GitBranchPicker > Input",
  })));
  bound = signature;
}

const label = (ref) => ref.replace(/^refs\/(heads|remotes)\//, "");

export default class BranchPicker {
  init(cx) {
    const p = props();
    this.id = p.overlay;
    this.target = p.reviewBase ?? p.branchPicker;
    this.review = Boolean(p.reviewBase);
    this.refs = this.target.refs.filter(({ ref }) => !this.review || ref !== this.target.branch);
    this.input = InputState.new({ placeholder: this.review ? "Find a base branch" : "Find a branch" });
    this.scroll = VirtualListScrollHandle.new();
    this.match("");
    this.input.on("change", (_e, cx) => { this.match(this.input.value()); cx.notify(); });
    this.input.on("submit", () => this.pick(this.matches[this.at]));
    bind(cx);
    this.input.focus();
    cx.spawn(async (cx) => {
      for (;;) {
        const name = await nextCommand();
        if ((name === "picker-prev" || name === "picker-next") && this.matches.length) {
          const n = this.matches.length;
          this.at = (this.at + (name === "picker-prev" ? -1 : 1) + n) % n;
          this.scroll.scroll_to_item(this.at);
          cx.notify();
        }
      }
    });
  }

  match(query) {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    this.matches = this.refs.filter((row) => words.every((word) => row.name.toLowerCase().includes(word)));
    this.at = 0;
    this.scroll.scroll_to_item(0, "top");
  }

  pick(row) {
    if (!row) return;
    const { root, on, tab, branch } = this.target;
    closeOverlay(this.id);
    if (this.review) request({ root, on, tab, branch, base: row.ref, op: "review-branch" });
    else if (!row.current) request({ root, on, row, op: "pick-branch", expect: { branch, refs: [[row.ref, row.sha]] } });
  }

  row(t, row, selected) {
    const state = row.current ? "Current" : row.checkedOut ? "In a worktree" : row.remote ? "Remote" : "";
    return h_flex().w_full().h(ROW).px(8).gap(8).items_center().rounded(6).cursor_pointer().bg(selected ? t.selected : t.popover)
      .child(svg(CHROME(row.current ? "check" : "git-branch")).size(13).flex_none().text_color(selected ? t.accent : t.dim))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.5).text_color(t.foreground).child(row.name))
        .when(Boolean(row.subject), (e) => e.child(div().truncate().text_size(11).text_color(t.muted).child(row.subject))))
      .child(h_flex().flex_none().gap(6).items_center().text_size(11)
        .when(Boolean(row.gone), (e) => e.child(div().text_color(t.ansi1).child("Upstream gone")))
        .when(Boolean(row.ahead), (e) => e.child(div().text_color(t.ansi2).child(`↑${row.ahead}`)))
        .when(Boolean(row.behind), (e) => e.child(div().text_color(t.muted).child(`↓${row.behind}`)))
        .when(Boolean(state), (e) => e.child(div().text_color(t.dim).child(state))));
  }

  render(cx) {
    if (bound !== JSON.stringify(keys())) cx.spawn(async (cx) => { await null; bind(cx); });
    const t = theme(), rows = this.matches, selected = this.at;
    const active = rows[selected];
    const action = this.review ? "compare" : active?.checkedOut && !active.current ? "go to checkout" : "switch";
    return v_flex().id("git-branch-picker").key_context("GitBranchPicker").size_full().min_h(0).items_stretch().p(14).gap(8).bg(t.popover).text_color(t.foreground)
      .child(div().truncate().font_semibold().child(this.review ? "Review " + label(this.target.branch) : "Switch branch"))
      .child(Input.new(this.input).w_full().h(32).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .child(div().flex_1().min_h(0).relative()
        .child(div().absolute().inset_0().child(rows.length
          ? v_virtual_list("git-branch-matches", rows.length, ROW, (i) => rows[i].ref,
            (range) => rows.slice(range.start, range.end).map((row, i) => this.row(t, row, range.start + i === selected)))
            .size_full().track_scroll(this.scroll).on_item_click((ref) => this.pick(rows.find((row) => row.ref === ref)))
          : div().p(6).text_color(t.dim).child("No matching branches")))
        .when(rows.length > 0, (e) => e.child(Scrollbar.vertical("git-branch-matches").viewport_from_layout().absolute().inset_0())))
      .child(div().px(6).text_size(11).text_color(t.dim).child(this.review
        ? "↑ ↓  Navigate   ·   Enter to compare from the common ancestor"
        : `↑ ↓  Navigate   ·   Enter to ${action}`));
  }
}
