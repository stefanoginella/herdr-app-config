// The menu that offers it is a short-lived copy of this mod: it is gone before a program it
// started could answer. So it leaves a request in shared state, and the sidebar, which stays,
// takes it, runs it and reports what went wrong. A request: { app, path, dir, on }.

import { shared, setShared } from "herdr";

const KEY = "spaces-sidebar.open";
// A request older than this was left by a window that closed before taking it.
const FRESH = 10000;

export function request(r) {
  setShared(KEY, { ...r, at: Date.now() });
}

export const waiting = () => Boolean(shared(KEY));

// The waiting request, taken: nobody else gets it.
export function take() {
  const r = shared(KEY);
  if (!r) return null;
  setShared(KEY, null);
  return Date.now() - (r.at ?? 0) < FRESH ? r : null;
}
