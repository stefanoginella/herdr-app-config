// node --test collect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'collect.mjs');
const NOW = Date.parse('2026-11-24T12:00:00Z'); // 13:00 in Rome: today is 2026-11-24
const TZ = 'Europe/Rome';
const HAS_RG = spawnSync('rg', ['--version']).status === 0;
const EMPTY_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-nopath-'));

// A fake `docker`: answers ps, inspect, cp and exec (find, tar) from $FAKE_DOCKER_ROOT, where
// containers.json describes the containers and <id>/fs holds each one's files. Every call is
// logged to $FAKE_DOCKER_ROOT/log. FAKE_DOCKER_HANG makes it never answer.
const FAKE_BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-fakebin-'));
fs.writeFileSync(path.join(FAKE_BIN, 'docker'), `#!${process.execPath}
const fs = require('fs'), path = require('path');
const R = process.env.FAKE_DOCKER_ROOT || '/nonexistent';
const args = process.argv.slice(2);
if (process.env.FAKE_DOCKER_HANG) { setInterval(() => {}, 1000); return; }
try { fs.appendFileSync(path.join(R, 'log'), JSON.stringify(args) + '\\n'); } catch {}
let cs = [];
try { cs = JSON.parse(fs.readFileSync(path.join(R, 'containers.json'), 'utf8')); } catch {}
const byId = (id) => cs.find((c) => c.id === id || c.id.startsWith(id));
const die = (msg, code = 1) => { process.stderr.write(msg + '\\n'); process.exit(code); };
function block(name, size, mtime, type) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write('0000644\\0', 100); h.write('0001750\\0', 108); h.write('0001750\\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\\0', 124);
  h.write(Math.floor(mtime).toString(8).padStart(11, '0') + '\\0', 136);
  h.write('        ', 148); h.write(type, 156); h.write('ustar\\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\\0 ', 148);
  return h;
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
function entry(name, data, mtime, type = '0') {
  const out = [];
  if (Buffer.byteLength(name) > 99) {
    let rec = ' path=' + name + '\\n', len = rec.length;
    while (String(len).length + rec.length !== len) len = String(len).length + rec.length;
    const pax = Buffer.from(len + rec);
    out.push(block('PaxHeader', pax.length, mtime, 'x'), pad(pax));
    name = name.slice(-90);
  }
  out.push(block(name, data.length, mtime, type));
  if (data.length) out.push(pad(data));
  return out;
}
function tar(base, rels, prefix) {
  const out = [];
  if (prefix) out.push(...entry(prefix + '/', Buffer.alloc(0), 1795000000, '5'), ...entry(prefix + '/link', Buffer.alloc(0), 1795000000, '2'));
  for (const rel of rels) {
    const f = path.join(base, rel);
    const st = fs.statSync(f);
    out.push(...entry((prefix ? prefix + '/' : '') + rel, fs.readFileSync(f), st.mtimeMs / 1000));
  }
  out.push(Buffer.alloc(1024));
  process.stdout.write(Buffer.concat(out));
}
function walk(d, rel = '', out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r, out); else out.push(r);
  }
  return out;
}
const fsOf = (c, p) => path.join(R, c.id, 'fs', p);
const cmd = args[0];
if (cmd === 'ps') { for (const c of cs) if (c.labels['devcontainer.local_folder']) process.stdout.write(c.id + '\\n'); process.exit(0); }
if (cmd === 'inspect') {
  process.stdout.write(JSON.stringify(args.slice(1).map(byId).filter(Boolean).map((c) => ({
    Id: c.id, Name: '/' + c.name, Config: { Env: c.env || [], User: c.user || '', Labels: c.labels },
    State: { Status: c.running ? 'running' : 'exited', Running: !!c.running, FinishedAt: c.finished || '0001-01-01T00:00:00Z' } }))));
  process.exit(0);
}
if (cmd === 'cp') {
  const src = args.slice(1).find((a) => a.includes(':'));
  const [id, p] = src.split(':');
  const c = byId(id);
  if (!c) die('Error response from daemon: No such container: ' + id);
  if (c.broken) die('Error response from daemon: boom\\nmore');
  const dir = fsOf(c, p);
  if (!fs.existsSync(dir)) die('Error response from daemon: Could not find the file ' + p + ' in container ' + c.name);
  tar(dir, walk(dir).sort(), path.posix.basename(p));
  process.exit(0);
}
if (cmd === 'exec') {
  let i = 1;
  while (args[i].startsWith('-')) i += args[i] === '-w' ? 2 : 1;
  const c = byId(args[i]);
  const rest = args.slice(i + 1);
  if (!c) die('Error response from daemon: No such container');
  if (!c.running) die('Error response from daemon: container ' + c.id + ' is not running');
  if (c.noexec) die('OCI runtime exec failed: exec failed: unable to start container process', 126);
  if (rest[0] === 'find') {
    let rc = 0;
    for (const d of rest.slice(1)) {
      if (d.startsWith('-')) break;
      const dir = fsOf(c, d);
      if (!fs.existsSync(dir)) { process.stderr.write("find: '" + d + "': No such file or directory\\n"); rc = 1; continue; }
      for (const rel of walk(dir).filter((r) => r.endsWith('.jsonl'))) {
        const st = fs.statSync(path.join(dir, rel));
        process.stdout.write([d, st.size, (st.mtimeMs / 1000).toFixed(6), rel].join('\\t') + '\\n');
      }
    }
    process.exit(rc);
  }
  if (rest[0] === 'tar') { const j = rest.indexOf('-C'); const k = rest.indexOf('--'); tar(fsOf(c, rest[j + 1]), rest.slice(k + 1), null); process.exit(0); }
  die('exec: unknown ' + rest[0], 127);
}
die('unknown command ' + cmd, 125);
`, { mode: 0o755 });

// ------------------------------------------------------------------ fixture

const jl = (...objs) => objs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + '\n';
function put(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }

function usage(u) {
  return {
    input_tokens: u.in ?? 0, output_tokens: u.out ?? 0, cache_read_input_tokens: u.cr ?? 0,
    cache_creation_input_tokens: u.cw ?? 0,
    ...(u.cw1h !== undefined ? { cache_creation: { ephemeral_5m_input_tokens: (u.cw ?? 0) - u.cw1h, ephemeral_1h_input_tokens: u.cw1h } } : {}),
  };
}
function asst(session, id, ts, model, u, extra = {}) {
  return { type: 'assistant', timestamp: ts, cwd: extra.cwd ?? '/somewhere', sessionId: session, isSidechain: !!extra.side, requestId: 'req_' + id,
    message: { id, model, usage: usage(u), content: [{ type: 'text', text: 'hi "usage":{ inside text' }] } };
}
function costState(session, total, startTime, models) {
  return { type: 'cost-state', sessionId: session, totalCostUSD: total, startTime, modelUsage: models };
}
const mu = (cost, t = {}) => ({ inputTokens: t.in ?? 0, outputTokens: t.out ?? 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: cost });

// usage of each message, for the expected weights
const M = {
  m1: { in: 100, out: 20, cr: 1000, cw: 200, cw1h: 150 },
  m2: { in: 10, out: 5 },
  m3: { out: 100 },
  m4: { in: 1, out: 2 },
  m5: { out: 10 },
  m6: { in: 1, out: 1 },
  m7: { in: 50, out: 50 },
  m8: { in: 20, out: 20, cw: 100 }, // no split: counts as 5m
  m9: { in: 5, out: 5 },
  m10: { in: 3, out: 3 },
  m12: { in: 2, out: 2 },
  m13: { in: 1, out: 6 },
};
const weight = (u) => {
  const cw = u.cw ?? 0;
  const cw1h = u.cw1h ?? 0;
  return (u.in ?? 0) + 5 * (u.out ?? 0) + 0.1 * (u.cr ?? 0) + 1.25 * (cw - cw1h) + 2 * cw1h;
};

const STATUS = (pct) => JSON.stringify({
  fiveHour: null, fiveHourResets: null, sevenDay: pct, sevenDayResets: '2026-11-29T05:00:00.000Z',
  week: { resets: '2026-11-29T05:00:00.000Z', peak: pct, samples: [[1795500000000, 55], [1795510000000, pct]] },
});

function tokenCount(ts, total, last, rl) {
  return { timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: total === null ? null : {
    total_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: total }, last_token_usage: last }, rate_limits: rl ?? null } };
}
const RL = (pct, extra = {}) => ({ primary: { used_percent: pct, window_minutes: 10080, resets_at: 1795969395 }, secondary: null, plan_type: 'prolite', ...extra });

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-home-'));
  const P = path.join(home, '.claude', 'projects');
  const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';
  put(path.join(P, '-fixtures-u-proj', `${S1}.jsonl`), jl(
    { type: 'mode', cwd: null, sessionId: S1 },
    { type: 'user', cwd: '/fixtures/u/proj', sessionId: S1, timestamp: '2026-11-24T08:59:00Z', message: { role: 'user', content: 'go' } },
    asst(S1, 'm1', '2026-11-24T09:00:00Z', 'claude-opus-5-5', { ...M.m1, out: 10 }, { cwd: '/fixtures/u/proj/sub' }), // streaming: first part
    asst(S1, 'm1', '2026-11-24T09:00:01Z', 'claude-opus-5-5', M.m1, { cwd: '/fixtures/u/proj/sub' }),
    asst(S1, 'm2', '2026-11-23T23:30:00Z', 'claude-opus-5-5', M.m2), // 00:30 in Rome: day 2026-11-24, hour 0
    asst(S1, 'syn', '2026-11-24T09:01:00Z', '<synthetic>', {}),
    '{"type":"assistant","message":{"usage":{"input_tokens": 3', // cut short: unparseable
    costState(S1, 0.5, 1000, { 'claude-opus-5-5': mu(0.5) }),
    costState(S1, 1.25, 1000, { 'claude-opus-5-5': mu(1.0), 'claude-haiku-5-5': mu(0.25, { in: 7, out: 3 }) }),
    { type: 'ai-title', aiTitle: 'First title', sessionId: S1 },
    { type: 'ai-title', aiTitle: 'Fix the login', sessionId: S1 },
  ));
  put(path.join(P, '-fixtures-u-proj', S1, 'subagents', 'agent-a1.jsonl'), jl(
    asst(S1, 'm3', '2026-11-24T10:00:00Z', 'claude-opus-5-5', M.m3, { side: true, cwd: '/fixtures/u/proj' }),
    asst(S1, 'm4', '2026-11-24T10:05:00Z', 'claude-sonnet-5-5', M.m4, { side: true, cwd: '/fixtures/u/proj' }),
  ));
  // A worktree session that resumed S1 (carries a copy of m2) and goes on.
  const S2 = 'aaaaaaaa-0000-0000-0000-000000000002';
  put(path.join(P, '-fixtures-u-proj--claude-worktrees-feat', `${S2}.jsonl`), jl(
    { type: 'user', cwd: '/fixtures/u/proj/.claude/worktrees/feat', sessionId: S2, timestamp: '2026-11-24T10:59:00Z' },
    asst(S2, 'm2', '2026-11-23T23:30:00Z', 'claude-opus-5-5', M.m2),
    asst(S2, 'm5', '2026-11-24T11:00:00Z', 'claude-opus-5-5', M.m5),
  ));
  // An old day, deleted later in the history test.
  const S3 = 'aaaaaaaa-0000-0000-0000-000000000003';
  put(path.join(P, '-fixtures-u-old', `${S3}.jsonl`), jl(
    { type: 'user', cwd: '/fixtures/u/old', sessionId: S3, timestamp: '2026-11-10T11:59:00Z' },
    asst(S3, 'm6', '2026-11-10T12:00:00Z', 'claude-opus-5-5', M.m6),
    costState(S3, 0.01, 2000, { 'claude-opus-5-5': mu(0.01) }),
  ));
  // A resume chain: S5 goes on from S4, and its cost-state counts S4's too.
  const S4 = 'aaaaaaaa-0000-0000-0000-000000000004';
  const S5 = 'aaaaaaaa-0000-0000-0000-000000000005';
  put(path.join(P, '-fixtures-u-chain', `${S4}.jsonl`), jl(
    { type: 'user', cwd: '/fixtures/u/chain', sessionId: S4, timestamp: '2026-11-21T07:59:00Z' },
    asst(S4, 'm7', '2026-11-21T08:00:00Z', 'claude-opus-5-5', M.m7),
    costState(S4, 1.0, 3000, { 'claude-opus-5-5': mu(1.0) }),
  ));
  put(path.join(P, '-fixtures-u-chain', `${S5}.jsonl`), jl(
    { type: 'user', cwd: '/fixtures/u/chain', sessionId: S5, timestamp: '2026-11-21T08:59:00Z' },
    asst(S5, 'm7', '2026-11-21T08:00:00Z', 'claude-opus-5-5', M.m7),
    asst(S5, 'm8', '2026-11-21T09:00:00Z', 'claude-opus-5-5', M.m8),
    costState(S5, 1.5, 3000, { 'claude-opus-5-5': mu(1.5) }),
  ));
  // A Herdr worktree of proj.
  const S6 = 'aaaaaaaa-0000-0000-0000-000000000006';
  put(path.join(P, '-x-herdr-worktrees-proj-feat-x', `${S6}.jsonl`), jl(
    { type: 'user', cwd: path.join(home, '.herdr', 'worktrees', 'proj', 'feat-x'), sessionId: S6, timestamp: '2026-11-20T07:59:00Z' },
    asst(S6, 'm9', '2026-11-20T08:00:00Z', 'claude-opus-5-5', M.m9),
  ));

  // Codex
  const C = path.join(home, '.codex', 'sessions', '2026', '11');
  const e1 = { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 };
  const e2 = { input_tokens: 110, cached_input_tokens: 100, cache_write_input_tokens: 3, output_tokens: 10, total_tokens: 120 };
  const e3 = { input_tokens: 60, cached_input_tokens: 0, output_tokens: 10, total_tokens: 70 };
  put(path.join(C, '20', 'rollout-2026-11-20T10-00-00-A.jsonl'), jl(
    { timestamp: '2026-11-20T09:00:00Z', type: 'session_meta', payload: { id: 'A', session_id: 'A', cwd: '/fixtures/u/proj', source: 'cli', base_instructions: { text: 'x' } } },
    { timestamp: '2026-11-20T09:00:00Z', type: 'turn_context', payload: { cwd: '/fixtures/u/proj', model: 'gpt-x' } },
    tokenCount('2026-11-20T09:00:30Z', null, null, RL(4)),
    tokenCount('2026-11-20T09:01:00Z', 110, e1, RL(5)),
    tokenCount('2026-11-20T09:02:00Z', 110, e1, RL(6)), // same total: a repeat, but its limits count
    tokenCount('2026-11-20T09:03:00Z', 230, e2, RL(6)),
    '{"timestamp":"2026-11-20T09:04:00Z","type":"event_msg","payload":{"type":"token_count","info":', // cut short
  ));
  // A forked sub-agent thread: replays A's events at fork time, then its own.
  put(path.join(C, '21', 'rollout-2026-11-21T11-00-00-B.jsonl'), jl(
    { timestamp: '2026-11-21T10:00:00Z', type: 'session_meta', payload: { id: 'B', session_id: 'A', forked_from_id: 'A', cwd: '/fixtures/u/proj', source: { subagent: { thread_spawn: { parent_thread_id: 'A' } } }, thread_source: 'subagent' } },
    { timestamp: '2026-11-21T10:00:00Z', type: 'turn_context', payload: { cwd: '/fixtures/u/proj', model: 'gpt-x' } },
    { ...tokenCount('2026-11-21T10:00:00Z', 110, e1, RL(5)), timestamp: '2026-11-21T10:00:00Z' },
    { ...tokenCount('2026-11-21T10:00:00Z', 230, e2, RL(6)), timestamp: '2026-11-21T10:00:00Z' },
    { timestamp: '2026-11-21T10:01:00Z', type: 'turn_context', payload: { cwd: '/fixtures/u/proj', model: 'gpt-y' } },
    tokenCount('2026-11-21T10:05:00Z', 300, e3, RL(9, { plan_type: 'pro', secondary: { used_percent: 20, window_minutes: 300, resets_at: 1795600000 } })),
  ));

  // Dev containers, behind the fake docker
  const D = path.join(home, '.fake-docker');
  const cid = (n) => String(n).repeat(64);
  const containers = [
    { id: cid(1), name: 'box-1', running: false, finished: '2026-11-24T09:30:00.123Z', user: 'vscode', env: ['CLAUDE_CONFIG_DIR=/home/vscode/.claude'],
      labels: { 'devcontainer.local_folder': '/fixtures/u/boxproj' } },
    { id: cid(2), name: 'run-1', running: true, user: '', labels: { 'devcontainer.local_folder': '/fixtures/u/runbox', 'devcontainer.metadata': JSON.stringify([{ id: 'x' }, { remoteUser: 'dev' }]) } },
    { id: cid(3), name: 'noexec-1', running: true, noexec: true, user: 'root', labels: { 'devcontainer.local_folder': '/fixtures/u/noexec' } },
    { id: cid(4), name: 'broken-1', running: false, broken: true, finished: '2026-11-01T00:00:00Z', labels: { 'devcontainer.local_folder': '/fixtures/u/broken' } },
    { id: cid(5), name: 'not-a-devcontainer', running: true, labels: {} },
  ];
  put(path.join(D, 'containers.json'), JSON.stringify(containers));
  const S7 = 'aaaaaaaa-0000-0000-0000-000000000007';
  const long = '-workspace-' + 'x'.repeat(100); // a path over 100 bytes takes a pax header
  put(path.join(D, cid(1), 'fs', 'home/vscode/.claude/projects', long, `${S7}.jsonl`), jl(
    { type: 'user', cwd: '/workspace', sessionId: S7, timestamp: '2026-11-24T07:59:00Z' },
    asst(S7, 'm10', '2026-11-24T08:00:00Z', 'claude-opus-5-5', M.m10, { cwd: '/workspace' }),
  ));
  put(path.join(D, cid(1), 'fs', 'home/vscode/.aic-sessions/tool-homes/codex/sessions/2026/11/24/rollout-x.jsonl'), jl(
    { timestamp: '2026-11-24T08:00:00Z', type: 'session_meta', payload: { id: 'X', cwd: '/workspace', source: 'vscode', base_instructions: { text: 'long' } } },
    { timestamp: '2026-11-24T08:00:00Z', type: 'turn_context', payload: { cwd: '/workspace', model: 'gpt-z', instructions: 'long' } },
    tokenCount('2026-11-24T08:01:00Z', 15, { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5, total_tokens: 15 }),
  ));
  const S9 = 'aaaaaaaa-0000-0000-0000-000000000009';
  const f9 = path.join(D, cid(2), 'fs', 'home/dev/.claude/projects/-workspace', `${S9}.jsonl`);
  put(f9, jl(
    { type: 'user', cwd: '/workspace', sessionId: S9, timestamp: '2026-11-24T06:59:00Z' },
    asst(S9, 'm12', '2026-11-24T07:00:00Z', 'claude-opus-5-5', M.m12, { cwd: '/workspace' }),
  ));
  put(path.join(D, cid(2), 'fs', 'home/dev/.claude/projects/-workspace', 'aaaaaaaa-0000-0000-0000-00000000000b.jsonl'), jl(
    { type: 'user', cwd: '/workspace', sessionId: 'b', timestamp: '2026-11-24T06:59:00Z' },
  ));
  const S10 = 'aaaaaaaa-0000-0000-0000-000000000010';
  put(path.join(D, cid(3), 'fs', 'root/.claude/projects/-workspace', `${S10}.jsonl`), jl(
    { type: 'user', cwd: '/workspace', sessionId: S10, timestamp: '2026-11-24T05:59:00Z' },
    asst(S10, 'm13', '2026-11-24T06:00:00Z', 'claude-opus-5-5', M.m13, { cwd: '/workspace' }),
  ));

  // Limits and stats
  const cache = path.join(home, '.claude', 'statusline', '.usage-cache.json');
  put(cache, STATUS(58));
  fs.utimesSync(cache, new Date(1795520000000), new Date(1795520000000));
  put(path.join(home, '.claude', 'stats-cache.json'), JSON.stringify({
    dailyActivity: [{ date: '2026-11-01', messageCount: 5, sessionCount: 1, toolCallCount: 2 }, { date: '2026-11-15', messageCount: 9, sessionCount: 2, toolCallCount: 3 }],
    dailyModelTokens: [{ date: '2026-11-01', tokensByModel: { 'claude-opus-5-5': 100 } }, { date: '2026-11-15', tokensByModel: { 'claude-opus-5-5': 200 } }],
  }));
  return { home, P, S1, S3, cache, D, f9, cid };
}

// ------------------------------------------------------------------ running

function argsFor(mode, home, extra) {
  const flags = ['--home', home, '--now', String(NOW), ...extra];
  if (mode === 'eval') return ['--input-type=module', '-e', fs.readFileSync(SCRIPT, 'utf8'), '--', ...flags];
  return [SCRIPT, ...flags, ...(mode === 'norg' ? ['--no-rg'] : [])];
}
const envFor = (home, env) => ({ ...process.env, TZ, PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}`, FAKE_DOCKER_ROOT: path.join(home, '.fake-docker'), ...env });
function run(home, extra = [], mode = 'file', env = {}) {
  const r = spawnSync(process.execPath, argsFor(mode, home, extra), { env: envFor(home, env), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  assert.equal(r.stderr, '');
  return JSON.parse(r.stdout);
}
function runAsync(home, extra) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, argsFor('file', home, extra), { env: envFor(home, {}) });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${code}: ${err}`))));
  });
}
const stable = (doc) => { const d = structuredClone(doc); delete d.took.ms; delete d.took.via; delete d.took.dockerMs; return d; };
const dockerLog = (h) => { const f = path.join(h.D, 'log'); const l = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : []; fs.rmSync(f, { force: true }); return l; };
const pick = (rows, f) => rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
const total = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 2e-6, `${msg}: ${a} != ${b}`);

const fx = makeHome();
const base = run(fx.home, ['--no-state']);

// ------------------------------------------------------------------ tests

test('ripgrep, plain Node, no rg on PATH and the -e form give the same document', () => {
  const norg = run(fx.home, ['--no-state'], 'norg');
  const nopath = run(fx.home, ['--no-state'], 'file', { PATH: FAKE_BIN }); // docker but no rg
  const evalForm = run(fx.home, ['--no-state'], 'eval');
  assert.equal(norg.took.via, 'node');
  assert.equal(nopath.took.via, 'node');
  if (HAS_RG) assert.equal(base.took.via, 'rg');
  assert.deepEqual(stable(norg), stable(base));
  assert.deepEqual(stable(nopath), stable(base));
  assert.deepEqual(stable(evalForm), stable(base));
});

test('document shape', () => {
  assert.equal(base.v, 3);
  assert.equal(base.at, NOW);
  assert.equal(base.tz, TZ);
  assert.equal(base.took.bad, 2);
  assert.equal(base.took.files, 14);
  assert.equal(base.took.docker, 'ok');
  assert.ok(base.took.bytes > 0);
  for (const r of base.rows) for (const k of ['d', 'h', 'agent', 'where', 'box', 'project', 'model', 'sub', 'n', 'in', 'out', 'cr', 'cw', 'cost']) assert.ok(k in r, k);
  for (const r of base.rows) assert.equal(r.est, r.agent === 'codex' ? true : undefined);
});

test('Claude messages: deduped, synthetic skipped, sub-agents flagged', () => {
  const cl = pick(base.rows, { agent: 'claude' });
  assert.equal(total(cl, 'n'), 12); // m1..m13 but m11, m2 and m7 once each
  assert.equal(total(pick(cl, { sub: true }), 'n'), 2);
  assert.equal(total(cl, 'out'), [...Object.values(M)].reduce((a, u) => a + (u.out ?? 0), 0) + 3); // + haiku's cost-only row
  assert.equal(pick(cl, { model: '<synthetic>' }).length, 0);
  const m1 = pick(cl, { d: '2026-11-24', h: 10, sub: false, model: 'claude-opus-5-5', project: '/fixtures/u/proj' }); // m1 at 09:00Z
  assert.equal(m1.length, 1);
  assert.deepEqual([m1[0].n, m1[0].in, m1[0].out, m1[0].cr, m1[0].cw], [1, 100, 20, 1000, 200]);
});

test('local days and hours; hours only for the last 8 days', () => {
  const m2 = pick(base.rows, { d: '2026-11-24', h: 0, agent: 'claude' });
  assert.equal(total(m2, 'n'), 1); // 23:30Z the day before is 00:30 in Rome
  const old = pick(base.rows, { d: '2026-11-10' });
  assert.equal(old.length, 1);
  assert.equal(old[0].h, null);
  assert.equal(pick(base.rows, { d: '2026-11-20', agent: 'claude' })[0].h, 9);
  for (const r of base.rows) assert.equal(r.h === null, r.d < '2026-11-17', `${r.d} ${r.h}`);
});

test('projects: first cwd of the session, worktrees collapsed, containers on their label folder', () => {
  const projects = [...new Set(base.rows.map((r) => r.project))].sort();
  assert.deepEqual(projects, ['/fixtures/u/boxproj', '/fixtures/u/chain', '/fixtures/u/noexec', '/fixtures/u/old', '/fixtures/u/proj', '/fixtures/u/runbox']);
  const box = pick(base.rows, { where: 'container' }).map((r) => [r.agent, r.box, r.project, r.model, r.n]).sort();
  assert.deepEqual(box, [
    ['claude', 'boxproj', '/fixtures/u/boxproj', 'claude-opus-5-5', 1],
    ['claude', 'noexec', '/fixtures/u/noexec', 'claude-opus-5-5', 1],
    ['claude', 'runbox', '/fixtures/u/runbox', 'claude-opus-5-5', 1],
    ['codex', 'boxproj', '/fixtures/u/boxproj', 'gpt-z', 1],
  ]);
  const cx = pick(base.rows, { where: 'container', agent: 'codex' })[0];
  assert.deepEqual([cx.in, cx.cr, cx.out], [6, 4, 5]);
});

test('Claude cost: session cost spread by weight, rate elsewhere, null without one', () => {
  const opus = (...ids) => ids.reduce((a, id) => a + weight(M[id]), 0);
  // own cost per session: S1 1.0 (largest cost-state), S3 0.01, S4 1.0, S5 1.5 - 1.0
  const rate = (1.0 + 0.01 + 1.0 + 0.5) / (opus('m1', 'm2', 'm3') + opus('m6') + opus('m7') + opus('m8'));
  const cl = pick(base.rows, { agent: 'claude' });
  const cost = (f) => total(pick(cl, f), 'cost');
  close(cost({ d: '2026-11-24', h: 10, sub: false, model: 'claude-opus-5-5' }), 1.0 * weight(M.m1) / opus('m1', 'm2', 'm3'), 'm1');
  close(cost({ d: '2026-11-24', h: 0 }), 1.0 * weight(M.m2) / opus('m1', 'm2', 'm3'), 'm2 stays with S1');
  close(cost({ where: 'container' }), rate * (weight(M.m10) + weight(M.m12) + weight(M.m13)), 'm10, m12, m13 from the rate');
  close(cost({ d: '2026-11-20', agent: 'claude' }), rate * weight(M.m9), 'm9 from the rate');
  close(cost({ d: '2026-11-24', h: 11, sub: true }), 1.0 * weight(M.m3) / opus('m1', 'm2', 'm3'), 'm3');
  close(cost({ d: '2026-11-24', h: 12, model: 'claude-opus-5-5' }), rate * weight(M.m5), 'm5 from the rate');
  close(cost({ d: '2026-11-21', h: 9 }), 1.0, 'm7 carries S4');
  close(cost({ d: '2026-11-21', h: 10 }), 0.5, 'm8 carries only what S5 added');
  close(cost({ project: '/fixtures/u/chain' }), 1.5, 'the chain costs its last total');
  assert.equal(pick(cl, { model: 'claude-sonnet-5-5' })[0].cost, null);
  const haiku = pick(cl, { model: 'claude-haiku-5-5' });
  assert.equal(haiku.length, 1);
  assert.deepEqual([haiku[0].n, haiku[0].in, haiku[0].out, haiku[0].cost], [0, 7, 3, 0.25]);
  assert.equal(pick(base.rows, { agent: 'codex' }).every((r) => r.cost === null), true);
});

test('Codex: repeats and forked replays dropped, cached input split out', () => {
  const cx = pick(base.rows, { agent: 'codex' });
  const a = pick(cx, { d: '2026-11-20' });
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].model, a[0].sub, a[0].n, a[0].in, a[0].cr, a[0].cw, a[0].out], ['gpt-x', false, 2, 70, 140, 3, 20]);
  const b = pick(cx, { d: '2026-11-21' });
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].model, b[0].sub, b[0].n, b[0].in, b[0].out, b[0].project], ['gpt-y', true, 1, 60, 10, '/fixtures/u/proj']);
});

test('sessions per day', () => {
  const s = (f) => total(pick(base.sessions, f), 'n');
  assert.equal(s({ d: '2026-11-24', agent: 'claude', where: 'host', project: '/fixtures/u/proj' }), 2); // S1, S2
  assert.equal(s({ d: '2026-11-21', agent: 'claude' }), 2); // S4, S5
  assert.equal(s({ d: '2026-11-21', agent: 'codex' }), 1); // the sub-agent thread belongs to A
  assert.equal(s({ d: '2026-11-24', where: 'container' }), 4); // S7, S9, S10 and Codex X
});

test('limits', () => {
  assert.deepEqual(base.limits.claude, {
    at: 1795520000000, fiveHour: null,
    week: { pct: 58, resets: Date.parse('2026-11-29T05:00:00.000Z'), samples: [[1795500000000, 55], [1795510000000, 58]], trail: [], restarts: [] },
    weeks: [],
  });
  assert.deepEqual(base.limits.codex, {
    at: Date.parse('2026-11-21T10:05:00Z'), plan: 'pro',
    primary: { pct: 9, windowMinutes: 10080, resets: 1795969395000 },
    secondary: { pct: 20, windowMinutes: 300, resets: 1795600000000 },
    // 4, 5 and 6 inside one hour are one point; the repeat of 6 is no rise.
    week: { pct: 9, resets: 1795969395000, trail: [[Date.parse('2026-11-20T09:02:00Z'), 6], [Date.parse('2026-11-21T10:05:00Z'), 9]], restarts: [] },
    weeks: [],
  });
});

test('recent: what each project spent in the last 60 and 15 minutes, with and without ripgrep', () => {
  for (const mode of ['file', 'norg']) {
    const at = Date.parse('2026-11-24T10:16:00Z'); // m3 at 10:00 (16 min), m4 at 10:05 (11 min); m1 at 09:00 is out
    const d = run(fx.home, ['--no-state', '--now', String(at)], mode);
    assert.equal(d.recent.length, 1, mode);
    const r = d.recent[0];
    assert.deepEqual([r.agent, r.where, r.box, r.project, r.n60, r.n15, r.last], ['claude', 'host', null, '/fixtures/u/proj', 2, 1, Date.parse('2026-11-24T10:05:00Z')]);
    const hour = pick(d.rows, { d: '2026-11-24', h: 11, agent: 'claude', project: '/fixtures/u/proj' });
    close(r.cost60, total(hour, 'cost'), 'the hour 10:00-11:00Z is the last 60 minutes');
    assert.ok(r.cost15 > 0 && r.cost15 < r.cost60);
  }
  // Nothing in the last hour: no entry.
  assert.deepEqual(run(fx.home, ['--no-state', '--now', String(Date.parse('2026-11-24T13:30:00Z'))]).recent, []);
});

test('older days from stats-cache only before the first transcript day', () => {
  assert.deepEqual(base.older.activity.map((x) => x.date), ['2026-11-01']);
  assert.deepEqual(base.older.tokens.map((x) => x.date), ['2026-11-01']);
});

test('an empty home is an empty document, not an error', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-empty-'));
  for (const mode of ['file', 'norg']) {
    const d = run(home, [], mode);
    assert.deepEqual([d.rows, d.sessions, d.limits, d.older, d.top, d.punch, d.punchDays, d.recent, d.took.docker], [[], [], { claude: null, codex: null }, { activity: [], tokens: [] }, [], [], 0, [], 'ok']);
  }
  assert.ok(fs.existsSync(path.join(home, '.local', 'state', 'herdr-usage', 'history.json')));
});

test('history: settled days kept, the same rows again, a deleted transcript still counted', () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const one = run(h.home, ['--state', state]);
  const hist = JSON.parse(fs.readFileSync(path.join(state, 'history.json'), 'utf8'));
  assert.deepEqual([...new Set(hist.rows.map((r) => r.d))].sort(), ['2026-11-10', '2026-11-20', '2026-11-21']);
  assert.ok(hist.rows.every((r) => r.h === null));
  assert.deepEqual(one.rows, base.rows);
  assert.deepEqual(one.limits.claude.week.trail, [[1795520000000, 58]]);

  const two = run(h.home, ['--state', state]);
  assert.deepEqual(two.rows, one.rows);
  assert.deepEqual(two.sessions, one.sessions);
  assert.deepEqual(two.limits.claude.week.trail, [[1795520000000, 58]]);

  fs.rmSync(path.join(h.P, '-fixtures-u-old', `${h.S3}.jsonl`));
  const three = run(h.home, ['--state', state]);
  assert.deepEqual(pick(three.rows, { d: '2026-11-10' }), pick(one.rows, { d: '2026-11-10' }));
  assert.deepEqual(pick(three.sessions, { d: '2026-11-10' }), pick(one.sessions, { d: '2026-11-10' }));
  assert.equal(pick(run(h.home, ['--no-state']).rows, { d: '2026-11-10' }).length, 0);
  assert.deepEqual(three.older.activity, base.older.activity); // the first row is still 2026-11-10

  put(h.cache, STATUS(60));
  fs.utimesSync(h.cache, new Date(1795530000000), new Date(1795530000000));
  const four = run(h.home, ['--state', state]);
  assert.deepEqual(four.limits.claude.week.trail, [[1795520000000, 58], [1795530000000, 60]]);
});

test('history: a day half deleted keeps the fuller stored row', () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  // a second session on the old day, in the same project and model as S3
  const S8 = 'aaaaaaaa-0000-0000-0000-000000000008';
  const f8 = path.join(h.P, '-fixtures-u-old', `${S8}.jsonl`);
  put(f8, jl({ type: 'user', cwd: '/fixtures/u/old', sessionId: S8, timestamp: '2026-11-10T13:59:00Z' },
    asst(S8, 'm11', '2026-11-10T14:00:00Z', 'claude-opus-5-5', { in: 4, out: 4 })));
  const before = run(h.home, ['--state', state]);
  assert.equal(total(pick(before.rows, { d: '2026-11-10' }), 'n'), 2);
  fs.rmSync(f8); // the day is now half deleted
  assert.equal(total(pick(run(h.home, ['--no-state']).rows, { d: '2026-11-10' }), 'n'), 1);
  const after = run(h.home, ['--state', state]);
  assert.deepEqual(pick(after.rows, { d: '2026-11-10' }), pick(before.rows, { d: '2026-11-10' }));
  assert.equal(total(pick(after.sessions, { d: '2026-11-10' }), 'n'), 2);
});

test('history: runs at once leave valid files and the same rows', async () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const docs = await Promise.all(Array.from({ length: 6 }, () => runAsync(h.home, ['--state', state])));
  for (const d of docs) assert.deepEqual(d.rows, base.rows);
  const hist = JSON.parse(fs.readFileSync(path.join(state, 'history.json'), 'utf8'));
  assert.equal(hist.v, 1);
  const lim = JSON.parse(fs.readFileSync(path.join(state, 'limits.json'), 'utf8'));
  assert.deepEqual(Object.values(lim.claudeWeeks), [[[1795520000000, 58]]]);
  assert.deepEqual(fs.readdirSync(state).sort(), ['containers', 'history.json', 'limits.json']);
});

test('bad flags fail with a message on stderr', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /unknown flag --bogus/);
});

test('top: the biggest sessions by tokens, both agents, by what each added', () => {
  const t = base.top;
  assert.ok(t.length <= 60);
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].tok >= t[i].tok);
  const s1 = t[0];
  const tok = (u) => (u.in ?? 0) + (u.out ?? 0) + (u.cr ?? 0) + (u.cw ?? 0);
  const s1tok = tok(M.m1) + tok(M.m2) + tok(M.m3) + tok(M.m4) + 10; // + haiku's cost-only row
  assert.deepEqual([s1.agent, s1.sessionId, s1.project, s1.where, s1.box, s1.title, s1.n, s1.model, s1.tok], ['claude', fx.S1, '/fixtures/u/proj', 'host', null, 'Fix the login', 4, 'claude-opus-5-5', s1tok]);
  assert.equal(s1.first, Date.parse('2026-11-23T23:30:00Z'));
  assert.equal(s1.last, Date.parse('2026-11-24T10:05:00Z'));
  close(s1.cost, 1.25, 'S1 spent its cost-state');
  close(s1.sub, Math.round(((tok(M.m3) + tok(M.m4)) / s1tok) * 1e4) / 1e4, 'subagent share, in tokens');
  // Codex: thread A and the sub-agent thread forked from it are one session; gpt-x has no price.
  const a = t.find((x) => x.agent === 'codex' && x.sessionId === 'A');
  assert.deepEqual([a.project, a.n, a.tok, a.cost, a.est, a.title, a.model], ['/fixtures/u/proj', 3, 110 + 123 + 70, null, true, null, 'gpt-x']);
  close(a.sub, Math.round((70 / 303) * 1e4) / 1e4, 'the forked thread');
  const chain = t.filter((x) => x.project === '/fixtures/u/chain' && x.agent === 'claude').map((x) => x.cost).sort();
  assert.deepEqual(chain, [0.5, 1]);
  const box = t.find((x) => x.box === 'runbox');
  assert.equal(box.where, 'container');
  assert.equal(t.find((x) => x.sessionId === 'aaaaaaaa-0000-0000-0000-000000000005').title, null);
  // 31 days later only what was within them is left
  const later = run(fx.home, ['--no-state', '--now', String(NOW + 20 * 86400000)]);
  assert.ok(later.top.every((x) => x.last >= NOW + 20 * 86400000 - 31 * 86400000));
  assert.equal(later.top.some((x) => x.project === '/fixtures/u/old'), false); // 2026-11-10
});

test('punch: weekday and hour over 28 days and today, both agents', () => {
  const cells = (d) => Object.fromEntries(d.punch.map((p) => [`${p.dow}/${p.h}`, p]));
  const c = cells(base);
  assert.equal(c['1/0'].n, 1); // m2: Tuesday 2026-11-24, 00:30 in Rome
  assert.equal(total(base.punch, 'n'), total(base.rows, 'n'));
  close(total(base.punch, 'cost'), total(base.rows, 'cost'), 'every cost of the window');
  assert.ok(base.punch.every((p) => p.n > 0 && p.dow >= 0 && p.dow <= 6 && p.h >= 0 && p.h <= 23));
  assert.equal(base.punchDays, 15); // 2026-11-10, the first day with any record, to 2026-11-24
  const later = run(fx.home, ['--no-state', '--now', String(NOW + 20 * 86400000)]); // window from 2026-11-16
  assert.equal(total(later.punch, 'n'), total(base.rows.filter((r) => r.d >= '2026-11-16'), 'n'));
  assert.equal(later.punchDays, 29); // records go back further than the window
});

// The statusline's file written at `at`: the session's own reading `pct`, the window's peak and samples.
// `seen`: each session's last reading, as a statusline that keeps them writes it.
function writeCache(file, at, pct, peak = pct, samples = [], seen = undefined) {
  put(file, JSON.stringify({ fiveHour: null, fiveHourResets: null, sevenDay: pct, sevenDayResets: '2026-11-29T05:00:00.000Z',
    week: { resets: '2026-11-29T05:00:00.000Z', peak, samples, ...(seen ? { seen } : {}) } }));
  fs.utimesSync(file, new Date(at), new Date(at));
}
// The widget's poll (--limits) after the file is written at T + `min` minutes.
function poller() {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const at = (min, pct, peak, samples, seen) => { writeCache(h.cache, T + min * MIN, pct, peak, samples, seen); return run(h.home, ['--limits', '--state', state]).limits.claude; };
  const checks = () => JSON.parse(fs.readFileSync(path.join(state, 'limits.json'), 'utf8')).claudeChecks;
  return { h, state, at, checks };
}
const T = 1795600000000, MIN = 60000;

test('Claude: a reset inside the window is believed once two writes ten minutes apart say it', () => {
  const { h, state, at } = poller();
  assert.equal(at(0, 96).week.pct, 96);
  // The reset: the statusline's own reading falls, its peak of the window stays.
  assert.equal(at(60, 69, 96).week.pct, 96);
  assert.equal(at(60, 69, 96).week.pct, 96); // the same write, read again
  assert.equal(at(65, 70, 96).week.pct, 96); // five minutes on: still held
  const c = at(71, 71, 96);
  assert.equal(c.week.pct, 71);
  assert.deepEqual(c.week.restarts, [[T + 60 * MIN, 96]]);
  assert.deepEqual(c.week.trail, [[T, 96], [T + 60 * MIN, 69], [T + 71 * MIN, 71]]);
  // A session with no reply since the reset puts its 95 back: held, and the next reading denies it.
  assert.equal(at(72, 95, 96).week.pct, 71);
  assert.equal(at(73, 72, 96).week.pct, 72);
  // The statusline's samples of before the reset no longer count.
  const s = at(74, 72, 96, [[T + 30 * MIN, 96]]);
  assert.deepEqual([s.week.pct, s.week.samples], [72, []]);
  // A collection believes the same, and keeps what it believes.
  const d = run(h.home, ['--state', state]).limits.claude;
  assert.deepEqual([d.week.pct, d.week.restarts], [72, [[T + 60 * MIN, 96]]]);
  // Over the week's old peak a reading is a fresh one: a rise at once, the statusline's peak and samples again.
  const up = at(300, 97, 98, [[T + 299 * MIN, 98]]);
  assert.deepEqual([up.week.pct, up.week.samples], [98, [[T + 299 * MIN, 98]]]);
});

test('Claude: an idle session\'s older reading is no reset', () => {
  const { at, checks } = poller();
  assert.equal(at(0, 90).week.pct, 90);
  assert.equal(at(30, 60, 90).week.pct, 90); // held
  assert.equal(at(31, 91, 91).week.pct, 91); // a reply's reading denies it, and rises
  assert.equal(at(45, 60, 91).week.pct, 91); // held again
  assert.equal(at(52, 89, 91).week.pct, 91); // under three points: denies it
  assert.equal(at(58, 60, 91).week.pct, 91); // held again, from here
  assert.equal(checks()[String(Date.parse('2026-11-29T05:00:00.000Z'))].pend.at, T + 58 * MIN);
  const c = at(70, 89, 91);
  assert.deepEqual([c.week.pct, c.week.restarts, c.week.trail], [91, [], [[T, 90], [T + 31 * MIN, 91]]]);
  assert.deepEqual(checks(), {});
});

test('Claude, from a statusline that keeps each session\'s reading: its reset at once, an idle writer left out', () => {
  const { at, checks } = poller();
  const key = String(Date.parse('2026-11-29T05:00:00.000Z'));
  assert.equal(at(0, 96, 96, [], { a: [96, T] }).week.pct, 96);
  // The statusline saw the reset: its peak falls, its samples start again there.
  const after = [[T + 58 * MIN, 69]], seen = { a: [69, T + 58 * MIN], b: [96, T] };
  const r = at(60, 69, 69, after, seen);
  assert.deepEqual([r.week.pct, r.week.restarts, r.week.trail.slice(1), r.week.samples], [69, [[T + 58 * MIN, 96]], [[T + 58 * MIN, 69]], after]);
  // Idle sessions writing their own 7-day reading change nothing, and hold nothing.
  assert.equal(at(61, 96, 69, after, seen).week.pct, 69);
  assert.equal(at(62, 40, 70, [...after, [T + 62 * MIN, 70]], seen).week.pct, 70);
  assert.equal(checks()[key].pend, null);
  // A session it hadn't seen puts the old peak back: no session the last look knew moved there, so
  // it is left out, and with it its sample, without waiting for the statusline to drop it.
  const back = { ...seen, c: [96, T + 63 * MIN] };
  const held = at(63, 96, 96, [[T + 62 * MIN, 70], [T + 63 * MIN, 96]], back);
  assert.deepEqual([held.week.pct, held.week.samples], [70, [[T + 62 * MIN, 70]]]);
  assert.equal(at(80, 70, 96, [[T + 62 * MIN, 70], [T + 63 * MIN, 96]], back).week.pct, 70); // still, 17 minutes on
  // A session it knew moving there is a real rise, however big.
  const moved = { ...back, a: [75, T + 81 * MIN] };
  assert.equal(at(81, 75, 96, [[T + 63 * MIN, 96]], moved).week.pct, 75);
  assert.deepEqual(checks()[key], { restarts: [[T + 58 * MIN, 96]], pend: null, seen: moved });
});

test('Claude without a state folder: the highest of the window, as before', () => {
  const h = makeHome();
  writeCache(h.cache, T, 69, 96);
  assert.equal(run(h.home, ['--limits', '--no-state']).limits.claude.week.pct, 96);
  assert.equal(run(h.home, ['--no-state']).limits.claude.week.pct, 96);
  // With each session's last reading kept, the statusline's peak, whatever the last writer said.
  writeCache(h.cache, T, 96, 71, [], { a: [71, T] });
  assert.equal(run(h.home, ['--limits', '--no-state']).limits.claude.week.pct, 71);
});

test('past weeks of the limit, newest first, the current one left out', () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const week = 7 * 86400000;
  const cur = Date.parse('2026-11-29T05:00:00.000Z');
  fs.writeFileSync(path.join(state, 'limits.json'), JSON.stringify({ v: 1, claudeWeeks: {
    [cur - 2 * week]: [[1, 10], [2, 40], [3, 35]], [cur - week]: [[4, 70]],
  } }));
  const d = run(h.home, ['--state', state]);
  assert.deepEqual(d.limits.claude.weeks, [{ resets: cur - week, peak: 70 }, { resets: cur - 2 * week, peak: 40 }]);
  assert.deepEqual(d.limits.claude.week.trail, [[1795520000000, 58]]);
});

test('containers: an exited one is read once, a running one only for what changed', () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const cp = (log) => log.filter((a) => a[0] === 'cp').map((a) => a.find((x) => x.includes(':')).slice(0, 1));
  dockerLog(h);
  const one = run(h.home, ['--state', state]);
  const l1 = dockerLog(h);
  assert.deepEqual([...new Set(cp(l1))].sort(), ['1', '2', '3', '4']); // everything copied the first time
  assert.deepEqual(pick(one.rows, { where: 'container' }), pick(base.rows, { where: 'container' }));
  assert.deepEqual(pick(one.took.sources, { box: 'broken' }), [{ where: 'container', box: 'broken', error: 'Error response from daemon: boom' }]);

  const two = run(h.home, ['--state', state]);
  const l2 = dockerLog(h);
  assert.deepEqual([...new Set(cp(l2))].sort(), ['3', '4']); // 1: exited and unchanged; 2: listed by exec; 3: exec fails there
  assert.ok(l2.some((a) => a[0] === 'exec' && a.includes('find') && a.includes(h.cid(2))));
  assert.ok(!l2.some((a) => a[0] === 'exec' && a.includes('tar')));
  assert.deepEqual(two.rows, one.rows);
  assert.deepEqual(pick(two.took.sources, { box: 'boxproj' }).map((x) => x.via), ['cache', 'cache']);

  fs.appendFileSync(h.f9, jl(asst('aaaaaaaa-0000-0000-0000-000000000009', 'm14', '2026-11-24T07:30:00Z', 'claude-opus-5-5', { in: 1, out: 1 })));
  fs.utimesSync(h.f9, new Date(1795600000000), new Date(1795600000000));
  const three = run(h.home, ['--state', state]);
  const l3 = dockerLog(h);
  const tar = l3.filter((a) => a[0] === 'exec' && a.includes('tar'));
  assert.equal(tar.length, 1);
  assert.deepEqual(tar[0].slice(tar[0].indexOf('--') + 1), ['-workspace/aaaaaaaa-0000-0000-0000-000000000009.jsonl']);
  assert.equal(total(pick(three.rows, { box: 'runbox' }), 'n'), 2);

  // the exited one stopped again: read again
  const cs = JSON.parse(fs.readFileSync(path.join(h.D, 'containers.json'), 'utf8'));
  cs[0].finished = '2026-11-24T11:00:00Z';
  fs.writeFileSync(path.join(h.D, 'containers.json'), JSON.stringify(cs));
  const four = run(h.home, ['--state', state]);
  assert.ok(cp(dockerLog(h)).includes('1'));
  assert.deepEqual(pick(four.rows, { box: 'boxproj' }), pick(one.rows, { box: 'boxproj' }));

  // a container that is gone leaves its cache behind no more; its rows stay in history only when settled
  fs.writeFileSync(path.join(h.D, 'containers.json'), JSON.stringify(cs.slice(1)));
  run(h.home, ['--state', state]);
  assert.equal(fs.readdirSync(path.join(state, 'containers')).some((n) => n.startsWith(h.cid(1))), false);
});

test('docker absent, or not answering, leaves the host part as it was', () => {
  const absent = run(fx.home, ['--no-state'], 'file', { PATH: EMPTY_PATH });
  assert.equal(absent.took.docker, 'absent');
  assert.equal(pick(absent.rows, { where: 'container' }).length, 0);
  assert.deepEqual(pick(absent.rows, { where: 'host', agent: 'codex' }), pick(base.rows, { where: 'host', agent: 'codex' }));
  for (const mode of ['file', 'norg']) {
    const t0 = Date.now();
    const hung = run(fx.home, ['--no-state', '--docker-timeout', '300'], mode, { FAKE_DOCKER_HANG: '1' });
    assert.ok(Date.now() - t0 < 3000, 'no hang');
    assert.equal(hung.took.docker, 'timeout');
    assert.equal(pick(hung.rows, { where: 'container' }).length, 0);
  }
});

test('Codex estimates: priced when printed, from history too, never kept there', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-price-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const C = path.join(home, '.codex', 'sessions', '2026', '11');
  const u = (i, c, o, w = 0) => ({ input_tokens: i, cached_input_tokens: c, cache_write_input_tokens: w, output_tokens: o, total_tokens: i + o });
  const file = (day, model, ts, total, last) => jl(
    { timestamp: ts, type: 'session_meta', payload: { id: day, cwd: '/fixtures/u/priced', source: 'cli' } },
    { timestamp: ts, type: 'turn_context', payload: { model } },
    tokenCount(ts, total, last, RL(3)),
  );
  // 1M uncached input, 2M cached, 0.5M output; and an old settled day; and a model with no price.
  put(path.join(C, '24', 'r-now.jsonl'), file('now', 'gpt-5.5', '2026-11-24T11:30:00Z', 3_500_000, u(3_000_000, 2_000_000, 500_000)));
  put(path.join(C, '10', 'r-old.jsonl'), file('old', 'gpt-6.2-sol', '2026-11-10T11:30:00Z', 1_100_000, u(1_000_000, 0, 100_000, 400_000)));
  put(path.join(C, '23', 'r-none.jsonl'), file('none', 'gpt-unknown', '2026-11-23T11:30:00Z', 10, u(5, 0, 5)));
  put(path.join(C, '22', 'r-astra.jsonl'), file('astra', 'gpt-6.2-astra', '2026-11-22T11:30:00Z', 1_300_000, u(1_000_000, 0, 100_000, 200_000)));
  const d = run(home, ['--state', state]);
  const cost = (dd) => pick(d.rows, { agent: 'codex', d: dd })[0];
  close(cost('2026-11-24').cost, (1 * 5 + 2 * 0.5 + 0.5 * 30) , 'gpt-5.5, cache write priced as input');
  close(cost('2026-11-10').cost, (1 * 2 + 0.1 * 10 + 0.4 * 2.5), 'gpt-6.2-sol with a cache-write price');
  assert.equal(cost('2026-11-23').cost, null);
  close(cost('2026-11-22').cost, (1 * 8 + 0.1 * 40 + 0.2 * 10), 'gpt-6.2-astra');
  assert.ok(d.rows.every((r) => r.est === true));
  const hist = JSON.parse(fs.readFileSync(path.join(state, 'history.json'), 'utf8'));
  assert.ok(hist.rows.length > 0);
  assert.ok(hist.rows.every((r) => r.cost === null && !('est' in r)), 'no estimate in history');
  // the transcript gone, history's row is priced again
  fs.rmSync(path.join(C, '10', 'r-old.jsonl'));
  close(pick(run(home, ['--state', state]).rows, { d: '2026-11-10' })[0].cost, 1 * 2 + 0.1 * 10 + 0.4 * 2.5, 'priced from history');
  // recent: the last hour's tokens and estimate
  const r = run(home, ['--no-state', '--now', String(Date.parse('2026-11-24T12:00:00Z'))]).recent;
  assert.deepEqual([r.length, r[0].agent, r[0].tok60, r[0].est], [1, 'codex', 3_500_000, true]);
  close(r[0].cost60, 21, 'recent estimate');
  const top = d.top.find((x) => x.sessionId === 'now');
  close(top.cost, 21, 'top estimate');
  assert.equal(top.tok, 3_500_000);
});

test('Codex: a reading three points under or more is a reset once one ten minutes on is as low', () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const C = path.join(h.home, '.codex', 'sessions', '2026', '11', '22');
  // `credits` makes each event its own: the same payload in another file would be its copy.
  const RLR = (pct) => RL(pct, { credits: { balance: String(pct) } });
  put(path.join(C, 'r-reset.jsonl'), jl(
    { timestamp: '2026-11-21T11:00:00Z', type: 'session_meta', payload: { id: 'R', cwd: '/fixtures/u/proj', source: 'cli' } },
    tokenCount('2026-11-21T11:00:00Z', null, null, RLR(8)), // a point under 9: noise
    tokenCount('2026-11-22T08:00:00Z', null, null, RLR(2)), // held
    tokenCount('2026-11-22T08:05:00Z', null, null, RLR(9)), // a reading near 9 lets it go
    tokenCount('2026-11-22T08:06:00Z', null, null, RLR(3)), // held again
    tokenCount('2026-11-22T08:20:00Z', null, null, RLR(4)), // ten minutes on and as low: the reset
    tokenCount('2026-11-22T08:40:00Z', null, null, RLR(5)), // a rise in its hour: a point of its own
    tokenCount('2026-11-22T08:50:00Z', null, null, RLR(6)), // which a rise in the same hour moves
  ));
  // A sub-agent's thread starting with a copy of its parent's history, stamped at its own start.
  put(path.join(C, 'r-copy.jsonl'), jl(
    tokenCount('2026-11-22T09:00:00.000Z', null, null, RL(40)),
    tokenCount('2026-11-22T09:00:00.010Z', null, null, RL(41)),
  ));
  // A model's own limit (Spark's), the newest reading of all.
  put(path.join(C, 'r-spark.jsonl'), jl(
    tokenCount('2026-11-22T09:10:00Z', null, null, RL(1, { limit_id: 'codex_bengalfox', limit_name: 'GPT-5.3-Codex-Spark' })),
  ));
  const at = (iso) => Date.parse(iso);
  const want = {
    pct: 6, resets: 1795969395000, restarts: [[at('2026-11-22T08:06:00Z'), 9]],
    trail: [[at('2026-11-20T09:02:00Z'), 6], [at('2026-11-21T10:05:00Z'), 9], [at('2026-11-22T08:06:00Z'), 3], [at('2026-11-22T08:20:00Z'), 4], [at('2026-11-22T08:50:00Z'), 6]],
  };
  const d = run(h.home, ['--no-state']).limits.codex;
  assert.deepEqual(d.week, want);
  assert.deepEqual([d.at, d.primary.pct], [at('2026-11-22T08:50:00Z'), 6]);
  // Kept in limits.json and read again with the transcripts, it says the same, and so it does
  // once the older transcripts are gone.
  assert.deepEqual(run(h.home, ['--state', state]).limits.codex.week, want);
  assert.deepEqual(run(h.home, ['--state', state]).limits.codex.week, want);
  fs.rmSync(path.join(h.home, '.codex', 'sessions', '2026', '11', '20'), { recursive: true, force: true });
  fs.rmSync(path.join(h.home, '.codex', 'sessions', '2026', '11', '21'), { recursive: true, force: true });
  assert.deepEqual(run(h.home, ['--state', state]).limits.codex.week, want);
});

test('Codex: servers that disagree turn by turn are no reset', () => {
  const h = makeHome();
  const rows = [];
  for (let i = 0; i < 16; i++) rows.push(tokenCount(new Date(Date.parse('2026-11-23T10:00:00Z') + i * 120000).toISOString(), null, null, RL(i % 2 ? 9 : 0)));
  put(path.join(h.home, '.codex', 'sessions', '2026', '11', '23', 'r-two.jsonl'), jl(...rows));
  const w = run(h.home, ['--no-state']).limits.codex.week;
  assert.deepEqual([w.pct, w.restarts], [9, []]);
});

test('Codex weeks: earlier windows kept in limits.json and printed, newest first', () => {
  const h = makeHome();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-state-'));
  const old = 1795969395 - 7 * 86400;
  put(path.join(h.home, '.codex', 'sessions', '2026', '11', '15', 'r-old.jsonl'), jl(
    { timestamp: '2026-11-15T09:00:00Z', type: 'session_meta', payload: { id: 'O', cwd: '/fixtures/u/proj', source: 'cli' } },
    tokenCount('2026-11-15T09:00:00Z', 5, { input_tokens: 5, output_tokens: 0, total_tokens: 5 }, { primary: { used_percent: 40, window_minutes: 10080, resets_at: old }, secondary: null, plan_type: 'pro' }),
    tokenCount('2026-11-15T12:00:00Z', 6, { input_tokens: 1, output_tokens: 0, total_tokens: 1 }, { primary: { used_percent: 71, window_minutes: 10080, resets_at: old + 3 }, secondary: null, plan_type: 'pro' }),
  ));
  const d = run(h.home, ['--state', state]);
  assert.deepEqual(d.limits.codex.weeks, [{ resets: old * 1000, peak: 71 }]);
  assert.equal(d.limits.codex.week.pct, 9);
  const lim = JSON.parse(fs.readFileSync(path.join(state, 'limits.json'), 'utf8'));
  assert.equal(Object.keys(lim.codexWeeks).length, 2);
  // The old transcript gone, the week stays.
  fs.rmSync(path.join(h.home, '.codex', 'sessions', '2026', '11', '15', 'r-old.jsonl'));
  assert.deepEqual(run(h.home, ['--state', state]).limits.codex.weeks, [{ resets: old * 1000, peak: 71 }]);
});
