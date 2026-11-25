// The panel's right-click menu, opened as a popup with props { menu: { root, on, branch, head,
// remotes, hub, kind, … } }. `branch` is the one HEAD is on (null: detached) and `head` its
// commit, as the panel showed them; `remotes` the remotes' names; `hub` the repository's
// address on GitHub, or null. `kind` says what was clicked, and what else is there:
//   "commit": { sha, subject, run? }            run: its workflow run on GitHub
//   "branch": { name, sha, upstream, remote, remoteBranch, ahead, behind, gone, pr? }
//   "remote": { name ("origin/x"), sha, remote, short, local }   local: a local branch has that name
//   "tag":    { name, sha, release? }
//   "stash":  { ref, sha, subject }
//   "file":   { path, mark, staged, work, both }   work: an uncommitted one (else a commit's);
//                                               both: it has staged changes and others
//   "work":   { staged, unstaged }              the counts
//   "repo":   {}                                the header
//   "repos":  { repos: [{ root, kind }], base, states }  the repositories to choose from; kind
//                                               is "around", "here" or "inside" (of `base`);
//                                               states: { root: how it stands } (main.js `stands`)
//   "writer": { writers: [{ id, label }], writer }   who writes commit messages
// ↑/↓ move, Enter runs, Esc closes. Drawn like Herdr's own menu.
//
// Nothing is run here (ops.js): a choice leaves a request for the panel, or opens a dialog
// that will.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import * as ops from "./ops.js";

const MOD = "git-graph";
const ROW = 31;
const ICON = {
  copy: `mods/${MOD}/copy.svg`, open: `mods/${MOD}/open.svg`, trash: `mods/${MOD}/trash.svg`, fetch: `mods/${MOD}/fetch.svg`,
  up: `mods/${MOD}/up.svg`, down: `mods/${MOD}/down.svg`, tag: `mods/${MOD}/tag.svg`, stash: `mods/${MOD}/stash.svg`,
  discard: `mods/${MOD}/discard.svg`, edit: `mods/${MOD}/edit.svg`, branch: "mods/workspace-chrome/git-branch.svg",
  graph: `mods/${MOD}/graph.svg`, write: `mods/${MOD}/write.svg`, folder: "mods/workspace-chrome/folder.svg", none: null, plus: "mods/workspace-chrome/plus.svg", minus: "mods/workspace-chrome/minus.svg", check: "mods/workspace-chrome/check.svg",
};
const short = (sha) => sha.slice(0, 7);

// How a repository of the "repos" list stands: its branch, a dot and the number of files
// changed, and how far it is ahead of its upstream and behind it.
const stands = (t, s) => h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.dim)
  .when(Boolean(s.branch), (e) => e.child(div().max_w(110).truncate().child(s.branch)))
  .when(Boolean(s.changes), (e) => e.child(h_flex().gap(3).items_center().text_color(t.blocked).child(div().w(6).h(6).rounded(3).bg(t.blocked)).child(String(s.changes))))
  .when(Boolean(s.ahead), (e) => e.child(div().child(`↑${s.ahead}`)))
  .when(Boolean(s.behind), (e) => e.child(div().child(`↓${s.behind}`)));

// Rows: { label, icon, act, state?, rule? (a line above) } and { section, rule? } (a heading, not a choice).
function rows(m) {
  const out = [];
  const at = { root: m.root, on: m.on };
  const ask = (r) => () => ops.request({ ...at, ...r });
  const copy = (label, text, rule) => ({ label, icon: "copy", rule, act: ask({ op: "copy", text }) });
  const web = (label, url, rule) => ({ label, icon: "open", rule, act: ask({ op: "url", url }) });
  const naming = (n) => () => openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 214, props: { naming: { ...at, ...n } } });
  const confirm = (c) => () => openOverlay({ mod: MOD, kind: "dialog", width: 440, height: 188, props: { confirm: c } });
  const origin = m.remotes?.includes("origin") ? "origin" : m.remotes?.[0] ?? null;
  const here = { branch: m.branch ?? null };
  const inGraph = (rule) => ({ label: "Show in Graph", icon: "graph", rule, act: ask({ op: "show", sha: m.sha }) });

  if (m.kind === "commit") {
    out.push({ section: `${short(m.sha)}  ${m.subject ?? ""}` });
    out.push(copy("Copy Commit ID", m.sha), copy("Copy Subject", m.subject ?? ""));
    // At the commit HEAD is on, a new branch can be switched to without touching a file.
    out.push({ label: "New Branch Here…", icon: "branch", rule: true, act: naming({ what: "branch", at: m.sha, go: m.sha === m.head }) });
    out.push({ label: "New Tag Here…", icon: "tag", act: naming({ what: "tag", at: m.sha }) });
    if (m.hub) out.push(web("Open Commit on GitHub", `${m.hub}/commit/${m.sha}`, true));
    if (m.run) out.push(web(`Open Workflow Run (${m.run.name})`, m.run.url, !m.hub));
  } else if (m.kind === "branch") {
    const current = m.name === m.branch, tip = [[`refs/heads/${m.name}`, m.sha]];
    out.push({ section: m.name });
    if (!current) out.push({ label: "Switch to Branch", icon: "check", act: ask({ op: "switch", branch: m.name, expect: { refs: tip } }) });
    if (m.upstream && !m.gone) {
      if (current) out.push({ label: `Pull from ${m.upstream}`, icon: "down", act: ask({ op: "pull", expect: here }) });
      else if (m.behind > 0 && m.ahead === 0 && m.remote && m.remoteBranch) {
        out.push({ label: `Fast-forward to ${m.upstream}`, icon: "down", act: ask({ op: "forward", branch: m.name, remote: m.remote, remoteBranch: m.remoteBranch, expect: { refs: tip } }) });
      }
    }
    if (m.upstream && !m.gone && m.remote && m.remoteBranch) {
      out.push({ label: `Push to ${m.upstream}`, icon: "up", act: ask({ op: "push", branch: m.name, remote: m.remote, remoteBranch: m.remoteBranch, track: false, expect: { refs: tip } }) });
    } else if (!m.upstream && origin) {
      out.push({ label: `Push to ${origin} and Track`, icon: "up", act: ask({ op: "push", branch: m.name, remote: origin, track: true, expect: { refs: tip } }) });
    }
    out.push(inGraph(true));
    out.push({ label: "New Branch from Here…", icon: "branch", act: naming({ what: "branch", at: m.sha, go: current }) });
    out.push(copy("Copy Name", m.name));
    if (m.pr) out.push(web(`Open Pull Request #${m.pr.number}`, m.pr.url, true));
    if (!current) out.push({
      label: "Delete Branch…", icon: "trash", rule: true,
      act: confirm({
        title: `Delete the branch “${m.name}”?`,
        detail: "Only a branch whose commits are in another one is deleted: git refuses otherwise. Nothing on a remote is touched.",
        button: "Delete Branch",
        request: { ...at, op: "branch-delete", name: m.name, expect: { refs: tip } },
      }),
    });
  } else if (m.kind === "remote") {
    out.push({ section: m.name });
    out.push(m.local
      ? { label: `Switch to “${m.short}”`, icon: "check", act: ask({ op: "switch", branch: m.short }) }
      : { label: `Switch to It as “${m.short}”`, icon: "check", act: ask({ op: "track", name: m.name }) });
    out.push(inGraph(true));
    out.push(copy("Copy Name", m.name));
    if (m.hub && m.remote === "origin") out.push(web("Open Branch on GitHub", `${m.hub}/tree/${m.short.split("/").map(encodeURIComponent).join("/")}`, true));
  } else if (m.kind === "tag") {
    out.push({ section: m.name });
    out.push(inGraph());
    out.push(copy("Copy Name", m.name));
    out.push({ label: "New Branch Here…", icon: "branch", act: naming({ what: "branch", at: m.sha, go: m.sha === m.head }) });
    if (origin) out.push({ label: `Push Tag to ${origin}`, icon: "up", act: ask({ op: "tag-push", name: m.name, remote: origin }) });
    if (m.hub && m.release) out.push(web("Open Release on GitHub", `${m.hub}/releases/tag/${encodeURIComponent(m.name)}`, true));
    out.push({
      label: "Delete Tag…", icon: "trash", rule: true,
      act: confirm({
        title: `Delete the tag “${m.name}”?`,
        detail: "It is deleted here only: a tag already pushed stays on the remote.",
        button: "Delete Tag",
        request: { ...at, op: "tag-delete", name: m.name, expect: { refs: [[`refs/tags/${m.name}^{commit}`, m.sha]] } },
      }),
    });
  } else if (m.kind === "stash") {
    const same = { refs: [[m.ref, m.sha]] };
    out.push({ section: m.subject || m.ref });
    out.push({ label: "Apply", icon: "down", act: ask({ op: "stash-apply", ref: m.ref, expect: same }) });
    out.push({ label: "Apply and Drop", icon: "down", act: ask({ op: "stash-pop", ref: m.ref, expect: same }) });
    out.push({
      label: "Drop Stash…", icon: "trash", rule: true,
      act: confirm({
        title: "Drop this stash?",
        detail: `“${m.subject || m.ref}” is deleted without being applied. This can't be undone from here.`,
        button: "Drop Stash",
        request: { ...at, op: "stash-drop", ref: m.ref, expect: same },
      }),
    });
  } else if (m.kind === "file") {
    const name = m.path.slice(m.path.lastIndexOf("/") + 1);
    out.push({ section: name });
    if (m.work) {
      out.push(m.staged
        ? { label: "Unstage", icon: "minus", act: ask({ op: "unstage", paths: [m.path], expect: here }) }
        : { label: "Stage", icon: "plus", act: ask({ op: "stage", paths: [m.path], expect: here }) });
    }
    if (m.mark !== "D") out.push({ label: "Open in Editor", icon: "edit", act: ask({ op: "edit", path: m.path }) });
    out.push(copy("Copy Path", m.path));
    if (m.work && !m.staged && m.mark !== "!") out.push({
      label: "Discard Changes…", icon: "discard", rule: true,
      act: confirm({
        title: m.mark === "U" ? `Remove “${name}”?` : `Discard the changes to “${name}”?`,
        detail: m.both
          ? "It also has staged changes: those go too, and the file is as the last commit has it. All of it is kept as a stash, to bring back from the Stashes list."
          : "They are kept as a stash, so they can be brought back from the Stashes list.",
        button: m.mark === "U" ? "Remove" : "Discard",
        request: { ...at, op: "discard", path: m.path, expect: here },
      }),
    });
  } else if (m.kind === "work") {
    out.push({ section: "Uncommitted changes" });
    if (m.unstaged) out.push({ label: "Stage All", icon: "plus", act: ask({ op: "stage", expect: here }) });
    if (m.staged) out.push({ label: "Unstage All", icon: "minus", act: ask({ op: "unstage", expect: here }) });
    out.push({ label: "Stash All", icon: "stash", rule: true, act: ask({ op: "stash", expect: here }) });
  } else if (m.kind === "repos") {
    const name = (dir) => dir.slice(dir.lastIndexOf("/") + 1);
    const row = (r, label) => ({ label, icon: r.root === m.root ? "check" : "folder", state: m.states?.[r.root], act: ask({ op: "repo", to: r.root }) });
    const outside = m.repos.filter((r) => r.kind === "around"), here = m.repos.filter((r) => r.kind === "here"), inside = m.repos.filter((r) => r.kind === "inside");
    if (outside.length) out.push({ section: "Around this one" }, ...outside.map((r) => row(r, name(r.root))));
    if (here.length) out.push({ section: "The pane's own", rule: out.length > 0 }, ...here.map((r) => row(r, name(r.root))));
    // Under the folder: by their path from it, which tells two of the same name apart.
    if (inside.length) out.push({ section: `Inside ${name(m.base ?? "")}`, rule: out.length > 0 }, ...inside.map((r) => row(r, r.root.startsWith(`${m.base}/`) ? r.root.slice(m.base.length + 1) : r.root)));
  } else if (m.kind === "writer") {
    out.push({ section: "Commit messages are written by" });
    for (const w of m.writers ?? []) out.push({ label: w.label, icon: w.id === m.writer ? "check" : "none", act: ask({ op: "writer", id: w.id }) });
  } else if (m.kind === "repo") {
    out.push({ section: m.name ?? "Repository" });
    out.push({ label: "Fetch", icon: "fetch", act: ask({ op: "fetch" }) });
    if (m.head) out.push({ label: "New Branch…", icon: "branch", act: naming({ what: "branch", at: m.head, go: true }) });
    if (m.hub) out.push(web("Open on GitHub", m.hub, true));
  }
  return out;
}

// Whether there is anything to offer: a menu of nothing isn't opened.
export const any = (m) => rows(m).some((r) => r.act);
// How tall the popup is, so it is no taller than its rows. A long list (of repositories)
// scrolls inside the most it may be.
const TALLEST = 520;
const tall = (list) => list.reduce((h, r) => h + (r.rule ? 9 : 0) + (r.section ? 24 : ROW), 12);
export const height = (m) => Math.min(TALLEST, tall(rows(m)));

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
    // The popup is as tall as its rows, so nothing here may scroll by itself: a list too long
    // for it is given the height it may have, and scrolls in that.
    const long = tall(list) > TALLEST;
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .when(long, (el) => el.h(TALLEST).overflow_y_scroll())
      .when(!long, (el) => el.min_h(0))
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
              .child(ICON[r.icon] ? svg(ICON[r.icon]).size(14).flex_none().text_color(t.muted) : div().w(14).flex_none())
              .child(div().flex_1().min_w(0).truncate().child(r.label))
              .when(Boolean(r.state), (el) => el.child(stands(t, r.state))))));
  }
}
