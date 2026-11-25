// A result's right-click menu, opened as a popup with props { menu: { root, on, path, id, line,
// column, text, replace } }. `path` (under root) is the file; `id`, `line` and `column` name a
// match in it, and `text` is that match's line. `replace`: the list can be replaced now.
// ↑/↓ move, Enter runs, Esc closes. Drawn like Herdr's own menu.
// What needs a program is left for the panel (ops.js); the clipboard is written here.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import * as ops from "./ops.js";

const MOD = "project-search";
const ROW = 31;
const ICON = {
  open: "mods/workspace-chrome/file-text.svg", app: "mods/files-actions/open.svg", reveal: "mods/workspace-chrome/folder.svg",
  copy: "mods/files-actions/copy.svg", replace: `mods/${MOD}/replace.svg`, dismiss: "mods/workspace-chrome/x.svg",
};

// Rows: { label, icon, act(cx), rule? (a line above) } and { section } (a heading, not a choice).
function rows(m) {
  if (!m.path) return [];
  const target = { path: m.path, id: m.id ?? null }, abs = `${m.root}/${m.path}`;
  const out = [{ section: m.id ? `${ops.base(m.path)} · line ${m.line}` : ops.base(m.path) }];
  out.push({ label: "Open in Editor", icon: "open", act: () => ops.request({ op: "open", ...target }) });
  if (ops.canOpen(m.on)) {
    out.push({ label: "Open in VS Code", icon: "app", act: () => ops.request({ op: "app", app: "vscode", ...target }) });
    out.push({ label: "Reveal in Finder", icon: "reveal", act: () => ops.request({ op: "app", app: "finder", ...target }) });
  }
  out.push({ label: "Copy Path", icon: "copy", rule: true, act: (cx) => cx.write_to_clipboard(abs) });
  out.push({ label: "Copy Relative Path", icon: "copy", act: (cx) => cx.write_to_clipboard(m.path) });
  if (m.id && typeof m.text === "string") out.push({ label: "Copy Line", icon: "copy", act: (cx) => cx.write_to_clipboard(m.text) });
  if (m.replace) out.push({ label: m.id ? "Replace" : "Replace in File", icon: "replace", rule: true, act: () => ops.request({ op: "replace", ...target }) });
  out.push({ label: "Dismiss", icon: "dismiss", rule: !m.replace, act: () => ops.request({ op: "dismiss", ...target }) });
  return out;
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
    const list = rows(p.menu ?? {});
    const choices = list.filter((r) => r.act);
    const choose = (r, cx) => {
      closeOverlay(p.overlay);
      r.act(cx);
    };
    // The popup is as tall as its rows, so nothing here may scroll by itself.
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % choices.length;
        else if (e.key === "up") this.at = (this.at + choices.length - 1) % choices.length;
        else if (e.key === "enter") { if (choices[this.at]) choose(choices[this.at], cx); }
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((r, i) =>
        v_flex()
          .flex_none()
          .when(Boolean(r.rule), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(r.section
            ? div().px(8).pt(3).pb(4).text_size(11).text_color(t.dim).truncate().child(r.section)
            : h_flex()
              .id(`mi-${i}`)
              .h(ROW)
              .px(8)
              .gap(9)
              .rounded(7)
              .items_center()
              .text_color(t.foreground)
              .when(choices[this.at] === r, (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => choose(r, cx))
              .child(svg(ICON[r.icon]).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().min_w(0).truncate().child(r.label)))));
  }
}
