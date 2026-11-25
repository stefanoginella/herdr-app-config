// Chooses from the refs the Git panel has already read on the checkout's machine.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { request } from "./ops.js";

const label = (ref) => ref.replace(/^refs\/(heads|remotes)\//, "");
export default class ReviewBase {
  init(cx) {
    const p = props();
    this.id = p.overlay; this.target = p.reviewBase;
    this.refs = this.target.refs.filter((ref) => ref !== this.target.branch);
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Find a base branch" });
    this.match("");
    this.input.on("change", (_e, cx) => { this.match(this.input.value()); cx.notify(); });
    this.input.on("submit", () => this.pick(this.matches[0]));
    this.input.focus();
  }

  match(query) {
    const needle = query.toLowerCase();
    this.matches = this.refs.filter((r) => label(r).toLowerCase().includes(needle)).slice(0, 100);
  }

  pick(base) {
    if (!base) return;
    const { root, on, tab, branch } = this.target;
    closeOverlay(this.id);
    request({ root, on, tab, branch, base, op: "review-branch" });
  }

  render() {
    const t = theme();
    return v_flex().track_focus(this.handle).h_full().min_h(0).p(14).gap(8).bg(t.popover).text_color(t.foreground)
      .child(div().truncate().font_semibold().child("Review " + label(this.target.branch)))
      .child(div().text_size(12).text_color(t.muted).child("Compare with the common ancestor of this base branch"))
      .child(Input.new(this.input).h(32).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("base-refs").absolute().inset_0().overflow_y_scroll()
          .when(this.matches.length === 0, (e) => e.child(div().p(6).text_color(t.dim).child("No matching branches")))
          .children(this.matches.map((ref, i) => h_flex().id("base-" + i).h(26).px(6).flex_none().items_center().rounded(4).cursor_pointer()
            .when(i === 0, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click(() => this.pick(ref))
            .child(div().flex_1().min_w(0).truncate().child(label(ref)))
            .child(div().text_size(11).text_color(t.dim).child(ref.startsWith("refs/heads/") ? "Local" : "Remote")))))
        .child(Scrollbar.vertical("base-refs").absolute().inset_0()));
  }
}
