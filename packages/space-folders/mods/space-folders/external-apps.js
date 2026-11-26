// Shared desktop actions. Keep the copies in Files, Search and Space Folders identical.
import { appHome, exec, home, notify, readTextFile, window } from "herdr";

const FILE = "external-apps.json";
const DEFAULT = "default", REVEAL = "reveal";
const labels = { macos: "Reveal in Finder", windows: "Show in File Explorer", linux: "Show in File Manager" };
const notes = [".md", ".markdown", ".canvas", ".base"];
const code = { command: "code", args: ["{repo}", "{path}"], at: ["{repo}", "--goto", "{path}:{line}:{column}"] };
const presets = {
  vscode: { id: "vscode", label: "VS Code", targets: ["file", "folder"], launch: {
    macos: [code, { bundle: "com.microsoft.VSCode", name: "Visual Studio Code", repo: true }], linux: [code], windows: [code],
  } },
  obsidian: { id: "obsidian", label: "Obsidian", targets: ["file", "folder"], launch: {
    macos: [{ bundle: "md.obsidian", name: "Obsidian" }], linux: [{ protocol: "obsidian" }], windows: [{ protocol: "obsidian" }],
  } },
  textedit: { id: "textedit", label: "TextEdit", targets: ["file"], launch: {
    macos: [{ bundle: "com.apple.TextEdit", name: "TextEdit" }],
  } },
};
const defaults = Object.values(presets);

const probeCache = new Map();
let configError = "";
const psQuote = (s) => `'${s.replace(/['‘’‚‛]/g, "$&$&")}'`;
const powershell = (script) => exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`]);
const succeeds = (promise) => promise.then((r) => r.code === 0, () => false);

async function probe(key, check) {
  const old = probeCache.get(key);
  if (old && Date.now() < old.until) return old.ok;
  const ok = await check();
  probeCache.set(key, { ok, until: Date.now() + 30000 });
  return ok;
}

function commandExists(command, platform) {
  return probe(`command:${command}`, () => platform === "windows"
    ? succeeds(powershell(`Get-Command -CommandType Application -Name ${psQuote(command)} | Out-Null`))
    : succeeds(exec("sh", ["-c", 'p=$(command -v -- "$1") && [ -f "$p" ] && [ -x "$p" ]', "external-apps", command])));
}

async function bundlePath(launcher) {
  const { bundle, name } = launcher;
  let path;
  const script = 'ObjC.import("AppKit"); function run(argv) { const u = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(argv[0]); return u.isNil() ? "" : ObjC.unwrap(u.path); }';
  const result = await exec("osascript", ["-l", "JavaScript", "-e", script, bundle], { timeout: 4000 }).catch(() => null);
  if (result?.code === 0) path = result.stdout.trim();
  if (path) return path;
  if (name) {
    for (const root of ["/Applications", "/System/Applications", `${home()}/Applications`]) {
      path = `${root}/${name}.app`;
      if (await succeeds(exec("test", ["-d", path]))) return path;
    }
  }
  return null;
}

async function usable(launcher, platform, desktop) {
  if (launcher.bundle) {
    const path = await probe(`bundle:${launcher.bundle}`, () => bundlePath(launcher));
    return path ? { ...launcher, path } : null;
  }
  if (launcher.protocol) {
    if (!desktop) return null;
    const ok = await probe("protocol:obsidian", async () => {
      if (platform === "windows") return succeeds(powershell("if (!(Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\\obsidian\\shell\\open\\command')) { exit 1 }"));
      const r = await exec("xdg-mime", ["query", "default", "x-scheme-handler/obsidian"]).catch(() => null);
      return r?.code === 0 && Boolean(r.stdout.trim());
    });
    return ok ? launcher : null;
  }
  return await commandExists(launcher.command, platform) ? launcher : null;
}

const words = (list) => Array.isArray(list) && list.every((s) => typeof s === "string" && s.length > 0);

function config(text) {
  if (text === null) return defaults;
  const { apps } = JSON.parse(text);
  if (!Array.isArray(apps)) throw new Error('Expected an "apps" array');
  const ids = new Set([DEFAULT, REVEAL]);
  return apps.map((entry, i) => {
    const preset = typeof entry === "string" && Object.hasOwn(presets, entry) ? presets[entry] : null;
    const { id, label, targets, launch, extensions } = preset ?? entry ?? {};
    if (typeof id !== "string" || !/^[\w-]+$/.test(id) || ids.has(id)) throw new Error(`Entry ${i + 1} needs a unique app ID or a preset name`);
    ids.add(id);
    if (preset) return preset;
    if (typeof label !== "string" || !label.trim() || !words(targets) || !targets.length || targets.some((t) => t !== "file" && t !== "folder")) {
      throw new Error(`${id} needs a label and at least one target, file or folder`);
    }
    if (extensions !== undefined && (!words(extensions) || extensions.some((s) => !s.startsWith(".")))) throw new Error(`${id} needs extensions starting with a dot`);
    if (!launch || typeof launch !== "object" || !Object.keys(launch).length) throw new Error(`${id} needs a launch entry for at least one OS`);
    const plans = Object.entries(launch).map(([os, spec]) => {
      if (!Object.hasOwn(labels, os) || !spec) throw new Error(`${id} has an invalid launch platform`);
      if (os === "macos" && typeof spec.bundle === "string" && spec.bundle && !spec.command) return [os, [{ bundle: spec.bundle }]];
      if (typeof spec.command !== "string" || !spec.command.trim() || !words(spec.args) || (spec.at !== undefined && !words(spec.at))) throw new Error(`${id} needs a command and an arguments array for ${os}`);
      return [os, [{ command: spec.command, args: spec.args, at: spec.at }]];
    });
    return { id, label: label.trim(), targets, extensions: extensions?.map((s) => s.toLowerCase()), launch: Object.fromEntries(plans) };
  });
}

const nativePath = (path, platform) => (platform === "windows" ? path.replace(/\//g, "\\") : path);
const matchPath = (path, platform) => (platform === "windows" ? path.replace(/\\/g, "/").toLowerCase() : path).replace(/\/+$/, "");

async function vaults(platform) {
  let dirs;
  if (platform === "macos") dirs = [`${home()}/Library/Application Support/obsidian`];
  else if (platform === "windows") {
    const r = await powershell("[Console]::Write($env:APPDATA)").catch(() => null);
    dirs = [`${r?.stdout.trim() || `${home()}\\AppData\\Roaming`}\\obsidian`];
  } else {
    const r = await exec("sh", ["-c", 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}"']).catch(() => null);
    dirs = [`${r?.stdout || `${home()}/.config`}/obsidian`, `${home()}/.var/app/md.obsidian.Obsidian/config/obsidian`];
  }
  const found = [];
  for (const dir of dirs) {
    try {
      const data = JSON.parse(await readTextFile(nativePath(`${dir}/obsidian.json`, platform)) ?? "{}");
      for (const [id, v] of Object.entries(data.vaults ?? {})) {
        if (typeof v?.path === "string" && v.path) found.push({ id, path: matchPath(v.path, platform) });
      }
    } catch {}
  }
  return found.sort((a, b) => b.path.length - a.path.length);
}

// Read preferences when a menu opens, and cache availability checks briefly without starting apps.
export async function load(on) {
  const platform = window()?.platform;
  if (on || !platform) return null;
  let apps;
  try {
    apps = config(await readTextFile(`${appHome()}/${FILE}`));
    configError = "";
  } catch (e) {
    const message = String(e?.message ?? e);
    if (configError !== message) notify({ title: `Couldn't read ${FILE}`, body: `${message}. Using the built-in apps.`, level: "error" });
    configError = message;
    apps = defaults;
  }
  const desktop = platform !== "linux" || await commandExists("xdg-open", platform);
  const select = platform !== "linux" || await commandExists("gdbus", platform);
  const installed = await Promise.all(apps.map(async (app) => {
    for (const plan of app.launch[platform] ?? []) {
      const launcher = await usable(plan, platform, desktop);
      if (launcher) return { ...app, launcher };
    }
    return null;
  }));
  const available = installed.filter(Boolean);
  return { platform, apps: available, desktop, select, vaults: available.some((app) => app.id === "obsidian") ? await vaults(platform) : [] };
}

function planFor(state, app, target) {
  const { path, dir } = target;
  const { platform } = state;
  if (!app.targets.includes(dir ? "folder" : "file")) return null;
  if (app.id === "obsidian" && (app.launcher.protocol || app.launcher.bundle === "md.obsidian")) {
    const p = matchPath(path, platform);
    const vault = state.vaults.find((v) => p === v.path || p.startsWith(`${v.path}/`));
    if (vault) return { uri: `obsidian://open?${dir ? "vault" : "path"}=${encodeURIComponent(dir ? vault.id : nativePath(path, platform))}` };
    if (platform !== "macos" || dir || !notes.some((ext) => p.toLowerCase().endsWith(ext))) return null;
  }
  if (!dir && app.extensions && !app.extensions.some((ext) => path.toLowerCase().endsWith(ext))) return null;
  return app.launcher;
}

export function choices(state, target, { reveal = true } = {}) {
  if (!state || !target.path) return [];
  const rows = state.apps.filter((app) => planFor(state, app, target)).map(({ id, label }) => ({ id, label: `Open in ${label}` }));
  if (!target.dir && state.desktop) rows.push({ id: DEFAULT, label: "Open with Default App" });
  if (reveal && (state.desktop || state.select)) rows.push({ id: REVEAL, label: labels[state.platform] });
  return rows;
}

export const isReveal = (id) => id === REVEAL;

function systemOpen(path, platform) {
  if (platform === "windows") return powershell(`Start-Process -FilePath ${psQuote(path)}`);
  return exec(platform === "macos" ? "open" : "xdg-open", [path]);
}

async function reveal(path, state) {
  if (state.platform === "macos") return exec("open", ["-R", path]);
  if (state.platform === "windows") {
    if (/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\?)$/i.test(path)) return systemOpen(path, state.platform);
    return powershell(`Start-Process -FilePath 'explorer.exe' -ArgumentList ${psQuote(`/select,"${path}"`)}`);
  }
  if (state.select) {
    const uri = `file://${path.split("/").map(encodeURIComponent).join("/").replace(/'/g, "%27")}`;
    const shown = await exec("gdbus", ["call", "--session", "--dest", "org.freedesktop.FileManager1", "--object-path", "/org/freedesktop/FileManager1", "--method", "org.freedesktop.FileManager1.ShowItems", `['${uri}']`, "''"], { timeout: 4000 }).catch(() => null);
    if (shown?.code === 0 || !state.desktop && shown) return shown;
  }
  return systemOpen(path.slice(0, path.lastIndexOf("/")) || "/", state.platform);
}

export async function open(id, target) {
  const failure = (label, error) => ({ error, title: id === REVEAL ? "Couldn't show it in the file manager" : `Couldn't open it${label ? ` in ${label}` : ""}` });
  let label;
  try {
    const state = await load(target.on);
    if (!state) return failure(label, "Only local paths can be opened by desktop apps");
    const { platform } = state;
    const path = nativePath(target.path, platform);
    const repo = target.repo && !target.dir && matchPath(target.path, platform).startsWith(`${matchPath(target.repo, platform)}/`)
      ? nativePath(target.repo, platform) : null;
    let result;
    if (id === REVEAL) result = await reveal(path, state);
    else if (id === DEFAULT && !target.dir) result = await systemOpen(path, platform);
    else {
      const app = state.apps.find((app) => app.id === id);
      label = app?.label;
      const plan = app && planFor(state, app, target);
      if (!plan) return failure(label, "This app is unavailable for this item");
      if (plan.uri) result = await systemOpen(plan.uri, platform);
      else if (plan.bundle) result = await exec("open", ["-a", plan.path, ...(plan.repo && repo ? [repo] : []), path]);
      else {
        const args = target.line && plan.at ? plan.at : plan.args;
        const values = { path, repo: repo ?? "", line: String(target.line ?? ""), column: String(target.column ?? 1) };
        result = await exec(plan.command, args.filter((arg) => arg !== "{repo}" || repo)
          .map((arg) => arg.replace(/\{(path|repo|line|column)\}/g, (_match, key) => values[key])));
      }
    }
    return result.code === 0 ? {} : failure(label, result.stderr.trim() || `Launcher exited with code ${result.code}`);
  } catch (e) { return failure(label, String(e?.message ?? e)); }
}
