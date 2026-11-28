// Plausible fake names for "hide names" (shared `names.hidden`): what a screenshot shows in place
// of a space, folder, tab, branch, machine or folder path. An alias is a pure function of the kind
// and the real string as displayed: no map, no state, nothing written, so the same real name gets
// the same fake one in every mod. The same file is in every mod that uses it (a mod imports only
// from its own folder): keep the copies the same. It touches nothing of the app and runs under
// `node` (alias.test.mjs in hide-names).

const PROJECTS = [
  "acorn", "alder", "amber", "anchor", "arbor", "aspen", "atlas", "aurora", "badger", "basalt",
  "beacon", "birch", "bramble", "breeze", "brook", "canyon", "cascade", "cedar", "citadel", "clover",
  "cobalt", "comet", "condor", "coral", "cosmos", "crest", "cypress", "delta", "drift", "dune",
  "echo", "ember", "falcon", "fern", "fjord", "flint", "forge", "fox", "gale", "garnet",
  "glacier", "granite", "grove", "gull", "harbor", "hazel", "helix", "heron", "horizon", "indigo",
  "iris", "ivory", "jade", "jasper", "juniper", "kelp", "kestrel", "lagoon", "lantern", "larch",
  "lark", "lotus", "lumen", "lynx", "magnet", "maple", "marble", "marlin", "meadow", "mercury",
  "mesa", "mist", "moss", "nectar", "nimbus", "nova", "oak", "oasis", "onyx", "opal",
  "orbit", "orchid", "osprey", "otter", "papyrus", "pebble", "pelican", "pepper", "pilot", "pine",
  "pixel", "plume", "polar", "prairie", "prism", "puffin", "pulsar", "quartz", "quasar", "quill",
  "raven", "reef", "ridge", "river", "rook", "rowan", "ruby", "sable", "saffron", "sage",
  "salmon", "sequoia", "shale", "sierra", "signal", "slate", "solstice", "sonar", "spark", "sparrow",
  "spruce", "stellar", "summit", "tango", "thistle", "tide", "timber", "topaz", "trail", "tundra",
  "vapor", "vector", "velvet", "vertex", "walnut", "willow", "wren", "yarrow", "zenith", "zephyr",
  "bluebell", "copper", "dahlia", "ferret", "hollow", "ibis", "kite", "linden", "monsoon", "nutmeg",
];
const SUFFIXES = ["-api", "-web", "-app", "-cli", "-site", "-docs"];

const FOLDERS = [
  "Clients", "Tools", "Lab", "Personal", "Infra", "Archive", "Sites", "Experiments", "Libraries", "Services",
  "Sandbox", "Work", "Studio", "Ops", "Research", "Design", "Docs", "Apps", "Backends", "Frontends",
  "Data", "Scripts", "Playground", "Learning", "Plugins", "Templates", "Mobile", "Games", "Hardware", "Notes",
  "Ideas", "Forks", "Demos", "Prototypes", "Utilities", "Websites", "Themes", "Integrations", "Internal", "Later",
];

const VERBS = [
  "Fix", "Refactor", "Add", "Update", "Review", "Clean up", "Speed up", "Document", "Test", "Migrate",
  "Rework", "Polish", "Debug", "Simplify", "Split", "Rename", "Remove", "Profile", "Port", "Draft",
  "Tidy", "Harden", "Extend", "Wire up",
];
const OBJECTS = [
  "login redirect", "search index", "cache layer", "billing page", "CSV export", "settings screen", "image upload", "error toasts",
  "dark mode", "signup flow", "rate limiter", "sync worker", "API client", "dashboard charts", "release notes", "onboarding tour",
  "password reset", "date picker", "webhook handler", "CI pipeline", "build script", "feature flags", "audit log", "invoice PDF",
  "retry logic", "query planner", "sidebar layout", "keyboard shortcuts", "theme tokens", "test fixtures", "mobile menu", "profile page",
  "upload progress", "email templates", "cron jobs", "session timeout", "pagination", "search filters", "map view", "chart tooltips",
  "file watcher", "config loader", "permission checks", "color picker", "metrics endpoint", "health check", "logging setup", "lint rules",
  "docker image", "migration script", "translations", "form validation", "cart totals", "notification center", "comment thread", "tag editor",
  "import wizard", "backup job", "status page", "schema types", "cookie banner", "footer links", "avatar crop", "timezone handling",
  "offline mode",
];

const HOSTS = [
  "studio", "devbox", "buildhost", "nas", "homelab", "cloudvm", "edge", "runner", "sandbox", "worker",
  "lab", "mini", "tower", "relay", "bastion", "forge-vm", "arm-box", "gpu-node", "office", "garage",
  "backup", "staging-vm", "media", "pi",
];

const KEEP_BRANCHES = new Set(["main", "master", "develop", "dev", "staging", "production", "trunk", "head", "detached", "(detached)"]);
const PREFIX = /^(feat|feature|fix|bugfix|chore|docs|refactor|hotfix|release|test|perf|ci|build|style|wip)\//i;
const BRANCH_PREFIXES = ["feat/", "fix/", "chore/", "refactor/"];
const HERE = new Set(["this computer", "this mac"]);
// Labels that are no one's name: a program, a shell, a tab's number.
const PLAIN = new Set(["terminal", "shell", "zsh", "bash", "fish", "sh", "nu", "pwsh", "program"]);

const norm = (s) => String(s ?? "").trim().toLowerCase();

// FNV-1a, 32 bits; `seed` makes a second, independent hash of the same text.
function hash(s, seed = 0) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
const pick = (list, s, seed) => list[hash(s, seed) % list.length];
const slug = (s) => s.toLowerCase().replace(/ /g, "-");

// A space or project name: lower case, like a repository's. `~` and "" stay.
export function project(name) {
  const s = norm(name);
  if (s === "" || s === "~") return String(name ?? "").trim();
  const h = hash(s, 0x5a17);
  const word = PROJECTS[h % PROJECTS.length];
  const n = hash(s, 0x2b3c) % 16;
  return word + (n < SUFFIXES.length ? SUFFIXES[n] : "");
}

// A sidebar folder's name. `taken`: names already given to other folders, to avoid: the next free
// one in a stable order, else a number.
export function folder(name, taken) {
  const s = norm(name);
  if (s === "") return "";
  const start = hash(s, 0x7f01) % FOLDERS.length;
  for (let i = 0; i < FOLDERS.length; i++) {
    const f = FOLDERS[(start + i) % FOLDERS.length];
    if (!taken || !taken.has(f)) return f;
  }
  for (let n = 2; ; n++) {
    const f = `${FOLDERS[start]} ${n}`;
    if (!taken.has(f)) return f;
  }
}

// A tab's name or an agent's task title: "Refactor search index". "" stays.
export function title(text) {
  const s = norm(text);
  if (s === "") return "";
  return `${pick(VERBS, s, 0x1d)} ${pick(OBJECTS, s, 0x3e)}`;
}

// A label that may be a name or may be plain: a tab's number, a program's name (`plain`, e.g. the
// pane's program), a shell; those stay, anything else is a title().
export function label(text, ...plain) {
  const s = norm(text);
  if (s === "" || /^\d+$/.test(s) || PLAIN.has(s) || plain.some((p) => p && norm(p) === s)) return text ?? "";
  return title(text);
}

// A branch: the usual long-lived ones stay; a conventional prefix stays, and the rest is made up.
export function branch(name) {
  const raw = String(name ?? "").trim();
  const s = raw.toLowerCase();
  if (s === "" || KEEP_BRANCHES.has(s)) return raw;
  const m = PREFIX.exec(raw);
  const rest = slug(pick(OBJECTS, s, 0x4c));
  return (m ? m[0].toLowerCase() : pick(BRANCH_PREFIXES, s, 0x55)) + rest;
}

// A machine's name. This computer's label stays.
export function machine(name) {
  const s = norm(name);
  if (s === "" || HERE.has(s)) return String(name ?? "");
  return pick(HOSTS, s, 0x6d);
}

// A folder path, for a pane header: home is `~`; else `~/<fake project>`, named after the segment
// that is the space's real name when there is one (then `/…` when the folder is deeper), else after
// the last segment. No real segment is ever shown.
export function path(cwd, home, spaceName) {
  if (!cwd) return "";
  const trim = (p) => String(p ?? "").replace(/\/+$/, "");
  const c = trim(cwd), h = trim(home);
  if (c === "" || c === h || c === "~") return "~";
  const segs = c.split("/").filter(Boolean);
  if (!segs.length) return "~";
  const want = norm(spaceName);
  let at = -1;
  if (want && want !== "~") for (let i = segs.length - 1; i >= 0; i--) if (norm(segs[i]) === want) { at = i; break; }
  if (at >= 0) return `~/${project(segs[at])}${at < segs.length - 1 ? "/…" : ""}`;
  return `~/${project(segs[segs.length - 1])}`;
}
