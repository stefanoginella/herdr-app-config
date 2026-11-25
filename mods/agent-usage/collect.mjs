// collect.mjs: token usage of Claude Code and Codex on this machine, as one JSON document.
//
//   node collect.mjs [flags]
//   node --input-type=module -e "$(cat collect.mjs)" -- [flags]
//
// Flags:
//   --home <dir>    the home folder every source is read from (default: the user's)
//   --state <dir>   where history is kept (default: <home>/.local/state/herdr-usage)
//   --no-state      read and write no history
//   --no-rg         don't use ripgrep even when it is on PATH
//   --now <ms>      the time to count days from (tests)
//   --docker-timeout <ms>  how long docker may take to answer (default 3000; a copy gets 10 times that)
//   --pretty        indent the JSON
//
// Node >= 18, no dependencies. Prints one JSON document on stdout; errors go to
// stderr with exit code 1. Missing sources are empty parts, never errors.
//
// The document (v3):
//   rows      one per local day (and hour, for the last HOURLY_DAYS), agent, place, project, model
//             and subagent flag: replies (n), tokens (in: uncached input, out, cr: cache read, cw:
//             cache write) and cost in USD. Claude's cost is Claude Code's own; Codex's is an
//             estimate from CODEX_PRICES (est: true), worked out when the document is printed, so
//             a new price table re-prices the past. A model with no price has cost null.
//   sessions  sessions a day, per project
//   limits    claude: the statusline's reading, its trail and earlier weeks; codex: the newest
//             rate_limits (primary, secondary, plan) and, for its weekly window, a trail of the
//             readings (week: { pct, resets, trail }) and the earlier weeks' peaks (weeks)
//   top       the TOP_MOST biggest sessions by tokens of the last TOP_DAYS, both agents
//   recent    what each project spent in the last 60 and 15 minutes (replies, tokens, cost)
//   older     Claude Code's own daily counts from before the first transcript
//   punch, punchDays, took

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const V = 3; // the document
const STATE_V = 1; // history.json and limits.json
const TOP_DAYS = 31; // `top`: sessions whose last reply is this recent
const TOP_MOST = 60;
// Codex's weekly window: readings whose reset is this close to another's are of the same window.
// resets_at jitters by a few seconds between readings, and once was seen 90 minutes off.
const CODEX_JITTER_MS = 3 * 3600000;
const CODEX_WEEK_MIN = 10080;
const PUNCH_DAYS = 28; // `punch`: this many full days before today, and today
const RECENT_MS = 60 * 60000; // `recent`: the projects with a reply this recent
const RECENT_SHORT_MS = 15 * 60000;
const HOURLY_DAYS = 8; // the days (today included) whose rows keep their hour
const SETTLED_DAYS = 2; // a day at least this old is merged into history
const TRAIL_WEEKS = 12; // weekly-limit trails kept
const HEAD_MOST = 1 << 20; // bytes read from a transcript's start to find its first cwd
const LOCK_WAIT = 15000;
const LOCK_STALE = 60000;

// Codex's files carry no cost: it is estimated from OpenAI's API prices, USD per 1M tokens:
// [input, cached input, output, cache write or null]. Fetched 2026-11-25 from OpenAI's pricing
// page, standard tier, prompts under 272K tokens (the long-context surcharge is ignored). The
// cache-write column is the 30-minute price (the page also lists a 12-hour one). Cache
// writes without a price of their own are priced as input; reasoning tokens are output (Codex
// counts them in output_tokens). A model not listed has no price. To update: edit this table,
// say when it was fetched, and run the tests (collect.test.mjs).
const CODEX_PRICES = {
  'gpt-6.2-sol': [2.00, 0.10, 10.00, 2.50],
  'gpt-6.1-sol': [2.00, 0.10, 10.00, 2.50],
  'gpt-6.2-astra': [8.00, 0.40, 40.00, 10.00],
  'gpt-6-astra': [10.00, 1.00, 50.00, 12.50],
  'gpt-6-luna': [0.10, 0.01, 0.50, 0.125],
  'gpt-5.6-sol': [4.00, 0.40, 20.00, 5.00], // promotional price until 2026-11-30
  'gpt-5.6-terra': [2.00, 0.20, 12.00, 2.50],
  'gpt-5.6-luna': [0.20, 0.02, 1.20, 0.25],
  'gpt-5.5': [5.00, 0.50, 30.00, null],
  'gpt-5.4': [2.50, 0.25, 15.00, null],
  'gpt-5.4-mini': [0.75, 0.075, 4.50, null],
  'gpt-5.3-codex': [1.75, 0.175, 14.00, null],
  'gpt-5.2-codex': [1.75, 0.175, 14.00, null],
  'gpt-5.2': [1.75, 0.175, 14.00, null],
  'gpt-5.1-codex-mini': [0.25, 0.025, 2.00, null],
  // No public price. An assumption, by the owner's choice: priced as gpt-5.6-luna.
  'codex-auto-review': [0.20, 0.02, 1.20, 0.25],
};
// The estimate for tokens { in (uncached), out, cr (cached), cw } of a model, or null.
function codexCost(model, t) {
  const p = Object.prototype.hasOwnProperty.call(CODEX_PRICES, model) ? CODEX_PRICES[model] : null;
  if (!p) return null;
  return ((t.in || 0) * p[0] + (t.cr || 0) * p[1] + (t.out || 0) * p[2] + (t.cw || 0) * (p[3] ?? p[0])) / 1e6;
}
const tokSum = (t) => (t.in || 0) + (t.out || 0) + (t.cr || 0) + (t.cw || 0);

const CLAUDE_NEEDLES = ['"usage":{', '"type":"cost-state"', '"type":"ai-title"'];
const CODEX_NEEDLES = ['"type":"session_meta"', '"type":"turn_context"', '"type":"token_count"'];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = { home: null, state: undefined, rg: true, now: null, pretty: false, help: false, dockerTimeout: 3000 };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const val = () => {
      if (inline !== null) return inline;
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--home') o.home = val();
    else if (a === '--state') o.state = val();
    else if (a === '--no-state') o.state = null;
    else if (a === '--no-rg') o.rg = false;
    else if (a === '--now') { o.now = Number(val()); if (!Number.isFinite(o.now)) throw new Error('--now needs a number of ms'); }
    else if (a === '--docker-timeout') { o.dockerTimeout = Number(val()); if (!Number.isFinite(o.dockerTimeout) || o.dockerTimeout <= 0) throw new Error('--docker-timeout needs a number of ms'); }
    else if (a === '--pretty') o.pretty = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  return o;
}

// ---------------------------------------------------------------- time

const pad = (n) => (n < 10 ? '0' : '') + n;
const partsCache = new Map();
function localParts(ms) {
  const k = Math.floor(ms / 60000); // every zone offset is a whole number of minutes
  let p = partsCache.get(k);
  if (!p) {
    const t = new Date(ms);
    p = { d: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, h: t.getHours(), dow: (t.getDay() + 6) % 7 };
    partsCache.set(k, p);
  }
  return p;
}
function dayShift(d, k) {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(y, m - 1, dd + k, 12);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

// ---------------------------------------------------------------- files

function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function readJson(p) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return undefined; }
  try { return JSON.parse(text); } catch { return undefined; }
}

// Every regular *.jsonl under root, symlinks not followed (as ripgrep does).
function walk(root, out) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

// Calls onLine(start, end) for each whole line of data that holds one of the needles.
function matchLines(data, needles, onLine) {
  const hits = [];
  for (const nd of needles) {
    let i = 0;
    while ((i = data.indexOf(nd, i)) !== -1) {
      const s = i === 0 ? 0 : data.lastIndexOf(10, i - 1) + 1;
      let e = data.indexOf(10, i);
      if (e < 0) e = data.length;
      hits.push(s, e);
      i = e + 1;
    }
  }
  if (needles.length > 1 && hits.length > 2) {
    const pairs = [];
    for (let j = 0; j < hits.length; j += 2) pairs.push([hits[j], hits[j + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    let last = -1;
    for (const [s, e] of pairs) if (s !== last) { last = s; onLine(s, e); }
  } else {
    for (let j = 0; j < hits.length; j += 2) onLine(hits[j], hits[j + 1]);
  }
}

// The plain Node prefilter: reads a file in large pieces and decodes only the lines that match.
function scanFile(file, needles, onLine) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return; }
  const CH = 1 << 20;
  const buf = Buffer.allocUnsafe(CH);
  let pending = [];
  const emit = (data) => matchLines(data, needles, (s, e) => onLine(data.toString('utf8', s, e)));
  try {
    for (;;) {
      let n;
      try { n = fs.readSync(fd, buf, 0, CH, null); } catch { break; }
      if (n === 0) break;
      const chunk = buf.subarray(0, n);
      const last = chunk.lastIndexOf(10);
      if (last < 0) { pending.push(Buffer.from(chunk)); continue; }
      let data;
      if (pending.length) { pending.push(chunk.subarray(0, last + 1)); data = Buffer.concat(pending); pending = []; }
      else data = chunk.subarray(0, last + 1);
      emit(data);
      if (last + 1 < n) pending.push(Buffer.from(chunk.subarray(last + 1)));
    }
    if (pending.length) emit(Buffer.concat(pending));
  } finally {
    fs.closeSync(fd);
  }
}

function hasRg() {
  try { return spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}

// ripgrep prefilter: onLine(file, line) for every matching line under roots.
function rgScan(roots, needles, onLine) {
  return new Promise((resolve, reject) => {
    const args = ['--no-config', '-uu', '-a', '-F', '-H', '--null', '-N', '--no-heading', '--color', 'never', '-g', '*.jsonl'];
    for (const n of needles) args.push('-e', n);
    args.push('--', ...roots);
    const rg = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = [];
    let err = '';
    const line = (b, s, e) => {
      const z = b.indexOf(0, s);
      if (z < 0 || z >= e) return;
      onLine(b.toString('utf8', s, z), b.toString('utf8', z + 1, e));
    };
    rg.stdout.on('data', (chunk) => {
      let s = 0;
      let nl = chunk.indexOf(10);
      if (nl < 0) { pending.push(chunk); return; }
      if (pending.length) {
        pending.push(chunk.subarray(0, nl));
        const b = Buffer.concat(pending);
        pending = [];
        line(b, 0, b.length);
        s = nl + 1;
        nl = chunk.indexOf(10, s);
      }
      while (nl >= 0) { line(chunk, s, nl); s = nl + 1; nl = chunk.indexOf(10, s); }
      if (s < chunk.length) pending.push(chunk.subarray(s));
    });
    rg.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    rg.on('error', reject);
    rg.on('close', (code) => {
      if (pending.length) { const b = Buffer.concat(pending); line(b, 0, b.length); }
      // 1: nothing matched; 2: some file could not be read (the walk skips those too)
      if (code === 0 || code === 1 || code === 2) resolve();
      else reject(new Error(`rg exited with ${code}: ${err.trim()}`));
    });
  });
}

// The first top-level cwd in a transcript.
function firstCwd(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let pending = [];
    let read = 0;
    const look = (s) => {
      try { const o = JSON.parse(s); return o && typeof o.cwd === 'string' && o.cwd ? o.cwd : null; } catch { return null; }
    };
    while (read < HEAD_MOST) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      read += n;
      let s = 0;
      let nl = buf.indexOf(10);
      while (nl >= 0 && nl < n) {
        let text;
        if (pending.length) { pending.push(buf.subarray(0, nl)); text = Buffer.concat(pending).toString('utf8'); pending = []; }
        else text = buf.toString('utf8', s, nl);
        const c = look(text);
        if (c) return c;
        s = nl + 1;
        nl = buf.indexOf(10, s);
      }
      if (s < n) pending.push(Buffer.from(buf.subarray(s, n)));
    }
    if (pending.length) return look(Buffer.concat(pending).toString('utf8'));
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- sources

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return path.resolve(p);
}

function findSources(home) {
  const src = [];
  const add = (agent, roots) => {
    const r = roots.filter(isDir);
    if (r.length) src.push({ id: src.length, agent, where: 'host', box: null, project: null, roots: r, files: [], bytes: 0 });
  };
  add('claude', [path.join(home, '.claude', 'projects')]);
  add('codex', [path.join(home, '.codex', 'sessions'), path.join(home, '.codex', 'archived_sessions')]);
  for (const s of src) {
    for (const r of s.roots) walk(r, s.files);
    s.files.sort();
    for (const f of s.files) { try { s.bytes += fs.statSync(f).size; } catch {} }
  }
  return src;
}

// ---------------------------------------------------------------- dev containers, through docker
//
// Dev containers are found by the label devcontainer.local_folder, running or not. Their transcripts
// are read with `docker cp <id>:<dir> -` (a tar on stdout, which works on an exited container too)
// and kept, slimmed to what the collector uses, in <state>/containers/<id>.json:
//   - an exited container whose FinishedAt is unchanged is not asked again;
//   - a running one is listed with `docker exec find` and only the files whose size or mtime changed
//     are fetched (`docker exec tar`); if exec fails there, the whole folder is copied again;
//   - without state, everything is copied on every run.
// Every docker child has a timeout and is killed after it.

const CACHE_FMT = 1; // bump when what is kept per file changes
const AIC = '/home/vscode/.aic-sessions/tool-homes';

function dockerRun(args, timeout, onData) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
      resolve({ code: null, out: Buffer.alloc(0), err: '', fail: e.code === 'ENOENT' ? 'absent' : String(e.message || e) });
      return;
    }
    const out = [];
    let err = '';
    let fail = null;
    let done = false;
    const timer = setTimeout(() => { fail = 'timeout'; try { child.kill('SIGKILL'); } catch {} }, timeout);
    child.stdout.on('data', (d) => {
      if (!onData) { out.push(d); return; }
      try { onData(d); } catch (e) { fail = fail || String(e.message || e); try { child.kill('SIGKILL'); } catch {} }
    });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    const end = (code, e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (e) fail = fail || (e.code === 'ENOENT' ? 'absent' : String(e.message || e));
      resolve({ code, out: Buffer.concat(out), err, fail });
    };
    child.on('error', (e) => end(null, e));
    child.on('close', (code) => end(code, null));
  });
}
const firstLine = (s) => String(s || '').trim().split('\n')[0].trim() || 'failed';

// A tar stream: onFile(name, size, mtimeSeconds, content) for each regular file.
class TarReader {
  constructor(onFile) { this.onFile = onFile; this.parts = []; this.have = 0; this.need = 512; this.hdr = null; this.pax = {}; this.longName = null; this.ended = false; }
  take(n) {
    const b = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
    this.parts = b.length > n ? [b.subarray(n)] : [];
    this.have = b.length - n;
    return b.subarray(0, n);
  }
  push(chunk) {
    if (this.ended) return;
    this.parts.push(chunk);
    this.have += chunk.length;
    while (!this.ended && this.have >= this.need) {
      if (!this.hdr) {
        const h = this.take(512);
        if (h.every((x) => x === 0)) { this.ended = true; break; }
        const str = (o, n) => { const s = h.subarray(o, o + n); const z = s.indexOf(0); return s.subarray(0, z < 0 ? n : z).toString('utf8'); };
        const num = (o, n) => {
          if (h[o] & 0x80) { let v = 0; for (let i = o + 1; i < o + n; i++) v = v * 256 + h[i]; return v; }
          const v = parseInt(str(o, n).trim() || '0', 8);
          return Number.isFinite(v) ? v : 0;
        };
        let name = str(0, 100);
        if (str(257, 5) === 'ustar') { const pre = str(345, 155); if (pre) name = pre + '/' + name; }
        const type = String.fromCharCode(h[156] || 48);
        const size = num(124, 12);
        this.hdr = { name, size, mtime: num(136, 12), type };
        this.need = Math.ceil(size / 512) * 512;
        if (this.need === 0) this.entry(Buffer.alloc(0));
      } else {
        const data = this.take(this.need).subarray(0, this.hdr.size);
        this.entry(data);
      }
    }
  }
  entry(data) {
    const h = this.hdr;
    this.hdr = null;
    this.need = 512;
    if (h.type === 'x') {
      const s = data.toString('utf8');
      let i = 0;
      while (i < s.length) {
        const sp = s.indexOf(' ', i);
        if (sp < 0) break;
        const len = parseInt(s.slice(i, sp), 10);
        if (!(len > 0)) break;
        const rec = s.slice(sp + 1, i + len - 1);
        const eq = rec.indexOf('=');
        if (eq > 0) this.pax[rec.slice(0, eq)] = rec.slice(eq + 1);
        i += len;
      }
      return;
    }
    if (h.type === 'L') { this.longName = data.toString('utf8').replace(/\0+$/, ''); return; }
    if (h.type === 'g' || h.type === 'K') return;
    const name = this.pax.path || this.longName || h.name;
    const mtime = this.pax.mtime ? Math.floor(Number(this.pax.mtime)) : h.mtime;
    this.pax = {};
    this.longName = null;
    if (h.type === '0' || h.type === '7' || h.type === '\0') this.onFile(name, data.length, mtime, data);
  }
}

// The first top-level cwd in a transcript held in memory (as firstCwd does on a file).
function firstCwdBuf(buf) {
  const end = Math.min(buf.length, HEAD_MOST);
  let s = 0;
  while (s < end) {
    let nl = buf.indexOf(10, s);
    if (nl < 0 || nl > end) nl = end;
    try { const o = JSON.parse(buf.toString('utf8', s, nl)); if (o && typeof o.cwd === 'string' && o.cwd) return o.cwd; } catch {}
    s = nl + 1;
  }
  return null;
}

// What the collector needs of a matched line, so the cache stays small. '!' stands for a line that
// does not parse (the collector counts it as bad).
function slim(agent, text) {
  let o;
  try { o = JSON.parse(text); } catch { return '!'; }
  if (!o || typeof o !== 'object') return '!';
  const p = o.payload && typeof o.payload === 'object' ? o.payload : null;
  if (agent === 'claude') {
    if (o.type === 'assistant') {
      const m = o.message && typeof o.message === 'object' ? { id: o.message.id, model: o.message.model, usage: o.message.usage } : o.message;
      return JSON.stringify({ type: o.type, timestamp: o.timestamp, cwd: o.cwd, sessionId: o.sessionId, isSidechain: o.isSidechain, requestId: o.requestId, uuid: o.uuid, message: m });
    }
    if (o.type === 'cost-state') return text;
    if (o.type === 'ai-title') return JSON.stringify({ type: o.type, aiTitle: o.aiTitle, sessionId: o.sessionId });
    return JSON.stringify({ type: o.type });
  }
  if (o.type === 'session_meta' && p) {
    const keep = {};
    for (const k of ['id', 'session_id', 'cwd', 'source', 'thread_source', 'forked_from_id', 'model']) if (k in p) keep[k] = p[k];
    return JSON.stringify({ timestamp: o.timestamp, type: o.type, payload: keep });
  }
  if (o.type === 'turn_context' && p) return JSON.stringify({ timestamp: o.timestamp, type: o.type, payload: { model: p.model } });
  if (o.type === 'event_msg' && p && p.type === 'token_count') return text;
  return JSON.stringify({ type: o.type });
}

function readFileEntry(agent, size, mtime, content) {
  const needles = (agent === 'claude' ? CLAUDE_NEEDLES : CODEX_NEEDLES).map((n) => Buffer.from(n));
  const lines = [];
  matchLines(content, needles, (s, e) => lines.push(slim(agent, content.toString('utf8', s, e))));
  return { size, mtime, cwd: agent === 'claude' ? firstCwdBuf(content) : null, lines };
}

// Copies a folder out of a container. → Map(rel -> entry) or throws.
async function copyFolder(id, dir, agent, timeout, reuse) {
  const files = new Map();
  const tar = new TarReader((name, size, mtime, content) => {
    const rel = name.split('/').slice(1).join('/'); // the copied folder's own name comes first
    if (!rel.endsWith('.jsonl')) return;
    const old = reuse && reuse[rel];
    files.set(rel, old && old.size === size && old.mtime === mtime ? old : readFileEntry(agent, size, mtime, content));
  });
  const r = await dockerRun(['cp', '-L', `${id}:${dir}`, '-'], timeout, (d) => tar.push(d));
  if (r.fail) throw new Error(r.fail);
  if (r.code !== 0) { const e = new Error(firstLine(r.err)); e.missing = /no such|could not find|not found/i.test(r.err); throw e; }
  return files;
}

// Fetches some files of a folder from a running container. → Map(rel -> entry) or throws.
async function fetchFiles(id, dir, rels, agent, timeout) {
  const files = new Map();
  const tar = new TarReader((name, size, mtime, content) => {
    const rel = name.replace(/^\.\//, '');
    if (rels.includes(rel)) files.set(rel, readFileEntry(agent, size, mtime, content));
  });
  const r = await dockerRun(['exec', '-w', '/', id, 'tar', '-cf', '-', '-C', dir, '--', ...rels], timeout, (d) => tar.push(d));
  if (r.fail) throw new Error(r.fail);
  if (r.code !== 0 && r.code !== 1) throw new Error(firstLine(r.err)); // 1: a file changed while read
  return files;
}

// Lists the transcripts under each candidate folder of a running container. → Map(dir -> Map(rel -> {size, mtime})) or null.
async function listFolders(id, dirs, timeout) {
  const r = await dockerRun(['exec', '-w', '/', id, 'find', ...dirs, '-type', 'f', '-name', '*.jsonl', '-printf', '%H\\t%s\\t%T@\\t%P\\n'], timeout);
  if (r.fail || (r.code !== 0 && r.code !== 1)) return null;
  const errs = r.err.split('\n').filter((l) => l.trim() && !/no such file/i.test(l));
  if (errs.length) return null; // no GNU find, or another failure
  const out = new Map();
  for (const line of r.out.toString('utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length !== 4) continue;
    const dir = f[0].replace(/\/+$/, '');
    if (!out.has(dir)) out.set(dir, new Map());
    out.get(dir).set(f[3], { size: Number(f[1]), mtime: Math.floor(Number(f[2])) });
  }
  return out;
}

function candidates(info) {
  const env = {};
  for (const e of (info.Config && info.Config.Env) || []) { const i = e.indexOf('='); if (i > 0) env[e.slice(0, i)] = e.slice(i + 1); }
  const labels = (info.Config && info.Config.Labels) || {};
  let user = null;
  try {
    const meta = JSON.parse(labels['devcontainer.metadata'] || '[]');
    for (const m of Array.isArray(meta) ? meta : []) if (m && typeof m.remoteUser === 'string') user = m.remoteUser;
    if (!user) for (const m of Array.isArray(meta) ? meta : []) if (m && typeof m.containerUser === 'string') user = m.containerUser;
  } catch {}
  if (!user && info.Config && typeof info.Config.User === 'string') user = info.Config.User.split(':')[0];
  let home = env.HOME || null;
  if (!home && user !== null) home = user === '' || user === 'root' ? '/root' : /^[a-z_][a-z0-9_.-]*$/i.test(user) ? `/home/${user}` : null;
  if (!home && user === null) home = '/root';
  const uniq = (xs) => [...new Set(xs.filter(Boolean).map((x) => x.replace(/\/+$/, '')))];
  return {
    claude: uniq([env.CLAUDE_CONFIG_DIR && `${env.CLAUDE_CONFIG_DIR}/projects`, home && `${home}/.claude/projects`, `${AIC}/claude/projects`]),
    codex: uniq([env.CODEX_HOME && `${env.CODEX_HOME}/sessions`, home && `${home}/.codex/sessions`, `${AIC}/codex/sessions`]),
  };
}

async function readContainer(info, stateDir, timeout) {
  const id = info.Id;
  const st = info.State || {};
  const running = !!st.Running;
  const finished = String(st.FinishedAt || '');
  const cands = candidates(info);
  const cfile = stateDir ? path.join(stateDir, 'containers', `${id}.json`) : null;
  let cache = cfile ? readJson(cfile) : null;
  if (!cache || cache.fmt !== CACHE_FMT || cache.id !== id) cache = null;
  const longer = timeout * 10;
  const out = { roots: {}, files: {}, via: null };

  if (cache && !running && cache.finished === finished && !cache.running) {
    out.roots = cache.roots; out.files = cache.files; out.via = 'cache';
    return { out, cfile, write: false };
  }

  let listed = null;
  if (running && cache) listed = await listFolders(id, [...cands.claude, ...cands.codex], timeout);
  for (const agent of ['claude', 'codex']) {
    const old = cache && cache.files[agent] ? cache.files[agent] : null;
    if (listed) {
      const dir = cands[agent].find((d) => listed.has(d)) || null;
      out.roots[agent] = dir;
      if (!dir) { out.files[agent] = {}; continue; }
      const now = listed.get(dir);
      const reuse = old && cache.roots[agent] === dir ? old : {};
      const files = {};
      const changed = [];
      for (const [rel, m] of now) {
        const o = reuse[rel];
        if (o && o.size === m.size && o.mtime === m.mtime) files[rel] = o; else changed.push(rel);
      }
      if (changed.length) {
        let got;
        try { got = await fetchFiles(id, dir, changed, agent, longer); } catch { got = null; }
        if (got) for (const [rel, e] of got) files[rel] = e;
        else { const all = await copyFolder(id, dir, agent, longer, reuse); for (const k of Object.keys(files)) delete files[k]; for (const [rel, e] of all) files[rel] = e; }
      }
      out.files[agent] = files;
      out.via = out.via === 'full' ? 'full' : changed.length ? 'changed' : 'cache';
      continue;
    }
    // Copy the whole folder: the cached root first, then each candidate until one exists.
    const tryDirs = [...new Set([cache && cache.roots[agent], ...cands[agent]].filter(Boolean))];
    out.roots[agent] = null;
    out.files[agent] = {};
    for (const dir of tryDirs) {
      try {
        const files = await copyFolder(id, dir, agent, longer, old && cache.roots[agent] === dir ? old : null);
        out.roots[agent] = dir;
        out.files[agent] = Object.fromEntries(files);
        break;
      } catch (e) {
        if (!e.missing) throw e;
      }
    }
    out.via = 'full';
  }
  return { out, cfile, write: !!cfile, finished, running };
}

// → { status, sources: [...], entries: [...] }
async function readContainers(stateDir, timeout) {
  const t0 = Date.now();
  const ps = await dockerRun(['ps', '-a', '--no-trunc', '-q', '--filter', 'label=devcontainer.local_folder'], timeout);
  if (ps.fail) return { status: ps.fail, sources: [], entries: [], ms: Date.now() - t0 };
  if (ps.code !== 0) return { status: firstLine(ps.err), sources: [], entries: [], ms: Date.now() - t0 };
  const ids = ps.out.toString('utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  let infos = [];
  if (ids.length) {
    const ins = await dockerRun(['inspect', ...ids], timeout);
    if (ins.fail) return { status: ins.fail, sources: [], entries: [], ms: Date.now() - t0 };
    try { infos = JSON.parse(ins.out.toString('utf8')); } catch { infos = []; }
    if (!Array.isArray(infos) || (ins.code !== 0 && !infos.length)) return { status: firstLine(ins.err), sources: [], entries: [], ms: Date.now() - t0 };
  }
  infos.sort((a, b) => (String(a.Id) < String(b.Id) ? -1 : 1));
  const results = await Promise.all(infos.map(async (info) => {
    const folder = ((info.Config && info.Config.Labels) || {})['devcontainer.local_folder'];
    const box = folder ? path.posix.basename(folder) : String(info.Name || info.Id).replace(/^\//, '');
    try { return { info, folder, box, ...(await readContainer(info, stateDir, timeout)) }; } catch (e) {
      return { info, folder, box, error: firstLine(e.message) };
    }
  }));
  const sources = [];
  const entries = [];
  for (const r of results) {
    if (r.error) { entries.push({ where: 'container', box: r.box, error: r.error }); continue; }
    const id12 = r.info.Id.slice(0, 12);
    for (const agent of ['claude', 'codex']) {
      const files = r.out.files[agent] || {};
      const rels = Object.keys(files).sort();
      const root = `/docker/${id12}/${agent}`;
      const src = { agent, where: 'container', box: r.box, project: r.folder || null, roots: [root], files: [], bytes: 0, data: new Map(), via: r.out.via };
      for (const rel of rels) { const f = `${root}/${rel}`; src.files.push(f); src.bytes += files[rel].size; src.data.set(f, files[rel]); }
      if (src.files.length) sources.push(src);
    }
    if (r.write) {
      try {
        fs.mkdirSync(path.dirname(r.cfile), { recursive: true });
        writeAtomic(r.cfile, { fmt: CACHE_FMT, id: r.info.Id, finished: r.finished, running: r.running, roots: r.out.roots, files: r.out.files });
      } catch (e) { process.stderr.write(`collect: container cache not kept: ${e.message}\n`); }
    }
  }
  // Caches of containers that are gone
  if (stateDir) {
    const dir = path.join(stateDir, 'containers');
    const keep = new Set(infos.map((i) => `${i.Id}.json`));
    let names = [];
    try { names = fs.readdirSync(dir); } catch {}
    for (const n of names) if (n.endsWith('.json') && !keep.has(n)) { try { fs.rmSync(path.join(dir, n), { force: true }); } catch {} }
  }
  return { status: 'ok', sources, entries, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- collecting

class Collector {
  constructor() {
    this.bad = 0;
    this.lines = 0;
    this.claude = new Map(); // file -> state
    this.codex = new Map();
    this.heads = new Map(); // file -> its first cwd, for files that are not on this disk
  }

  line(src, file, s) {
    this.lines++;
    let o;
    try { o = JSON.parse(s); } catch { this.bad++; return; }
    if (!o || typeof o !== 'object') { this.bad++; return; }
    if (src.agent === 'claude') this.claudeLine(src, file, o);
    else this.codexLine(src, file, o);
  }

  claudeFile(src, file) {
    let st = this.claude.get(file);
    if (!st) {
      const root = src.roots.find((r) => file.startsWith(r + path.sep)) || src.roots[0];
      const rel = path.relative(root, file).split(path.sep);
      // <projdir>/<session>.jsonl, or <projdir>/<session>/subagents/agent-*.jsonl
      const session = rel.length >= 3 ? rel[1] : path.basename(file, '.jsonl');
      st = { src, file, projdir: path.join(root, rel[0]), session, sub: rel.length >= 3, msgs: new Map(), costs: [], cwd: null, title: null, maxTs: -Infinity };
      this.claude.set(file, st);
    }
    return st;
  }

  claudeLine(src, file, o) {
    const st = this.claudeFile(src, file);
    if (o.type === 'ai-title') { if (typeof o.aiTitle === 'string' && o.aiTitle) st.title = o.aiTitle; return; }
    if (o.type === 'cost-state') {
      if (typeof o.totalCostUSD === 'number' && o.modelUsage && typeof o.modelUsage === 'object') st.costs.push(o);
      return;
    }
    if (o.type !== 'assistant') return;
    const m = o.message;
    const u = m && m.usage;
    if (!u || typeof u !== 'object') return;
    const model = typeof m.model === 'string' ? m.model : 'unknown';
    if (model === '<synthetic>') return;
    const ts = Date.parse(o.timestamp);
    if (!Number.isFinite(ts)) { this.bad++; return; }
    const id = m.id || o.requestId || o.uuid;
    if (!id) return;
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const cw = num(u.cache_creation_input_tokens);
    const split = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
    const cw1h = split ? Math.min(cw, num(split.ephemeral_1h_input_tokens)) : 0;
    if (st.cwd === null && typeof o.cwd === 'string' && o.cwd) st.cwd = o.cwd;
    if (ts > st.maxTs) st.maxTs = ts;
    st.msgs.set(id, {
      id, ts, model, sub: st.sub || o.isSidechain === true,
      in: num(u.input_tokens), out: num(u.output_tokens), cr: num(u.cache_read_input_tokens), cw, cw5: cw - cw1h, cw1h,
    });
  }

  codexFile(src, file) {
    let st = this.codex.get(file);
    if (!st) { st = { src, file, meta: null, model: null, prevTotal: undefined, events: [], limits: [] }; this.codex.set(file, st); }
    return st;
  }

  codexLine(src, file, o) {
    const st = this.codexFile(src, file);
    const p = o.payload;
    if (!p || typeof p !== 'object') return;
    if (o.type === 'session_meta') { if (!st.meta) st.meta = p; return; }
    if (o.type === 'turn_context') { if (typeof p.model === 'string' && p.model) st.model = p.model; return; }
    if (o.type !== 'event_msg' || p.type !== 'token_count') return;
    const ts = Date.parse(o.timestamp);
    if (!Number.isFinite(ts)) { this.bad++; return; }
    if (p.rate_limits && typeof p.rate_limits === 'object') {
      st.limits.push({ ts, fp: JSON.stringify(p), rl: p.rate_limits });
    }
    const info = p.info;
    const last = info && info.last_token_usage;
    if (!last || typeof last !== 'object') return;
    const total = info.total_token_usage ? info.total_token_usage.total_tokens : undefined;
    if (total !== undefined && total === st.prevTotal) return; // repeats the previous event
    if (total !== undefined) st.prevTotal = total;
    st.events.push({ ts, fp: JSON.stringify([info.total_token_usage ?? null, last]), model: st.model, u: last });
  }
}

// ---------------------------------------------------------------- projects

function herdrWorktrees(home) {
  const s = readJson(path.join(home, '.config', 'herdr-app', 'settings.json'));
  const d = s && s.worktrees && typeof s.worktrees.directory === 'string' && s.worktrees.directory;
  return d ? expandHome(d, home) : path.join(home, '.herdr', 'worktrees');
}

function claudeWorktree(p) {
  const m = p.match(/^(.+?)\/\.claude\/worktrees\/[^/]+(\/.*)?$/);
  return m ? m[1] + (m[2] || '') : p;
}

function decodeProjdir(dir) {
  // Lossy: Claude Code writes every '/', '.' and '_' as '-'. Used only when no transcript says its cwd.
  return path.basename(dir).replace(/-/g, '/') || '/';
}

// Maps raw project paths to the paths rows show.
function projectMapper(raws, wt) {
  const byBase = new Map();
  for (const r of raws) {
    if (r.where !== 'host') continue;
    const p = claudeWorktree(r.path);
    if (p === wt || p.startsWith(wt + '/')) continue;
    const b = path.posix.basename(p);
    if (!byBase.has(b)) byBase.set(b, new Set());
    byBase.get(b).add(p);
  }
  const unique = (b) => { const s = byBase.get(b); return s && s.size === 1 ? [...s][0] : null; };
  return (p) => {
    p = claudeWorktree(p);
    if (p.startsWith(wt + '/')) {
      const rest = p.slice(wt.length + 1).split('/');
      if (rest.length >= 2 && rest[0]) {
        const tail = rest.slice(2).join('/');
        const repo = unique(rest[0]) || `${wt}/${rest[0]}`;
        p = repo + (tail ? '/' + tail : '');
      }
    }
    return p;
  };
}

// ---------------------------------------------------------------- aggregation

const SEP = '\u0001';
const rowKey = (r, withHour) => [r.d, withHour ? r.h : null, r.agent, r.where, r.box, r.project, r.model, r.sub].join(SEP);
const sessKey = (r) => [r.d, r.agent, r.where, r.box, r.project].join(SEP);
const weight = (m) => m.in + 5 * m.out + 0.1 * m.cr + 1.25 * m.cw5 + 2 * m.cw1h;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// Readings [ms, pct], oldest first, as a trail: only a rise, at most one point an hour (a rise
// inside the hour of the last point moves that point).
function risesHourly(points) {
  const out = [];
  for (const [ts, pct] of [...points].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && pct <= last[1]) continue;
    if (last && Math.floor(ts / 3600000) === Math.floor(last[0] / 3600000)) { last[0] = ts; last[1] = pct; continue; }
    out.push([ts, pct]);
  }
  return out;
}

// The earlier weeks of a limit, newest first, from { resets: trail }: the highest reading each reached.
function earlierWeeks(weeks, current) {
  return Object.keys(weeks).sort((a, b) => Number(a) - Number(b)).filter((k) => k !== current && Array.isArray(weeks[k])).reverse().map((k) => ({
    resets: Number(k), peak: weeks[k].reduce((m, x) => (Array.isArray(x) && typeof x[1] === 'number' && x[1] > m ? x[1] : m), 0),
  }));
}

function finish(col, sources, home, now) {
  const today = localParts(now).d;
  const hourlyFrom = dayShift(today, -(HOURLY_DAYS - 1));
  const wt = herdrWorktrees(home);

  // --- Claude: one copy of each message. A resumed session copies its parent's messages into a
  // new file and goes on from there, so the copy kept is the one in the file that ends first.
  const cfiles = [...col.claude.values()].sort((a, b) => a.maxTs - b.maxTs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const owner = new Map(); // message id -> file state
  for (const st of cfiles) for (const id of st.msgs.keys()) if (!owner.has(id)) owner.set(id, st);

  // sessions: their files, cost-state and starting folder
  const sessions = new Map(); // src.id:session -> {src, main, files, cs, msgs}
  const byPath = [...col.claude.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
  const sess = (st) => {
    const k = st.src.id + ':' + st.session;
    let s = sessions.get(k);
    if (!s) { s = { key: k, src: st.src, projdir: st.projdir, session: st.session, main: null, subs: [], cs: null, msgs: [], raw: null, project: null }; sessions.set(k, s); }
    return s;
  };
  for (const st of byPath) {
    const s = sess(st);
    if (st.sub) s.subs.push(st); else s.main = st;
    for (const c of st.costs) if (!s.cs || c.totalCostUSD > s.cs.totalCostUSD) s.cs = c;
    for (const m of st.msgs.values()) if (owner.get(m.id) === st) s.msgs.push(m);
  }
  // sessions whose main file has no usage line still need their files known
  for (const src of sources) {
    if (src.agent !== 'claude') continue;
    for (const f of src.files) if (!col.claude.has(f)) col.claudeFile(src, f);
  }
  for (const st of col.claude.values()) { const s = sess(st); if (!st.sub && !s.main) s.main = st; else if (st.sub && !s.subs.includes(st)) s.subs.push(st); }

  // A resumed session's cost-state goes on counting from its parent's (the same startTime): what a
  // session spent itself is its total less the one before it in that chain.
  {
    const chains = new Map();
    for (const s of sessions.values()) {
      if (!s.cs) continue;
      s.own = s.cs.modelUsage;
      const t = s.cs.startTime;
      if (typeof t !== 'number') continue;
      const k = [s.src.id, s.projdir, t].join(SEP);
      if (!chains.has(k)) chains.set(k, []);
      chains.get(k).push(s);
    }
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    for (const chain of chains.values()) {
      if (chain.length < 2) continue;
      chain.sort((a, b) => a.cs.totalCostUSD - b.cs.totalCostUSD || (a.key < b.key ? -1 : 1));
      for (let i = chain.length - 1; i > 0; i--) {
        const cur = chain[i].cs.modelUsage;
        const prev = chain[i - 1].cs.modelUsage;
        const own = {};
        for (const [model, mu] of Object.entries(cur)) {
          const pu = prev[model] || {};
          const d = {};
          for (const f of ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'costUSD']) d[f] = Math.max(0, num(mu[f]) - num(pu[f]));
          if (d.costUSD > 0 || d.outputTokens > 0) own[model] = d;
        }
        chain[i].own = own;
      }
    }
  }

  const raws = [];
  for (const s of sessions.values()) {
    const head = (st) => (col.heads.has(st.file) ? col.heads.get(st.file) : firstCwd(st.file));
    let cwd = s.main ? head(s.main) : null;
    if (!cwd) for (const st of s.subs) { cwd = head(st); if (cwd) break; }
    if (!cwd) cwd = (s.main && s.main.cwd) || (s.subs.find((x) => x.cwd) || {}).cwd || decodeProjdir(s.projdir);
    s.raw = cwd;
    s.title = (s.main && s.main.title) || (s.subs.find((x) => x.title) || {}).title || null;
    if (s.src.where === 'host') raws.push({ path: cwd, where: s.src.where });
  }

  // --- Codex: one copy of each event, the earliest (a forked thread replays its parent's)
  const xfiles = [...col.codex.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
  const best = new Map();
  for (const st of xfiles) for (const ev of st.events) {
    const b = best.get(ev.fp);
    if (!b || ev.ts < b.ev.ts) best.set(ev.fp, { ev, st });
  }
  for (const st of xfiles) {
    const cwd = st.meta && typeof st.meta.cwd === 'string' && st.meta.cwd ? st.meta.cwd : null;
    st.raw = cwd || '/';
    if (cwd && st.src.where === 'host') raws.push({ path: cwd, where: st.src.where });
  }

  const mapProject = projectMapper(raws, wt);

  // --- Claude cost
  const rate = new Map(); // model -> [usd, weight]
  for (const s of sessions.values()) {
    s.project = s.src.project || mapProject(s.raw);
    s.groups = new Map();
    for (const m of s.msgs) {
      let g = s.groups.get(m.model);
      if (!g) { g = { w: 0, n: 0 }; s.groups.set(m.model, g); }
      g.w += weight(m);
      g.n++;
    }
    if (!s.own) continue;
    for (const [model, mu] of Object.entries(s.own)) {
      const g = s.groups.get(model);
      if (!g || !(g.w > 0) || typeof mu.costUSD !== 'number') continue;
      const r = rate.get(model) || [0, 0];
      r[0] += mu.costUSD;
      r[1] += g.w;
      rate.set(model, r);
    }
  }

  const rows = new Map();
  const sessRows = new Map();
  const punchFrom = dayShift(today, -PUNCH_DAYS);
  const punch = new Map(); // dow*24+h -> {n, cost}
  const recent = new Map(); // agent, where, box, project -> what the last 60 and 15 minutes cost
  let firstDay = null;
  const add = (base, m, cost, sessionId) => {
    const { d, h, dow } = localParts(m.ts);
    if (m.ts > now - RECENT_MS && m.ts <= now + RECENT_SHORT_MS) {
      const k = JSON.stringify([base.agent, base.where, base.box, base.project]);
      let x = recent.get(k);
      if (!x) { x = { agent: base.agent, where: base.where, box: base.box, project: base.project, cost15: 0, cost60: 0, n15: 0, n60: 0, tok60: 0, last: 0, ...(base.agent === 'codex' ? { est: true } : {}) }; recent.set(k, x); }
      const n = m.count ?? 1;
      // Codex's rows are priced when the document is printed; its recent cost is priced here.
      const rc = cost ?? (base.agent === 'codex' ? codexCost(m.model, m) : null);
      x.n60 += n; x.tok60 += tokSum(m); if (rc !== null) x.cost60 += rc;
      if (m.ts > now - RECENT_SHORT_MS) { x.n15 += n; if (rc !== null) x.cost15 += rc; }
      if (n > 0 && m.ts > x.last) x.last = m.ts;
    }
    if (firstDay === null || d < firstDay) firstDay = d; // the days before it have no record at all
    if (d >= punchFrom && d <= today) {
      const k = dow * 24 + h;
      let p = punch.get(k);
      if (!p) { p = { dow, h, cost: 0, n: 0 }; punch.set(k, p); }
      p.n += m.count ?? 1;
      if (cost !== null) p.cost += cost;
    }
    const r = { d, h: d >= hourlyFrom ? h : null, ...base, model: m.model, sub: !!m.sub };
    const k = rowKey(r, true);
    let row = rows.get(k);
    if (!row) { row = { ...r, n: 0, in: 0, out: 0, cr: 0, cw: 0, cost: null }; rows.set(k, row); }
    row.n += m.count ?? 1;
    row.in += m.in; row.out += m.out; row.cr += m.cr; row.cw += m.cw;
    if (cost !== null) row.cost = (row.cost ?? 0) + cost;
    if (sessionId !== null) {
      const sk = sessKey(r);
      let sr = sessRows.get(sk);
      if (!sr) { sr = { d, agent: r.agent, where: r.where, box: r.box, project: r.project, ids: new Set() }; sessRows.set(sk, sr); }
      sr.ids.add(sessionId);
    }
  };

  const tops = [];
  const sortedSessions = [...sessions.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const s of sortedSessions) {
    const base = { agent: 'claude', where: s.src.where, box: s.src.box, project: s.project };
    const cs = s.own || null;
    const t = { cost: 0, tok: 0, subTok: 0, models: new Map() };
    const spent = (model, cost, sub, tok) => {
      t.tok += tok;
      if (sub) t.subTok += tok;
      if (cost === null) return;
      t.cost += cost;
      t.models.set(model, (t.models.get(model) || 0) + cost);
    };
    for (const m of s.msgs) {
      const g = s.groups.get(m.model);
      const mu = cs && cs[m.model];
      let cost = null;
      if (mu && typeof mu.costUSD === 'number' && g) cost = g.w > 0 ? (mu.costUSD * weight(m)) / g.w : mu.costUSD / g.n;
      else { const r = rate.get(m.model); if (r && r[1] > 0) cost = (weight(m) * r[0]) / r[1]; }
      add(base, m, cost, s.key);
      spent(m.model, cost, m.sub, tokSum(m));
    }
    // Cost Claude Code counted for a model with no message in the transcripts (title and summary
    // calls): a row with n 0, so the total matches its own figure.
    if (cs) {
      const lastTs = s.msgs.length ? s.msgs.reduce((a, m) => (m.ts > a ? m.ts : a), -Infinity) : Number(s.cs.startTime);
      if (Number.isFinite(lastTs)) for (const [model, mu] of Object.entries(cs)) {
        if (s.groups.has(model) || typeof mu.costUSD !== 'number' || model === '<synthetic>') continue;
        const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
        const m = {
          ts: lastTs, model, sub: false, count: 0,
          in: num(mu.inputTokens), out: num(mu.outputTokens), cr: num(mu.cacheReadInputTokens), cw: num(mu.cacheCreationInputTokens),
        };
        add(base, m, mu.costUSD, null);
        spent(model, mu.costUSD, false, tokSum(m));
      }
    }
    if (s.msgs.length) {
      let first = Infinity;
      let last = -Infinity;
      for (const m of s.msgs) { if (m.ts < first) first = m.ts; if (m.ts > last) last = m.ts; }
      let model = null;
      let most = -1;
      for (const [k, v] of [...t.models].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (v > most) { most = v; model = k; }
      if (model === null) model = s.msgs[0].model;
      tops.push({
        agent: 'claude', sessionId: s.session, project: s.project, where: s.src.where, box: s.src.box, title: s.title,
        first, last, n: s.msgs.length, tok: t.tok, cost: round6(t.cost), model, sub: t.tok > 0 ? Math.round((t.subTok / t.tok) * 1e4) / 1e4 : 0,
      });
    }
  }

  // A Codex session is its thread and the sub-agent threads forked from it (one session_id).
  const xtops = new Map();
  for (const st of xfiles) {
    const meta = st.meta || {};
    const src = meta.source;
    const sub = !!(src && typeof src === 'object' && src.subagent) || meta.thread_source === 'subagent';
    const base = { agent: 'codex', where: st.src.where, box: st.src.box, project: st.src.project || mapProject(st.raw) };
    const sid = `${st.src.id}:${meta.session_id || meta.id || path.basename(st.file, '.jsonl')}`;
    for (const ev of st.events) {
      const b = best.get(ev.fp);
      if (!b || b.ev !== ev) continue;
      const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
      const u = ev.u;
      const input = num(u.input_tokens);
      const cached = Math.min(input, num(u.cached_input_tokens));
      const m = {
        ts: ev.ts, model: ev.model || meta.model || 'unknown', sub,
        in: input - cached, out: num(u.output_tokens), cr: cached, cw: num(u.cache_write_input_tokens),
      };
      add(base, m, null, sid);
      let x = xtops.get(sid);
      if (!x) {
        x = { agent: 'codex', sessionId: meta.session_id || meta.id || path.basename(st.file, '.jsonl'), project: base.project, where: base.where, box: base.box, title: null,
          first: Infinity, last: -Infinity, n: 0, tok: 0, subTok: 0, cost: null, models: new Map() };
        xtops.set(sid, x);
      }
      if (!sub) { x.project = base.project; x.where = base.where; x.box = base.box; }
      const tok = tokSum(m);
      const c = codexCost(m.model, m);
      x.n++; x.tok += tok; if (sub) x.subTok += tok;
      if (c !== null) x.cost = (x.cost ?? 0) + c;
      x.models.set(m.model, (x.models.get(m.model) || 0) + tok);
      if (m.ts < x.first) x.first = m.ts;
      if (m.ts > x.last) x.last = m.ts;
    }
  }
  for (const x of [...xtops.keys()].sort().map((k) => xtops.get(k))) {
    let model = null;
    let most = -1;
    for (const [k, v] of [...x.models].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (v > most) { most = v; model = k; }
    const { models, subTok, ...rest } = x;
    tops.push({ ...rest, model, cost: x.cost === null ? null : round6(x.cost), est: true, sub: x.tok > 0 ? Math.round((subTok / x.tok) * 1e4) / 1e4 : 0 });
  }

  // --- Codex limits: the newest event carrying them, replays of other files' events left out.
  // Every reading of the weekly window, grouped by its reset (codexWindows), is that window's
  // trail: at most one point an hour, and only a rise.
  let codexLimits = null;
  const codexWindows = [];
  {
    const firstFile = new Map(); // fingerprint -> [minTs, file]
    for (const st of xfiles) for (const l of st.limits) {
      const f = firstFile.get(l.fp);
      if (!f || l.ts < f[0]) firstFile.set(l.fp, [l.ts, st.file]);
    }
    let newest = null;
    const weekly = [];
    for (const st of xfiles) for (const l of st.limits) {
      if (firstFile.get(l.fp)[1] !== st.file) continue;
      if (!newest || l.ts > newest.ts) newest = l;
      const w = [l.rl.primary, l.rl.secondary].find((x) => x && typeof x === 'object' && x.window_minutes === CODEX_WEEK_MIN && typeof x.used_percent === 'number' && typeof x.resets_at === 'number');
      if (w) weekly.push([l.ts, w.used_percent, w.resets_at * 1000]);
    }
    weekly.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [ts, pct, resets] of weekly) {
      let win = codexWindows.find((x) => Math.abs(x.resets - resets) <= CODEX_JITTER_MS);
      if (!win) { win = { resets, points: [] }; codexWindows.push(win); }
      win.points.push([ts, pct]);
    }
    for (const win of codexWindows) win.trail = risesHourly(win.points);
    if (newest) {
      const w = (p) => (p && typeof p === 'object' ? {
        pct: typeof p.used_percent === 'number' ? p.used_percent : null,
        windowMinutes: typeof p.window_minutes === 'number' ? p.window_minutes : null,
        resets: typeof p.resets_at === 'number' ? p.resets_at * 1000 : null,
      } : null);
      codexLimits = { at: newest.ts, plan: newest.rl.plan_type ?? null, primary: w(newest.rl.primary), secondary: w(newest.rl.secondary) };
      const wk = [codexLimits.primary, codexLimits.secondary].find((x) => x && x.windowMinutes === CODEX_WEEK_MIN && x.resets !== null && x.pct !== null);
      const win = wk ? codexWindows.find((x) => Math.abs(x.resets - wk.resets) <= CODEX_JITTER_MS) : null;
      if (wk && win) {
        codexLimits.week = { pct: Math.max(wk.pct, ...win.trail.map((x) => x[1])), resets: wk.resets, trail: win.trail };
        win.current = true;
      }
      codexLimits.weeks = [];
    }
  }

  const outRows = [...rows.values()].map((r) => ({ ...r, cost: r.cost === null ? null : round6(r.cost) }));
  const outSess = [...sessRows.values()].map(({ ids, ...r }) => ({ ...r, n: ids.size }));
  const topFrom = now - TOP_DAYS * 86400000;
  const top = tops.filter((x) => x.last >= topFrom).sort((a, b) => b.tok - a.tok || (a.sessionId < b.sessionId ? -1 : 1)).slice(0, TOP_MOST);
  const punchOut = [...punch.values()].filter((p) => p.n > 0).sort((a, b) => a.dow - b.dow || a.h - b.h).map((p) => ({ ...p, cost: round6(p.cost) }));
  let punchDays = 0;
  if (firstDay !== null) for (let d = firstDay < punchFrom ? punchFrom : firstDay; d <= today; d = dayShift(d, 1)) punchDays++;
  // Only projects with a reply in the last hour, the costliest first.
  const recentOut = [...recent.values()].filter((x) => x.n60 > 0)
    .map((x) => ({ ...x, cost15: round6(x.cost15), cost60: round6(x.cost60) }))
    .sort((a, b) => b.tok60 - a.tok60 || b.n60 - a.n60 || (a.project < b.project ? -1 : 1));
  return { rows: outRows, sessions: outSess, codexLimits, codexWindows, today, hourlyFrom, top, punch: punchOut, punchDays, recent: recentOut };
}

// ---------------------------------------------------------------- limits and history

function claudeLimits(home) {
  const p = path.join(home, '.claude', 'statusline', '.usage-cache.json');
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const c = readJson(p);
  if (!c || typeof c !== 'object') return null;
  const ms = (x) => { if (x === null || x === undefined) return null; const t = typeof x === 'number' ? x : Date.parse(x); return Number.isFinite(t) ? t : null; };
  const fiveHour = typeof c.fiveHour === 'number' ? { pct: c.fiveHour, resets: ms(c.fiveHourResets) } : null;
  let week = null;
  if (typeof c.sevenDay === 'number') {
    const resets = ms(c.sevenDayResets);
    const w = c.week && typeof c.week === 'object' ? c.week : null;
    const samples = w && Array.isArray(w.samples) && ms(w.resets) === resets ? w.samples : [];
    // Every session's statusline writes this file with the reading of its own last reply, so an idle
    // session puts an older, lower one back. Inside one window the reading only rises: take the
    // highest the statusline has seen in it (`peak`, its samples), as the statusline's burst does.
    const same = w && ms(w.resets) === resets;
    const seen = [c.sevenDay, same && typeof w.peak === 'number' ? w.peak : 0, ...samples.map((x) => (Array.isArray(x) && typeof x[1] === 'number' ? x[1] : 0))];
    week = { pct: Math.max(...seen), resets, samples, trail: [] };
  }
  return { at: Math.round(st.mtimeMs), fiveHour, week, weeks: [] };
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function withLock(dir, fn) {
  const lock = path.join(dir, '.lock');
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      } catch {}
      if (Date.now() - start > LOCK_WAIT) throw new Error(`the state folder stays locked: ${lock}`);
      sleep(20 + Math.random() * 40);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function writeAtomic(file, value) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw e;
  }
}

function readState(file, empty) {
  if (!exists(file)) return empty();
  const v = readJson(file);
  if (v && typeof v === 'object' && v.v === STATE_V) return v;
  // Unreadable: kept aside, never overwritten.
  const aside = `${file}.corrupt-${Date.now()}`;
  try { fs.renameSync(file, aside); } catch {}
  process.stderr.write(`collect: ${file} could not be read; kept as ${aside}\n`);
  return empty();
}

const bigger = (a, b) => a.n > b.n || (a.n === b.n && a.in + a.out + a.cr + a.cw > b.in + b.out + b.cr + b.cw);

// Merges settled days into history and returns rows and sessions to show.
function history(stateDir, res, limits, codex) {
  const settled = dayShift(res.today, -SETTLED_DAYS);
  const daily = new Map();
  for (const r of res.rows) {
    if (r.d > settled) continue;
    const k = rowKey(r, false);
    let d = daily.get(k);
    if (!d) { d = { ...r, h: null, n: 0, in: 0, out: 0, cr: 0, cw: 0, cost: null }; daily.set(k, d); }
    d.n += r.n; d.in += r.in; d.out += r.out; d.cr += r.cr; d.cw += r.cw;
    if (r.cost !== null) d.cost = round6((d.cost ?? 0) + r.cost);
  }
  const sess = res.sessions.filter((s) => s.d <= settled);

  let rowsOut = null;
  let sessOut = null;
  fs.mkdirSync(stateDir, { recursive: true });
  withLock(stateDir, () => {
    const hfile = path.join(stateDir, 'history.json');
    const h = readState(hfile, () => ({ v: STATE_V, rows: [], sessions: [] }));
    const hr = new Map();
    for (const r of h.rows || []) hr.set(rowKey(r, false), r);
    let changed = !exists(hfile);
    for (const [k, r] of daily) { const s = hr.get(k); if (!s || bigger(r, s)) { hr.set(k, r); changed = true; } }
    const hs = new Map();
    for (const s of h.sessions || []) hs.set(sessKey(s), s);
    for (const s of sess) { const k = sessKey(s); const o = hs.get(k); if (!o || s.n > o.n) { hs.set(k, s); changed = true; } }
    if (changed) writeAtomic(hfile, { v: STATE_V, rows: [...hr.values()], sessions: [...hs.values()] });

    // Older days come from history (the larger of stored and scanned), recent ones from the scan.
    rowsOut = res.rows.filter((r) => r.d >= res.hourlyFrom);
    for (const r of hr.values()) if (r.d < res.hourlyFrom) rowsOut.push(r);
    sessOut = res.sessions.filter((s) => s.d >= res.hourlyFrom);
    for (const s of hs.values()) if (s.d < res.hourlyFrom) sessOut.push(s);

    const lfile = path.join(stateDir, 'limits.json');
    const l = readState(lfile, () => ({ v: STATE_V, claudeWeeks: {}, codexWeeks: {} }));
    const weeks = l.claudeWeeks && typeof l.claudeWeeks === 'object' ? l.claudeWeeks : {};
    const xweeks = l.codexWeeks && typeof l.codexWeeks === 'object' ? l.codexWeeks : {};
    let lchanged = false;
    // Codex: every window the transcripts still hold joins the one kept under a reset close to
    // its own; the trail is worked out again from both.
    let xkey = null;
    for (const win of res.codexWindows || []) {
      const k = Object.keys(xweeks).find((x) => Math.abs(Number(x) - win.resets) <= CODEX_JITTER_MS) ?? String(win.resets);
      const old = Array.isArray(xweeks[k]) ? xweeks[k] : [];
      const trail = risesHourly([...old, ...win.trail]);
      if (JSON.stringify(trail) !== JSON.stringify(old)) { xweeks[k] = trail; lchanged = true; }
      if (win.current) xkey = k;
    }
    const xkeys = Object.keys(xweeks).sort((a, b) => Number(a) - Number(b));
    while (xkeys.length > TRAIL_WEEKS) { delete xweeks[xkeys.shift()]; lchanged = true; }
    if (codex) {
      if (codex.week && xkey !== null && xweeks[xkey]) {
        codex.week.trail = xweeks[xkey];
        codex.week.pct = Math.max(codex.week.pct, ...xweeks[xkey].map((x) => x[1]));
      }
      codex.weeks = earlierWeeks(xweeks, xkey);
    }
    let key = null;
    {
      if (limits && limits.week && limits.week.resets !== null) {
        key = String(limits.week.resets);
        const trail = Array.isArray(weeks[key]) ? weeks[key] : [];
        const last = trail[trail.length - 1];
        // Only a rise is a new reading (see claudeLimits); a lower one is a stale session's.
        if (!last || (limits.week.pct > last[1] && limits.at > last[0])) { trail.push([limits.at, limits.week.pct]); lchanged = true; }
        else if (last[1] > limits.week.pct) limits.week.pct = last[1];
        weeks[key] = trail;
      }
      const keys = Object.keys(weeks).sort((a, b) => Number(a) - Number(b));
      while (keys.length > TRAIL_WEEKS) { delete weeks[keys.shift()]; lchanged = true; }
      if (key !== null && limits) limits.week.trail = weeks[key];
      // The earlier windows, newest first: the highest reading each reached.
      if (limits) limits.weeks = earlierWeeks(weeks, key);
    }
    if (lchanged || ((key !== null || xkey !== null) && !exists(lfile))) writeAtomic(lfile, { v: STATE_V, claudeWeeks: weeks, codexWeeks: xweeks });
  });
  return { rows: rowsOut, sessions: sessOut };
}

// ---------------------------------------------------------------- main

function cmp(a, b) {
  const ka = [a.d, a.h ?? -1, a.agent, a.where, a.box ?? '', a.project, a.model ?? '', a.sub ? 1 : 0];
  const kb = [b.d, b.h ?? -1, b.agent, b.where, b.box ?? '', b.project, b.model ?? '', b.sub ? 1 : 0];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

const HELP = `usage: node collect.mjs [--home <dir>] [--state <dir> | --no-state] [--no-rg] [--now <ms>] [--docker-timeout <ms>] [--pretty]\n`;

async function main(argv) {
  const t0 = Date.now();
  const opt = parseArgs(argv);
  if (opt.help) { process.stdout.write(HELP); return; }
  const home = opt.home ? path.resolve(opt.home) : os.homedir();
  const now = opt.now ?? Date.now();
  const stateDir = opt.state === null ? null : opt.state ? path.resolve(opt.state) : path.join(home, '.local', 'state', 'herdr-usage');

  const sources = findSources(home);
  const col = new Collector();
  const useRg = opt.rg && hasRg();
  const containers = readContainers(stateDir, opt.dockerTimeout); // runs while the host is scanned
  if (useRg) {
    const owner = (file) => sources.find((s) => s.roots.some((r) => file.startsWith(r + path.sep)));
    const run = (agent, needles) => {
      const roots = sources.filter((s) => s.agent === agent).flatMap((s) => s.roots);
      if (!roots.length) return Promise.resolve();
      let lastFile = null;
      let lastSrc = null;
      return rgScan(roots, needles, (file, line) => {
        if (file !== lastFile) { lastFile = file; lastSrc = owner(file); }
        if (lastSrc) col.line(lastSrc, file, line);
      });
    };
    await Promise.all([run('claude', CLAUDE_NEEDLES), run('codex', CODEX_NEEDLES)]);
  } else {
    await containers; // the scan below blocks: docker's timeouts would fire late, and wrongly
    for (const s of sources) {
      const needles = (s.agent === 'claude' ? CLAUDE_NEEDLES : CODEX_NEEDLES).map((n) => Buffer.from(n));
      for (const f of s.files) scanFile(f, needles, (line) => col.line(s, f, line));
    }
  }
  const dk = await containers;
  for (const s of dk.sources) {
    s.id = sources.length;
    sources.push(s);
    for (const f of s.files) {
      const e = s.data.get(f);
      if (s.agent === 'claude') col.heads.set(f, e.cwd);
      for (const line of e.lines) col.line(s, f, line);
    }
  }

  const res = finish(col, sources, home, now);
  const limits = claudeLimits(home);
  const codex = res.codexLimits;
  if (codex) codex.weeks = earlierWeeks(Object.fromEntries(res.codexWindows.slice(-TRAIL_WEEKS).map((w) => [String(w.resets), w.trail])), codex.week ? String(res.codexWindows.find((w) => w.current).resets) : null);
  let rows = res.rows;
  let sessions = res.sessions;
  if (stateDir) {
    try { ({ rows, sessions } = history(stateDir, res, limits, codex)); } catch (e) {
      process.stderr.write(`collect: history not kept: ${e.message}\n`);
    }
  }
  // Codex's estimates, from history's rows too, never kept there.
  rows = rows.map((r) => {
    if (r.agent !== 'codex') return r;
    const c = codexCost(r.model, r);
    return { ...r, cost: c === null ? null : round6(c), est: true };
  });
  rows.sort(cmp);
  sessions.sort(cmp);

  const firstClaude = rows.reduce((m, r) => (r.agent === 'claude' && (m === null || r.d < m) ? r.d : m), null);
  const stats = readJson(path.join(home, '.claude', 'stats-cache.json'));
  const before = (x) => x && typeof x.date === 'string' && (firstClaude === null || x.date < firstClaude);
  const older = {
    activity: stats && Array.isArray(stats.dailyActivity) ? stats.dailyActivity.filter(before) : [],
    tokens: stats && Array.isArray(stats.dailyModelTokens) ? stats.dailyModelTokens.filter(before) : [],
  };

  const doc = {
    v: V,
    at: now,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    took: {
      ms: Date.now() - t0,
      via: useRg ? 'rg' : 'node',
      files: sources.reduce((a, s) => a + s.files.length, 0),
      bytes: sources.reduce((a, s) => a + s.bytes, 0),
      lines: col.lines,
      bad: col.bad,
      sources: [
        ...sources.filter((s) => s.files.length).map((s) => ({ agent: s.agent, where: s.where, box: s.box, files: s.files.length, bytes: s.bytes, ...(s.via ? { via: s.via } : {}) })),
        ...dk.entries,
      ],
      // "ok", "absent" (no docker on PATH), "timeout", or the first line of docker's error
      docker: dk.status,
      dockerMs: dk.ms,
    },
    limits: { claude: limits, codex },
    rows,
    sessions,
    older,
    top: res.top,
    punch: res.punch,
    punchDays: res.punchDays,
    recent: res.recent,
  };
  process.stdout.write(JSON.stringify(doc, null, opt.pretty ? 1 : 0) + '\n');
}

const evalMode = /\[eval\d*\]$/.test(import.meta.url);
main(process.argv.slice(evalMode ? 1 : 2)).catch((e) => {
  process.stderr.write(`collect: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
