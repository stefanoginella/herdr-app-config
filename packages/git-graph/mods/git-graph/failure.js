// A read-only window for one GitHub Actions run. Its pinned repository and machine
// stay with it when the user moves to another space.
import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { closeOverlay, props, settings, theme } from "herdr";
import { failedJobs, failedLog } from "./hub.js";

function button(t, id, label, click) {
  return div().id(id).flex_none().px(9).py(5).rounded(5).cursor_pointer().bg(t.raised)
    .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => click(cx)).child(label);
}

export default class Failure {
  init(cx) {
    const p = props();
    this.target = p.failure;
    this.overlay = p.overlay;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.jobs = [];
    this.message = "Loading failed jobs…";
    this.output = EditorState.new({ readonly: true, language: "txt", folding: false, line_numbers: false, soft_wrap: true });
    cx.spawn(async (cx) => {
      const { run, root, on, repo } = this.target;
      try {
        this.jobs = await failedJobs(run, root, on, repo);
        const job = this.jobs.find((j) => j.id === run.job) ?? this.jobs[0];
        if (job) return this.select(job, cx);
        this.message = "GitHub reported no failed jobs for this run.";
      } catch (e) { this.message = String(e.message || e); }
      cx.notify();
    });
  }

  select(job, cx) {
    const { root, on, repo } = this.target;
    this.job = job;
    this.log = "";
    this.copied = false;
    this.message = "Loading failed steps…";
    const request = this.request = (this.request ?? 0) + 1;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const text = await failedLog(job.id, root, on, repo);
        if (request !== this.request) return;
        this.log = text;
        this.output.set_value(text);
        this.message = text ? "" : "GitHub returned no failed-step log for this job.";
      } catch (e) {
        if (request !== this.request) return;
        this.message = String(e.message || e);
      }
      cx.notify();
    });
  }

  render() {
    const t = theme(), { run } = this.target, job = this.job;
    return v_flex().id("ci-window").size_full().min_h(0).p(14).gap(10).bg(t.popover)
      .border_1().border_color(t.border).rounded(10).text_size(12).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); closeOverlay(this.overlay); }
      })
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().truncate().font_semibold().text_size(15).child(run.name || "Failed workflow"))
        .child(button(t, "ci-web", "Open on GitHub", (cx) => cx.open_url(run.url)))
        .child(button(t, "ci-close", "Close", () => closeOverlay(this.overlay))))
      .when(this.jobs.length > 0, (el) => el.child(v_flex().id("ci-jobs").flex_none().h(Math.min(116, 27 * this.jobs.length)).overflow_y_scrollbar()
        .children(this.jobs.map((j) => h_flex().id(`ci-job-${j.id}`).h(27).flex_none().items_center().px(7).gap(6)
          .rounded(4).cursor_pointer().when(j.id === job?.id, (row) => row.bg(t.selected)).hover((row) => row.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.select(j, cx))
          .child(div().w(6).h(6).rounded(3).bg(t.blocked))
          .child(div().flex_1().truncate().child(j.name))
          .child(div().flex_none().text_color(t.muted).child(j.conclusion))))))
      .when(Boolean(job), (el) => el.child(h_flex().items_center().gap(6)
        .child(div().flex_1().truncate().tooltip(job.steps.join("\n") || job.name).font_medium()
          .child(job.steps.join(" · ") || job.name))
        .when(Boolean(this.log), (row) => row.child(button(t, "ci-copy", this.copied ? "Copied" : "Copy log", (cx) => {
          cx.write_to_clipboard(this.log);
          this.copied = true;
          cx.notify();
        })))))
      .child(this.message ? div().flex_1().min_h(0).p(8).text_color(t.muted).child(this.message)
        : Editor.new(this.output).flex_1().min_h(0).font_family(settings().font_family).text_size(12));
  }
}
