// Saving a file on another machine. Herdr's writeTextFile writes on this computer only, so the
// text goes there as arguments of a shell script, run with `sh` through `exec(..., { on })`.
// Nothing is installed there: the script travels with every call.
//
// As with writeTextFile, a save is refused when the file is no longer what was read:
//   1. `look`: the file's checksum (`cksum`: POSIX, so everywhere) and its text, in one call.
//      The text must be the text the editor began from, or the save is stale.
//   2. The new text goes into a file next to it, in pieces: one argument can't hold more than
//      about 128 KB on Linux.
//   3. With the last piece, the file must still have that checksum. Then its content is
//      replaced by the new text and the file next to it is removed.
// The content is written into the file, not moved over it: the file keeps its mode, its owner
// and what links to it (a script stays executable, a symlink stays a link). Between the check
// and the write nothing holds the file, so a change landing in that instant is lost: an instant,
// where writeTextFile has none.
import { exec } from "herdr";

// $1: look | part | done   $2: the file   $3: the file next to it   $4: a piece of text
// $5: the checksum the file must still have, or "absent"   $6: 1 for the first piece
// 17: the file is not what was expected.
const SCRIPT = `
case "$1" in
look)
  if [ -e "$2" ] || [ -L "$2" ]; then cksum < "$2" && cat "$2"; else echo absent; fi ;;
part|done)
  if [ "$6" = 1 ]; then : > "$3" || exit 1; fi
  printf %s "$4" >> "$3" || { rm -f "$3"; exit 1; }
  [ "$1" = part ] && exit 0
  if [ "$5" = absent ]; then
    if [ -e "$2" ] || [ -L "$2" ]; then rm -f "$3"; exit 17; fi
  elif [ ! -f "$2" ] || [ "$(cksum < "$2")" != "$5" ]; then rm -f "$3"; exit 17
  fi
  cat "$3" > "$2"; code=$?
  rm -f "$3"
  exit $code ;;
drop)
  rm -f "$3" ;;
esac`;

// UTF-16 units a piece: at most three bytes each, so under the limit of one argument.
const PIECE = 30000;
const TIMEOUT = 60000;

const run = (on, ...args) => exec("sh", ["-c", SCRIPT, "sh", ...args], { on, timeout: TIMEOUT });

// The text in pieces, none ending between the two halves of one character.
export function pieces(text) {
  const out = [];
  for (let at = 0; at < text.length; ) {
    let end = Math.min(text.length, at + PIECE);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    out.push(text.slice(at, end));
    at = end;
  }
  return out.length ? out : [""];
}

// What a save found instead of the file it expected.
export class Stale extends Error {
  constructor() { super("The file changed on the other machine while it was being saved"); }
}

// Writes `text` to `path` on the machine `on`, if the file there is still `expected` (its
// text; null: there must be no file). Throws Stale when it is not, an Error when it can't.
export async function write(path, on, text, expected) {
  const seen = await run(on, "look", path);
  if (seen.code !== 0) throw new Error(seen.stderr.trim() || "The file can't be read");
  const br = seen.stdout.indexOf("\n");
  const sum = (br < 0 ? seen.stdout : seen.stdout.slice(0, br)).trim();
  if (sum === "absent" ? expected !== null : expected === null || seen.stdout.slice(br + 1) !== expected) throw new Stale();
  const slash = path.lastIndexOf("/");
  const beside = `${path.slice(0, slash + 1)}.${path.slice(slash + 1)}.herdr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const parts = pieces(text);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    let r;
    try { r = await run(on, last ? "done" : "part", path, beside, parts[i], sum, i === 0 ? "1" : "0"); }
    catch (e) { run(on, "drop", path, beside).catch(() => {}); throw e; }
    if (r.code === 17) throw new Stale();
    if (r.code !== 0) {
      if (!last) run(on, "drop", path, beside).catch(() => {});
      throw new Error(r.stderr.trim() || "The file can't be written");
    }
  }
}
