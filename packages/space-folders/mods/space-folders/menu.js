// The sidebar's right-click menus, opened as a popup with props { menu, target, keys }:
//   "space":  Herdr's own space items, opening its project in an editor, starting and stopping its
//             containers, and moving it between folders. target { id, git, nested, kids,
//             open: { path, dir, on } | null, stacks: [stack + { acting }], on, local }
//   "folder": new space here, rename, remove. target { id }
//   "root":   new folder, new space, on target { machine? } (else the shown space's machine).
// Folders are per machine: a space moves only among its own machine's folders.
// ↑/↓ move, Enter runs, Esc closes. Drawn like Herdr's own menu.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, spaces } from "herdr";
import * as model from "./model.js";
import * as opening from "./open.js";
import * as external from "./external-apps.js";
import * as stacks from "./stacks.js";
import * as names from "./names.js";

const MOD = "space-folders";
// Herdr's icons, and this mod's one own.
const OWN = new Set(["open", "play", "stop", "globe"]);
const icon = (name) => (OWN.has(name) ? `mods/${MOD}/${name}.svg` : `mods/workspace-chrome/${name}.svg`);
const ROW = 31;
// More folders than this to move to, and their list scrolls.
const MANY = 7;

export function naming(p) {
  openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 196, props: { naming: p } });
}

// The key bound to a command, for the hint on the right.
function shortcut(name) {
  return keys().find((b) => b.section === "global" && b.action === name)?.keys ?? "";
}

function change(fn) {
  const m = model.load();
  fn(m);
  model.save(m);
}

// Rows: { label, icon, act, hint?, rule? (a line above), many? (one of a list that may be long) }
// and { section } (a heading, not a choice).
function rows(p, apps) {
  const tg = p.target ?? {};
  const m = model.load();
  const worktree = (action, size) => () => openOverlay({ mod: "worktree", kind: "dialog", ...size, props: { space: tg.id, action } });
  const small = { width: 440, height: 260 };
  // Hide names: what the rows say; their acts use the real ones.
  const fake = names.hidden() ? names.folderNames(model.folders(m)) : null;
  if (p.menu === "space") {
    const at = model.folderOf(m, tg.id);
    const opts = { kids: tg.kids ?? [], keys: p.keys ?? {} };
    const move = (dest) => () => change((m) => model.file(m, tg.id, dest, opts));
    const actions = tg.open ? external.choices(apps, tg.open, { reveal: false }) : [];
    return [
      { label: "Rename", icon: "square-pen", hint: shortcut("space.rename"), act: () => run("space.rename", { id: tg.id }) },
      ...(tg.git ? [
        { label: "New worktree", icon: "git-branch", act: worktree("new", small) },
        { label: "Open worktree", icon: "git-branch", act: worktree("open", { width: 560, height: 480 }) },
      ] : []),
      ...(tg.git === "linked" ? [{ label: "Remove worktree", icon: "git-branch", act: worktree("remove", small) }] : []),
      ...actions.map(({ id, label }, i) => ({
        label, icon: "open", rule: i === 0, act: () => opening.request({ app: id, ...tg.open }),
      })),
      // Its containers, one at a time. A running local DDEV site opens in the default browser.
      ...(tg.stacks ?? []).flatMap((s, i) => {
        const up = s.state !== "stopped";
        const name = names.stack(s);
        const act = (op) => () => stacks.request({ op, on: tg.on ?? null, stacks: [s], url: s.url });
        return [
          { label: `${up ? "Stop" : "Start"} ${name}`, icon: up ? "stop" : "play", rule: i === 0, hint: s.acting ?? "", act: s.acting ? () => {} : act(up ? "stop" : "start") },
          ...(up && s.url && tg.local ? [{ label: "Open site", icon: "globe", hint: names.hidden() ? "" : s.url.replace(/^https?:\/\//, ""), act: act("site") }] : []),
        ];
      }),
      // A worktree space drawn under its repo's goes where that one goes.
      ...(tg.nested ? [] : [
        { section: "Move to", rule: true },
        ...model.foldersOn(m, model.machineOf(tg.id)).filter((f) => f.id !== at?.id).map((f) => ({ label: fake?.get(f.id) ?? f.name, icon: "folder", many: true, act: move({ folder: f.id }) })),
        ...(at ? [{ label: "Out of folder", icon: "minus", act: move({ folder: null, after: at.id }) }] : []),
        { label: "New folder…", icon: "folder-plus", act: () => naming({ title: "New folder", around: tg.id, ...opts }) },
      ]),
      { label: "Close", icon: "x", rule: true, act: () => run("space.close", { id: tg.id }) },
    ];
  }
  if (p.menu === "folder") {
    const f = model.folder(m, tg.id);
    if (!f) return [];
    return [
      { label: "New space here", icon: "plus", act: () => { change((m) => model.expect(m, f.id, Date.now())); run("space.new", { machine: f.on ?? "" }); } },
      { label: "Rename", icon: "square-pen", act: () => naming({ title: "Rename folder", folder: f.id, value: f.name }) },
      { label: "Remove folder", icon: "x", rule: true, hint: f.spaces.length ? "spaces stay" : "", act: () => change((m) => model.removeFolder(m, f.id)) },
    ];
  }
  const on = tg.machine !== undefined ? tg.machine : spaces().find((s) => s.active)?.machine ?? null;
  return [
    { label: "New folder", icon: "folder-plus", hint: names.machine(on) ?? "", act: () => naming({ title: on ? `New folder on ${names.machine(on)}` : "New folder", on }) },
    { label: "New space", icon: "plus", hint: shortcut("space.new"), act: () => run("space.new", { machine: on ?? "" }) },
  ];
}

export default class Menu {
  init(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    if (p?.menu === "space" && p.target?.open && !p.target.on) cx.spawn(async (cx) => {
      this.apps = await external.load(p.target.on);
      this.at = 0;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const list = rows(p, this.apps);
    const choices = list.filter((r) => r.act);
    const choose = (r) => {
      closeOverlay(p.overlay);
      r.act();
    };
    const draw = (r, i) =>
      v_flex()
        .flex_none()
        .when(Boolean(r.rule), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(r.section
          ? div().px(8).pt(3).pb(4).text_size(11).text_color(t.dim).child(r.section)
          : h_flex()
            .id(`mi-${i}`)
            .h(ROW)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(choices[this.at] === r, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => choose(r))
            .child(svg(icon(r.icon)).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().min_w(0).truncate().child(r.label))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(r.hint ?? "")));
    // The popup is as tall as its rows, so nothing here may scroll by itself: a long list of
    // folders gets a fixed height and scrolls inside it.
    const first = list.findIndex((r) => r.many);
    const many = list.filter((r) => r.many);
    const parts = many.length <= MANY ? list.map(draw) : [
      ...list.slice(0, first).map(draw),
      v_flex().id("mi-folders").flex_none().h(MANY * ROW).overflow_y_scrollbar().children(many.map((r, j) => draw(r, first + j))),
      ...list.slice(first + many.length).map((r, j) => draw(r, first + many.length + j)),
    ];
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
      .children(parts);
  }
}
