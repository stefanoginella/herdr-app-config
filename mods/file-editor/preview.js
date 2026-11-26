// Preview files are staged under data/, where GPUI's image loader can read them.
// Each version gets a new path so GPUI cannot reuse a texture from an earlier render.
import { appHome, exec, home, window as app } from "herdr";
import { mkdir, writeFile } from "fs/promises";

const MAX_BYTES = 50 * 1024 * 1024;
const RASTER = /\.(png|jpe?g|gif|webp|bmp|ico|icns|tiff?|hei[cf]|avif)$/i;
const STAT = `if [ ! -f "$1" ]; then exit 2; fi
if [ "$(uname)" = Darwin ]; then
  stat -L -f '%z %d %i %.9Fm %.9Fc' "$1"
else
  stat -Lc '%s %d %i %y %z' -- "$1"
fi`;

export function format(path) {
  if (RASTER.test(path)) return "image";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.svg$/i.test(path)) return "svg";
  if (/\.html?$/i.test(path)) return "html";
  if (/\.csv$/i.test(path)) return "csv";
  if (/\.(md|markdown|mdx)$/i.test(path)) return "markdown";
  return null;
}

export const binary = kind => kind === "image" || kind === "pdf";

async function checked(command, args, options) {
  const result = await exec(command, args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n")[0] || `${command} failed`);
  return result.stdout.trim();
}

export async function stamp(path, on) {
  const r = !on && app()?.platform === "windows"
    ? await exec("powershell.exe", ["-NoProfile", "-Command",
      `$f = Get-Item -LiteralPath '${path.replace(/['‘’‚‛]/g, "$&$&")}' -ErrorAction Stop; if (!$f.PSIsContainer) { Write-Output "$($f.Length) $($f.LastWriteTimeUtc.Ticks)" }`], { timeout: 5000 })
    : await exec("sh", ["-c", STAT, "preview-stat", path], { on, timeout: 5000 });
  if (r.code === 2) return null;
  const key = r.stdout.trim(), size = Number(key.split(" ")[0]);
  if (r.code !== 0 || !key || !Number.isSafeInteger(size) || size < 0) throw new Error("Could not read file information");
  return { key, size };
}

function cacheRoot() { return `${appHome()}/data/file-editor-preview`; }

async function directory() {
  const root = cacheRoot();
  await mkdir(root, { recursive: true });
  return checked("mktemp", ["-d", `${root}/preview.XXXXXXXX`], { timeout: 3000 });
}

export async function discard(dir) {
  if (dir) await exec("rm", ["-rf", "--", dir], { timeout: 3000 }).catch(() => {});
}

export async function removePage(file) {
  if (file) await exec("rm", ["-f", "--", file], { timeout: 3000 }).catch(() => {});
}

let pruned = false;
export function prune() {
  if (pruned) return;
  pruned = true;
  exec("find", [cacheRoot(), "-mindepth", "1", "-maxdepth", "1", "-type", "d",
    "-name", "preview.*", "-mtime", "+1", "-exec", "rm", "-rf", "--", "{}", "+"], { timeout: 3000 }).catch(() => {});
}

// The core caps stdout at 8 MiB. Redirect bounded chunks straight into the local file,
// keeping binary bytes out of Herdr's text API.
async function stage(path, on, info, destination) {
  if (info.size > MAX_BYTES) throw new Error("This file exceeds the 50 MiB preview limit");
  const script = `set -e
if [ -z "$1" ]; then
  exec head -c "$4" "$2" > "$3"
fi
: > "$3"
blocks=$((($4 + 1048575) / 1048576))
offset=0
while [ "$offset" -lt "$blocks" ]; do
  hc exec --on "$1" --timeout 25 -- dd "if=$2" bs=1048576 "skip=$offset" count=4 >> "$3"
  offset=$((offset + 4))
done`;
  await checked("sh", ["-c", script, "preview-copy", on ?? "", path, destination, String(info.size + 1)], { timeout: on ? 30000 : 10000 });
  if ((await stamp(destination, null))?.size !== info.size || (await stamp(path, on))?.key !== info.key) {
    throw new Error("The file changed while copying. Try again.");
  }
}

function asset(path) { return path.slice(appHome().length + 1); }

export async function readMedia(path, on, kind, info, previous, page) {
  if (!info) throw new Error("This file is no longer there");
  if (previous?.key === info.key && previous.kind === kind) {
    if (kind === "pdf" && previous.page !== page) return pdfPage(previous, page);
    return previous;
  }
  const dir = await directory();
  try {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const source = `${dir}/file.${extension}`;
    await stage(path, on, info, source);
    if (kind === "pdf") {
      const output = await checked("pdfinfo", [source]).catch(() => {
        throw new Error("Could not read this PDF. Local PDF previews use Poppler (pdfinfo and pdftoppm).");
      });
      const pages = Number(/^Pages:\s+(\d+)/m.exec(output)?.[1]);
      if (!pages) throw new Error("This PDF has no pages");
      return await pdfPage({ dir, source, key: info.key, pages, kind }, page);
    }
    const image = await raster(source, dir);
    return { ...image, dir, key: info.key, kind };
  } catch (error) {
    await discard(dir);
    throw error;
  }
}

async function pdfPage(media, requested) {
  const page = Math.max(1, Math.min(media.pages, requested));
  if (media.page === page) return media;
  // Unique output even when returning to a page whose cached file was removed.
  const prefix = `${media.dir}/page-${page}-${Date.now()}`;
  await checked("pdftoppm", ["-f", String(page), "-l", String(page), "-scale-to", "1800",
    "-singlefile", "-png", media.source, prefix]);
  const file = `${prefix}.png`;
  return { ...media, page, file, asset: asset(file), ...await pngSize(file) };
}

async function pngSize(file) {
  const header = await checked("od", ["-An", "-tu1", "-N24", file], { timeout: 3000 });
  const bytes = header.split(/\s+/).map(Number);
  const size = at => bytes.slice(at, at + 4).reduce((value, byte) => 256 * value + byte, 0);
  const width = size(16), height = size(20);
  if (bytes.length !== 24 || bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10" ||
      bytes.slice(12, 16).join(",") !== "73,72,68,82" || !width || !height) {
    throw new Error("The preview renderer did not produce a usable PNG");
  }
  return { width, height };
}

async function raster(source, dir) {
  // Header-only probes can succeed for broken images. Decode to a bounded PNG before
  // giving anything to GPUI, whose image element has no load/error callback.
  const file = `${dir}/image.png`, first = `${source}[0]`;
  if (app()?.platform === "macos") {
    try {
      const output = await checked("sips", ["-g", "pixelWidth", "-g", "pixelHeight", source], { timeout: 4000 });
      const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
      const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
      if (width && height) {
        await checked("sips", ["-s", "format", "png", "-Z", "2400", source, "--out", file], { timeout: 8000 });
        const { width: displayWidth, height: displayHeight } = await pngSize(file);
        return { file, asset: asset(file), width, height, displayWidth, displayHeight };
      }
    } catch { /* use ImageMagick for formats this macOS version cannot decode */ }
  }
  try {
    const output = await checked("magick", ["identify", "-ping", "-format", "%w %h", first], { timeout: 4000 });
    const [width, height] = output.split(/\s+/).map(Number);
    if (!width || !height) throw new Error("Missing image dimensions");
    await checked("magick", [first, "-resize", "2400x2400>", file], { timeout: 8000 });
    const { width: displayWidth, height: displayHeight } = await pngSize(file);
    return { file, asset: asset(file), width, height, displayWidth, displayHeight };
  } catch {
    throw new Error("This image could not be decoded");
  }
}

export function svgDimensions(text) {
  const root = /<svg\b([^>]*?)>/i.exec(text)?.[1];
  if (!root) return null;
  const length = name => {
    const value = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([^"']+)\\1`, "i").exec(root)?.[2];
    return /^\d*\.?\d+(?:px)?$/i.test(value ?? "") ? Number.parseFloat(value) : null;
  };
  const width = length("width"), height = length("height");
  if (width && height) return { width, height };
  const box = /(?:^|\s)viewBox\s*=\s*(["'])([^"']+)\1/i.exec(root)?.[2].trim().split(/[\s,]+/).map(Number);
  return box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
    ? { width: box[2], height: box[3], viewBox: true } : null;
}

function htmlHelper() { return `${appHome()}/mods/file-editor/html-preview.py`; }

function python(args, timeout) {
  return checked("python3", [htmlHelper(), ...args], { timeout });
}

export async function readTextPreview(kind, path, on, text) {
  const dir = await directory();
  try {
    if (kind === "svg") {
      const file = `${dir}/image.svg`;
      await writeFile(file, text);
      return { dir, asset: asset(file), ...svgDimensions(text) };
    }
    const input = `${dir}/source.html`, output = `${dir}/page.png`;
    await writeFile(input, text);
    const dimensions = await python(["snapshot", path, on ?? "", input, dir, home()], 35000);
    return { dir, asset: asset(output), ...JSON.parse(dimensions) };
  } catch (error) {
    await discard(dir);
    throw error;
  }
}

export async function openBrowser(path, on) {
  return python(["browser", path, on ?? ""], 12000);
}

export function textInfo(text) {
  const endings = text.match(/\r\n|\n|\r/g) ?? [];
  const kinds = new Set(endings);
  const eol = kinds.size > 1 ? "Mixed line endings" : ({ "\r\n": "CRLF", "\n": "LF", "\r": "CR" })[endings[0]];
  const pairs = text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0;
  return { lines: endings.length + 1, chars: text.length - pairs, eol };
}

export function fileSize(size) {
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = size / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${Number(value.toFixed(value < 10 ? 1 : 0))} ${units[unit]}`;
}

// Keep rendering bounded. Count the whole input and retain one page's worth of cells.
// Quoted newlines, escaped quotes, BOM, and empty trailing fields are all CSV data.
export const CSV_ROWS = 50, CSV_COLS = 24;

function delimiter(text) {
  let quoted = false;
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "\n" || ch === "\r") break;
    if (counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function csv(text, page, columnPage = 0) {
  const rows = [];
  const start = page * CSV_ROWS, firstColumn = columnPage * CSV_COLS;
  const bom = text.charCodeAt(0) === 0xFEFF ? 1 : 0, separator = delimiter(text.slice(bom));
  let cells = [], rowCount = 0, columns = 0, col = 0, from = bom;
  let quoted = false, clipped = false, open = false;
  const visible = () => rowCount >= start && rowCount < start + CSV_ROWS;
  const endCell = end => {
    if (visible() && col >= firstColumn && col < firstColumn + CSV_COLS) {
      // At most twice the display length is needed even if every quote was escaped.
      const sample = csvValue(text.slice(from, Math.min(end, from + 1004)));
      if (sample.length > 500) clipped = true;
      cells.push({ start: from, end, display: sample.slice(0, 500).replace(/[\uD800-\uDBFF]$/, "") });
    }
    col++;
  };
  const endRow = end => {
    endCell(end);
    if (visible()) rows.push({ cells, end, columns: col });
    columns = Math.max(columns, col);
    rowCount++; col = 0; cells = []; open = false;
  };
  for (let i = bom; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else quoted = false;
      }
    } else if (ch === '"' && i === from) {
      quoted = true; open = true;
    } else if (ch === separator) {
      endCell(i); from = i + 1; open = true;
    } else if (ch === "\n" || ch === "\r") {
      endRow(i);
      if (ch === "\r" && text[i + 1] === "\n") i++;
      from = i + 1;
    } else open = true;
  }
  if (open) endRow(text.length);
  return { rows, rowCount, columns, clipped, unclosed: quoted, separator };
}

export function csvValue(raw) {
  if (!raw.startsWith('"')) return raw;
  // Strip only the opening quote and the first unescaped closing quote.
  // This also shows an unclosed or nonstandard field without hiding its content.
  let closed = false;
  return raw.slice(1).replace(/""|"/g, match => {
    if (closed) return match;
    if (match === '""') return '"';
    closed = true;
    return "";
  });
}

// A preview edit is a single source replacement. Do not reserialize other fields, line endings
// or the BOM. Missing cells in a short row are added only as far as the edited column.
export function csvEdit(text, row, cell, column, separator, value) {
  const raw = cell ? text.slice(cell.start, cell.end) : "";
  if (value === csvValue(raw)) return null;
  const quoted = !value || raw.startsWith('"') || /[,;\t"\r\n]/.test(value);
  const insert = (cell ? "" : separator.repeat(column + 1 - row.columns))
    + (quoted ? '"' + value.replace(/"/g, '""') + '"' : value);
  return { range: { start: cell?.start ?? row.end, end: cell?.end ?? row.end }, insert };
}
