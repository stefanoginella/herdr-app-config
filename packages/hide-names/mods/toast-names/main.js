// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.
//
// A clone of Herdr's `toast` (version 0.1.18), chosen by the layout's root `"toast"`. Changes, each
// marked "names:": while shared `names.hidden` is on, the title and body are drawn with made-up
// names (names.js), and a machine's login command is drawn with a made-up machine while Copy copies
// the real one; and a tooltip holds a text too long for the card, since Herdr gives a toast mod
// not its own the fixed 340x72 card, where a body shows its first line only.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, spaces, machines, panes, terminals, agents, home } from "herdr";
// names: made-up names while shared `names.hidden` is on.
import * as alias from "./alias.js";
import * as names from "./names.js";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class Toast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    // names: what is drawn; the action and the copied command stay real.
    const hidden = shared("names.hidden") === true;
    const say = hidden
      ? names.shown(p, { spaces: spaces(), machines: machines(), panes: panes(), terminals: terminals(), agents: agents(), home: home() })
      : { title: p.title ?? "", body: p.body ?? "" };
    const machine = login && hidden ? alias.machine(login[1]) : login?.[1];
    const drawn = login ? `hc machine login ${machine}` : null;
    // names: the card cuts a long text, so a hover shows all of it.
    const long = (s) => s.includes("\n") || s.length > 40;
    const cut = !p.fitHeight && !login && (long(say.title) || long(say.body));
    const text = (value) => p.fitHeight
      ? div().child(value)
      : div().truncate().child(typeof value === "string" ? value.split("\n", 1)[0] : value);
    return h_flex()
      .id("toast")
      .when(p.fitHeight, (el) => el.w_full().min_h(70).flex_none().py(12))
      .when(!p.fitHeight, (el) => el.size_full())
      .when(cut, (el) => el.tooltip([say.title, say.body].filter(Boolean).join("\n")))
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(text(login ? `${machine} needs a login: run` : say.title).font_semibold().text_size(13).text_color(t.foreground))
          .when(!login && Boolean(say.body), (el) => el.child(text(say.body).text_size(12).text_color(t.muted)))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(drawn).text_size(12).text_color(t.muted).child(drawn))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      );
  }
}
