// The editor and the list of saved feedback both belong to the branch comparison
// that opened them. Clipboard output always identifies that comparison's pinned tip.
import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState, Scrollbar } from "gpui-base";
import { closeOverlay, shared, setShared, theme } from "herdr";
import * as diff from "./diff.js";
import * as review from "./review.js";

const read = (key) => shared(key) ?? {};
const notesOf = (key) => read(key).notes ?? [];
const button = (id, label, t, action, enabled = true) => div().id(id).flex_none().px(9).py(5).rounded(6).text_size(12)
  .text_color(enabled ? t.foreground : t.dim).when(enabled, (e) => e.bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action)).child(label);

export default class ReviewNotes {
  init(p, git, cx) {
    this.id = p.overlay;
    this.info = p.reviewNotes;
    this.git = git;
    this.excluded = new Set();
    this.checked = new Map(); this.inflight = new Set();
    this.handle = cx.focus_handle();
    if (this.info.choices?.length) {
      this.anchor = this.info.choices[this.info.choices.length - 1];
      this.input = TextareaState.new({ placeholder: "Feedback on this line" });
      this.input.on("change", (_e, cx) => cx.notify());
      this.input.on("submit", (e) => { if (e.secondary) this.save(); });
      this.input.focus();
    } else {
      this.handle.focus();
      this.checkNew(notesOf(this.info.key), cx);
    }
  }

  checkNew(notes, cx) {
    const pending = notes.filter((n) => !this.checked.has(n.id) && !this.inflight.has(n.id));
    if (!pending.length) return;
    for (const n of pending) this.inflight.add(n.id);
    cx.spawn(async (cx) => {
      await null;
      await this.verify(pending);
      for (const n of pending) this.inflight.delete(n.id);
      cx.notify();
    });
  }

  save() {
    const i = this.info, body = this.input.value().trim();
    if (!body) return;
    const state = read(i.key);
    const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), body,
      anchor: this.anchor, path: i.path, signature: i.signature, revision: i.tip, fork: i.fork, from: i.from };
    setShared(i.key, { ...state, notes: [...(state.notes ?? []), note] });
    closeOverlay(this.id);
  }

  // Edits in another file do not invalidate a note. When the blob pair changes, the
  // original context must identify one changed line on the same side of the diff.
  async verify(notes) {
    const i = this.info, files = new Map(), ancestors = new Map();
    for (const n of notes) {
      if (n.revision === i.tip && n.fork === i.fork) { this.checked.set(n.id, { line: n.anchor.line }); continue; }
      if (n.fork !== i.fork) { this.checked.set(n.id, { stale: true }); continue; }
      try {
        if (!ancestors.has(n.revision)) {
          const result = await this.git(["merge-base", "--is-ancestor", n.revision, i.tip]);
          if (result.code !== 0 && result.code !== 1) throw new Error("The original revision could not be read.");
          ancestors.set(n.revision, result.code === 0);
        }
        if (!ancestors.get(n.revision)) { this.checked.set(n.id, { stale: true }); continue; }
        const key = JSON.stringify([n.from, n.path]);
        if (!files.has(key)) {
          const raw = await this.git(["diff", "--raw", "--no-renames", "--no-abbrev", "-z", n.from, i.tip, "--", n.path]);
          if (raw.code) throw new Error(raw.stderr.trim() || "The file could not be compared.");
          files.set(key, { signature: review.rawFiles(raw.stdout).get(n.path)?.signature });
        }
        const file = files.get(key);
        if (file.signature === n.signature) { this.checked.set(n.id, { line: n.anchor.line }); continue; }
        if (!file.signature) { this.checked.set(n.id, { stale: true }); continue; }
        if (!file.anchors) {
          const patch = await this.git(review.patchArgs(n.from, i.tip, n.path));
          if (patch.code) throw new Error(patch.stderr.trim() || "The diff could not be read.");
          const parsed = diff.parse(patch.stdout, true);
          // A duplicate anchor might lie in the omitted part.
          file.anchors = parsed.cut ? new Map() : review.anchors(parsed);
        }
        const line = review.relocate(n.anchor, file.anchors);
        this.checked.set(n.id, line ? { line: line.line } : { stale: true });
      } catch (e) { this.checked.set(n.id, { error: String(e?.message ?? e) }); }
    }
  }

  drop(id, cx) {
    const key = this.info.key, state = read(key);
    this.copied = false;
    setShared(key, { ...state, notes: (state.notes ?? []).filter((n) => n.id !== id) });
    cx.notify();
  }

  render(cx) {
    const t = theme(), i = this.info;
    const panel = v_flex().id("review-notes").track_focus(this.handle).w_full().h_full().min_h(0).p(14).gap(9)
      .bg(t.popover).text_color(t.foreground).text_size(12.5);
    const title = (s) => div().font_semibold().text_size(15).truncate().child(s);
    if (this.input) {
      const a = this.anchor;
      return panel.child(title("Add review note"))
        .child(h_flex().gap(6).items_center().child(div().flex_1().truncate().child(i.path))
          .children(i.choices.map((at) => button("side-" + at.side, (a === at ? "✓ " : "") + at.side + " line " + at.line, t,
            (_e, cx) => { this.anchor = at; this.input.focus(); cx.notify(); }))))
        .child(div().truncate().text_color(t.dim).child(a.text || "(empty line)"))
        .child(Textarea.new(this.input).flex_1().min_h(40).px(8).py(6).border_1().border_color(t.input).rounded(6).bg(t.background))
        .child(h_flex().gap(6).justify_end().child(button("cancel", "Cancel", t, () => closeOverlay(this.id)))
          .child(button("save", "Save note", t, () => this.save(), Boolean(this.input.value().trim()))));
    }
    const notes = notesOf(i.key), chosen = notes.filter((n) => this.checked.get(n.id)?.line && !this.excluded.has(n.id));
    this.checkNew(notes, cx);
    return panel.child(title("Review notes · " + review.branchName(i.source.branch)))
      .child(div().text_color(t.dim).child("Reviewed revision " + i.tip.slice(0, 12)))
      .child(div().flex_1().min_h(0).relative().child(v_flex().id("review-note-list").absolute().inset_0().overflow_y_scroll().gap(8)
        .when(!notes.length, (e) => e.child(div().text_color(t.dim).child("Click a changed line to add a note.")))
        .children(notes.map((n) => {
          const c = this.checked.get(n.id), loc = c?.line || n.anchor.line;
          const status = c?.stale ? "Outdated" : c?.error ? "Could not verify" : c?.line ? "" : "Checking…";
          return v_flex().flex_none().p(7).gap(4).rounded(5).bg(t.surface)
            .child(h_flex().items_center().gap(5)
              .child(button("pick-" + n.id, this.excluded.has(n.id) || !c?.line ? "□" : "✓", t, (_e, cx) => {
                if (this.excluded.has(n.id)) this.excluded.delete(n.id); else this.excluded.add(n.id);
                this.copied = false; cx.notify();
              }, Boolean(c?.line)))
              .child(div().flex_1().min_w(0).truncate().child(n.path + ":" + loc + " (" + n.anchor.side + ")"))
              .when(Boolean(status), (e) => e.child(div().text_color(t.blocked).tooltip(c?.error || status).child(status)))
              .child(button("remove-" + n.id, "Remove", t, (_e, cx) => this.drop(n.id, cx))))
            .child(div().text_color(t.dim).truncate().child(n.anchor.text || "(empty line)")).child(div().child(n.body));
        }))).child(Scrollbar.vertical("review-note-list").absolute().inset_0()))
      .child(h_flex().justify_end().gap(5)
        .child(button("close", "Close", t, () => closeOverlay(this.id)))
        .child(button("copy", this.copied ? "Copied" : `Copy review notes (${chosen.length})`, t, (_e, cx) => {
          cx.write_to_clipboard(review.feedback(i.source, i.tip, chosen.map((note) => ({ note, line: this.checked.get(note.id).line }))));
          this.copied = true; cx.notify();
        }, chosen.length > 0 && notes.every((n) => this.checked.has(n.id)))));
  }
}
