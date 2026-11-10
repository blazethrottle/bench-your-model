// Runs model-written code against hidden inputs in a separate, locked-down Node process.
// Layers: Node permission model (no file writes, no child processes, reads limited to one temp folder),
// an empty environment, an OS sandbox profile that denies all network access, and a time limit.
// The child never sees the expected answers: it only returns what the code produced, and grading happens here.
// Its reports come back on lines tagged with a one-time nonce that the tested code cannot read.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, normalize, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';

// The payload (code or module path, inputs, nonce) arrives on stdin, so nothing the tested code can reach holds
// the nonce. Every built-in the runner needs is captured before the tested code loads, so redefining globals
// changes nothing. One line is emitted per call, so calls finished before a hang or a kill still count.
const RUNNER = `
const write = process.stdout.write.bind(process.stdout);
const stringify = JSON.stringify, parse = JSON.parse, clone = structuredClone, Fn = Function;
const now = performance.now.bind(performance), own = Object.prototype.hasOwnProperty, call = Function.prototype.call;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', async () => {
  const payload = parse(input);
  input = '';
  const nonce = payload.nonce, calls = payload.calls, names = payload.names;
  const emit = (obj) => write(nonce + stringify(obj) + '\\n');
  let fns = {};
  try {
    if (payload.module) {
      const mod = await import(payload.module);
      for (let i = 0; i < names.length; i++) fns[names[i]] = mod[names[i]];
    } else {
      let body = payload.code + '\\n;return {';
      for (let i = 0; i < names.length; i++) body += names[i] + ': typeof ' + names[i] + ' === "function" ? ' + names[i] + ' : undefined,';
      fns = new Fn(body + '};')();
    }
  } catch (e) { emit({ fatal: 'load: ' + String(e && e.message) }); return; }
  for (let i = 0; i < calls.length; i++) {
    const fn = fns[calls[i].fn];
    if (typeof fn !== 'function') { emit({ i, missing: true }); continue; }
    const args = clone(calls[i].args);
    const t0 = now();
    try {
      const got = fn(...args);
      const ms = now() - t0;
      let json;
      try { json = stringify(got); } catch { json = undefined; }
      emit({ i, threw: false, ms, json: typeof json === 'string' ? json : null });
    } catch { emit({ i, threw: true, ms: now() - t0, json: null }); }
  }
  emit({ done: true });
});
`;

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const NO_NETWORK = '(version 1)(allow default)(deny network*)';
const IDENT = /^[A-Za-z_$][\w$]*$/;

// Builds the command line for a locked-down Node child. Exported so the self-check can probe it directly.
// Fails closed: without a way to block the network, model-written code is not run at all.
export function sandboxCommand(dir, script, args = []) {
  const node = [process.execPath, '--permission', `--allow-fs-read=${dir}`, '--max-old-space-size=1024', script, ...args];
  if (process.platform === 'darwin' && existsSync(SANDBOX_EXEC)) return [SANDBOX_EXEC, '-p', NO_NETWORK, ...node];
  if (process.platform === 'linux' && existsSync('/usr/bin/unshare')) return ['/usr/bin/unshare', '--net', '--map-root-user', ...node];
  throw new Error('네트워크 차단 수단이 없어 모델이 쓴 코드를 실행하지 않습니다 (macOS sandbox-exec 또는 Linux unshare 필요)');
}

export async function makeSandboxDir() {
  // macOS temp paths are symlinks; the permission model needs the real path.
  return realpath(await mkdtemp(join(tmpdir(), 'bm-sbx-')));
}

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const sameValue = (json, expect) => {
  try { return JSON.stringify(canon(JSON.parse(json))) === JSON.stringify(canon(expect)); } catch { return false; }
};

// Core: run `calls` ([{ fn, args }]) against either a code string or a module inside `dir`; returns one record per call.
async function execute({ dir, code, module, names, calls, timeoutMs }) {
  if (names.some((n) => !IDENT.test(n))) return { fatal: '잘못된 함수 이름' };
  const nonce = `@@${randomBytes(24).toString('hex')}@@`;
  const runner = join(dir, '__runner.mjs');
  await writeFile(runner, RUNNER);
  let cmd, argv;
  try { [cmd, ...argv] = sandboxCommand(dir, runner); } catch (e) { return { fatal: String(e.message) }; }
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    let stdout = '', done = false, timedOut = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      const records = []; let fatal = null, completed = false;
      for (const line of stdout.split('\n')) {
        if (!line.startsWith(nonce)) continue; // anything the tested code printed itself is ignored
        let o; try { o = JSON.parse(line.slice(nonce.length)); } catch { continue; }
        if (o.fatal) fatal = String(o.fatal).slice(0, 200);
        else if (o.done) completed = true;
        else if (Number.isInteger(o.i) && o.i >= 0 && o.i < calls.length) records[o.i] = o;
      }
      resolve({ fatal, records, timedOut, completed });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 3e7) child.kill('SIGKILL'); });
    child.on('error', () => finish());
    child.on('close', () => finish());
    child.stdin.on('error', () => {});
    // Expected answers stay in this process; the child receives inputs only.
    child.stdin.end(JSON.stringify({ code, module, names, calls: calls.map((c) => ({ fn: c.fn, args: c.args })), nonce }));
  });
}

// A case passes when the call returned (or threw, if `throws`) the expected value within its own time budget.
function grade(cases, res) {
  if (res.fatal) return { passed: 0, total: cases.length, pass: cases.map(() => false), detail: res.fatal };
  const pass = cases.map((c, i) => {
    const r = res.records[i];
    if (!r || r.missing) return false;
    if (c.maxMs && !(r.ms <= c.maxMs)) return false;
    if (c.throws) return r.threw === true;
    return r.threw === false && typeof r.json === 'string' && sameValue(r.json, c.expect);
  });
  const passed = pass.filter(Boolean).length;
  const slow = cases.filter((c, i) => c.maxMs && res.records[i] && res.records[i].ms > c.maxMs).length;
  const hung = res.timedOut && !res.completed;
  return { passed, total: cases.length, pass, detail: `숨은 테스트 ${passed}/${cases.length} 통과${slow ? `, 시간 초과 ${slow}건` : ''}${hung ? ', 실행이 끝나지 않아 중단' : ''}` };
}

const cleanCode = (code) => String(code || '')
  .replace(/^\s*export\s+default\s+/gm, '')
  .replace(/^\s*export\s+/gm, '')
  .replace(/^\s*module\.exports\s*=.*$/gm, '');

// Single-file answers. cases: [{ args, expect | throws, fn?, maxMs? }]; `fnName` is the default function.
export async function runTests(code, fnName, cases, timeoutMs = 5000) {
  const dir = await makeSandboxDir();
  try {
    const calls = cases.map((c) => ({ fn: c.fn || fnName, args: c.args }));
    const names = [...new Set(calls.map((c) => c.fn))];
    const res = await execute({ dir, code: cleanCode(code), names, calls, timeoutMs });
    const g = grade(cases, res);
    if (res.timedOut && !res.completed && !g.passed) g.detail = 'timeout (무한 반복 가능성)';
    return g;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Multi-file answers, raw form: returns what each call produced (parsed), or undefined when it threw or never ran.
// The caller compares against expected values itself, which allows comparing only part of a result.
export async function runProjectOutputs(files, entry, calls, timeoutMs = 15000) {
  const dir = await makeSandboxDir();
  try {
    for (const [rel, content] of Object.entries(files)) {
      const n = normalize(rel);
      if (isAbsolute(n) || n.startsWith('..') || n.startsWith('__runner')) continue;
      const p = join(dir, 'work', n);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, String(content));
    }
    const names = [...new Set(calls.map((c) => c.fn))];
    const res = await execute({ dir, module: join(dir, 'work', entry), names, calls: calls.map((c) => ({ fn: c.fn, args: c.args })), timeoutMs });
    const outputs = calls.map((_, i) => {
      const r = res.records && res.records[i];
      if (!r || r.missing || r.threw !== false || typeof r.json !== 'string') return undefined;
      try { return JSON.parse(r.json); } catch { return undefined; }
    });
    return { fatal: res.fatal || null, hung: !!(res.timedOut && !res.completed), outputs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Multi-file answers: `files` ({ relPath: content }) is copied into the sandbox folder and `entry` is imported.
export async function runProject(files, entry, cases, timeoutMs = 15000) {
  const dir = await makeSandboxDir();
  try {
    for (const [rel, content] of Object.entries(files)) {
      const n = normalize(rel);
      if (isAbsolute(n) || n.startsWith('..') || n.startsWith('__runner')) continue;
      const p = join(dir, 'work', n);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, String(content));
    }
    const calls = cases.map((c) => ({ fn: c.fn, args: c.args }));
    const names = [...new Set(calls.map((c) => c.fn))];
    const res = await execute({ dir, module: join(dir, 'work', entry), names, calls, timeoutMs });
    return grade(cases, res);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
