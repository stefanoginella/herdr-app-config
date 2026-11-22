// The panel's right-click menu, opened as a popup with props { menu: { root, on, path, dir,
// project, repo, vault, projectVault } }. `path` (under root) is the file or folder clicked,
// null for the project alone: the header or the room under the list. `project` is the repo's top
// folder, else the panel's own; `repo` only the former. `vault` and `projectVault` are the ids of
// the Obsidian vaults they are in, or null.
// ↑/↓ move, Enter runs, Esc closes. Drawn like Herdr's own menu.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import * as ops from "./ops.js";

const MOD = "files-actions";
const ROW = 31;
const ICON = {
  open: `mods/${MOD}/open.svg`, trash: `mods/${MOD}/trash.svg`, copy: `mods/${MOD}/copy.svg`, paste: `mods/${MOD}/clipboard.svg`,
  rename: "mods/workspace-chrome/square-pen.svg", duplicate: "mods/workspace-chrome/layers.svg", reveal: "mods/workspace-chrome/folder.svg",
};

// Rows: { label, icon, act, rule? (a line above) } and { section, rule? } (a heading, not a choice).
function rows(m) {
  const out = [];
  const openIn = (app, target) => ({ label: `Open in ${ops.appName(app)}`, icon: "open", act: () => ops.request({ op: "open", app, repo: m.repo, ...target }) });
  const reveal = (target) => ({ label: "Reveal in Finder", icon: "reveal", act: () => ops.request({ op: "open", app: "finder", ...target }) });
  // `to`: the folder, under root, that takes what is on the clipboard ("": root itself).
  const paste = (to, rule) => ({ label: `Paste in “${ops.base(to || m.root)}”`, icon: "paste", rule, act: () => ops.request({ op: "paste", root: m.root, on: m.on, to }) });
  const apps = ops.canOpen(m.on), share = ops.canShare(m.on);
  if (m.path) {
    const name = ops.base(m.path), abs = `${m.root}/${m.path}`;
    const target = { path: abs, dir: m.dir, vault: m.vault };
    out.push({ section: name });
    if (apps) {
      out.push(openIn("vscode", target));
      if (m.vault || (!m.dir && ops.isNote(name))) out.push(openIn("obsidian", target));
      if (!m.dir) out.push(openIn("textedit", target));
      out.push(reveal(target));
    }
    out.push({ label: "Rename…", icon: "rename", rule: apps, act: () => openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 214, props: { naming: { root: m.root, on: m.on, path: m.path } } }) });
    out.push({ label: "Duplicate", icon: "duplicate", act: () => ops.request({ op: "copy", root: m.root, on: m.on, from: m.path, dir: m.dir }) });
    if (share) {
      out.push({ label: "Copy", icon: "copy", rule: true, act: () => ops.request({ op: "clip", root: m.root, on: m.on, from: m.path }) });
      // Into the folder clicked, or next to the file clicked.
      out.push(paste(m.dir ? m.path : ops.parent(m.path)));
    }
    if (ops.canTrash(m.on)) out.push({
      label: "Move to Trash…", icon: "trash", rule: true,
      act: () => openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 176, props: { confirm: {
        title: `Move “${name}” to the Trash?`,
        detail: m.dir ? "The folder and everything in it go to the Trash. You can put them back from there." : "You can put it back from the Trash.",
        button: "Move to Trash",
        request: { op: "trash", root: m.root, on: m.on, from: m.path },
      } } }),
    });
  }
  if (apps && m.project) {
    const target = { path: m.project, dir: true, vault: m.projectVault };
    out.push({ section: `Project · ${ops.base(m.project)}`, rule: Boolean(m.path) });
    out.push(openIn("vscode", target));
    if (m.projectVault) out.push(openIn("obsidian", target));
    out.push(reveal(target));
  }
  // Nothing clicked (the header, the room under the list): the folder shown takes the paste.
  if (share && !m.path && m.root) out.push(paste("", true));
  return out;
}

// Whether there is anything to offer: a menu of nothing isn't opened.
export const any = (m) => rows(m).some((r) => r.act);

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
    const choose = (r) => {
      closeOverlay(p.overlay);
      r.act();
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
        else if (e.key === "enter") { if (choices[this.at]) choose(choices[this.at]); }
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
              .on_click(() => choose(r))
              .child(svg(ICON[r.icon]).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().min_w(0).truncate().child(r.label)))));
  }
}
