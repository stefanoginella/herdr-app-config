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
  return checked("mktemp", ["-d", `${root}/preview.XXXXXXXX`]);
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
  head -c "$4" "$2" > "$3"
  exit
fi
: > "$3"
blocks=$((($4 + 1048575) / 1048576))
offset=0
while [ "$offset" -lt "$blocks" ]; do
  hc exec --on "$1" --timeout 25 -- dd "if=$2" bs=1048576 "skip=$offset" count=4 >> "$3"
  offset=$((offset + 4))
done`;
  await checked("sh", ["-c", script, "preview-copy", on ?? "", path, destination, String(info.size + 1)], { timeout: 30000 });
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
    const image = await raster(source, dir, extension);
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
  const header = await checked("od", ["-An", "-tu1", "-j16", "-N8", file]);
  const bytes = header.split(/\s+/).map(Number);
  const size = at => bytes.slice(at, at + 4).reduce((value, byte) => 256 * value + byte, 0);
  return { ...media, page, file, asset: asset(file), width: size(0), height: size(4) };
}

async function raster(source, dir, extension) {
  const mac = app()?.platform === "macos";
  let width, height, file = source;
  if (mac) {
    const output = await checked("sips", ["-g", "pixelWidth", "-g", "pixelHeight", source]).catch(() => "");
    width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
    height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
    if (!/^(png|jpe?g|gif|webp|bmp|ico)$/.test(extension) && width && height) {
      file = `${dir}/image.png`;
      await checked("sips", ["-s", "format", "png", "-Z", "2400", source, "--out", file]);
    }
  }
  if (!width || !height) {
    const output = await checked("magick", ["identify", "-ping", "-format", "%w %h", `${source}[0]`]).catch(() => "");
    [width, height] = output.split(" ").map(Number);
    if (!width || !height) throw new Error("This image could not be decoded");
    if (!/^(png|jpe?g|gif|webp|bmp|ico)$/.test(extension)) {
      file = `${dir}/image.png`;
      await checked("magick", [`${source}[0]`, "-resize", "2400x2400>", file]);
    }
  }
  if (width * height > 24000000 && file === source) {
    file = `${dir}/image.webp`;
    if (mac) {
      file = `${dir}/image.png`;
      await checked("sips", ["-s", "format", "png", "-Z", "2400", source, "--out", file]);
    } else await checked("magick", [`${source}[0]`, "-resize", "2400x2400>", file]);
  }
  return { asset: asset(file), width, height };
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
  const sample = text.replace(/^\uFEFF/, ""), separator = delimiter(sample);
  let row = [], cell = "", rowCount = 0, columns = 0, col = 0;
  let quoted = false, clipped = false, open = false, cellStart = true;
  const shown = () => rowCount >= start && rowCount < start + CSV_ROWS && col >= firstColumn && col < firstColumn + CSV_COLS;
  const append = ch => {
    if (shown()) {
      if (cell.length < 500) cell += ch;
      else clipped = true;
    }
    cellStart = false;
  };
  const endCell = () => { if (shown()) row.push(cell); cell = ""; col++; cellStart = true; };
  const endRow = () => {
    endCell();
    if (rowCount >= start && rowCount < start + CSV_ROWS) rows.push(row);
    columns = Math.max(columns, col);
    rowCount++; col = 0; row = []; open = false;
  };
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (quoted) {
      if (ch !== '"') append(ch);
      else if (sample[i + 1] === '"') { append(ch); i++; }
      else quoted = false;
    } else if (ch === '"' && cellStart) {
      quoted = true; open = true; cellStart = false;
    } else if (ch === separator) { endCell(); open = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && sample[i + 1] === "\n") i++;
      endRow();
    } else { append(ch); open = true; }
  }
  if (open) endRow();
  return { rows, rowCount, columns, clipped, unclosed: quoted };
}
