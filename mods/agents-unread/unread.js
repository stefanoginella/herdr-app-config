// Idle agents marked unread, kept in shared "agents.unread":
//
//   { address: { left } }   left: another pane has had the focus since the mark
//
// The list draws a marked idle agent as done. Herdr's own status doesn't change, so the
// tab bar and the spaces sidebar still show it idle. The list drops a mark once it has
// served (settle() in main.js); the row's dot, its menu and the key command set and clear it.

import { shared, setShared, agents } from "herdr";

export const KEY = "agents.unread";

export function marks() {
  const m = shared(KEY);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
}

export const marked = (address) => Boolean(marks()[address]);

// Only an idle agent: a working one will say so itself when it ends.
export function mark(address) {
  const a = agents().find((a) => a.address === address);
  if (a?.status !== "idle" || marked(address)) return;
  setShared(KEY, { ...marks(), [address]: { left: false } });
}

export function unmark(address) {
  if (!marked(address)) return;
  const m = { ...marks() };
  delete m[address];
  setShared(KEY, m);
}

export const toggle = (address) => (marked(address) ? unmark(address) : mark(address));
