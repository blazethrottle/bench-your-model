// Runs model-written code against hidden test cases in a separate, locked-down Node process.
// Layers: Node permission model (no file writes, no child processes, reads limited to one temp folder),
// an empty environment, a macOS sandbox profile that denies all network access, and a time limit.
// Results come back on a line tagged with a one-time nonce that the tested code cannot read.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// The payload (code, cases, nonce) arrives on stdin, so nothing the tested code can reach holds the nonce:
// it lives only in this module's scope, and code built with new Function sees the global scope only.
const RUNNER = `
const write = process.stdout.write.bind(process.stdout);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const { code, fnName, cases, nonce } = JSON.parse(input);
  input = '';
  const emit = (obj) => write(nonce + JSON.stringify(obj) + '\\n');
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  let fn;
  try { fn = new Function(code + '\\n;return typeof ' + fnName + ' === "function" ? ' + fnName + ' : undefined;')(); }
  catch (e) { emit({ fatal: 'load: ' + String(e && e.message) }); return; }
  if (!fn) { emit({ fatal: 'function ' + fnName + ' not found' }); return; }
  const results = cases.map((c) => {
    try {
      const got = fn(...structuredClone(c.args));
      if (c.throws) return false;
      return eq(got, c.expect);
    } catch { return !!c.throws; }
  });
  emit({ results });
});
`;

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const NO_NETWORK = '(version 1)(allow default)(deny network*)';

// Builds the command line for a locked-down Node child. Exported so the self-check can probe it directly.
export function sandboxCommand(dir, script, args = []) {
  const node = [process.execPath, '--permission', `--allow-fs-read=${dir}`, script, ...args];
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC) ? [SANDBOX_EXEC, '-p', NO_NETWORK, ...node] : node;
}

export async function makeSandboxDir() {
  // macOS temp paths are symlinks; the permission model needs the real path.
  return realpath(await mkdtemp(join(tmpdir(), 'bm-sbx-')));
}

export async function runTests(code, fnName, cases, timeoutMs = 5000) {
  const cleaned = String(code || '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+/gm, '')
    .replace(/^\s*module\.exports\s*=.*$/gm, '');
  const dir = await makeSandboxDir();
  const nonce = `@@${randomBytes(24).toString('hex')}@@`;
  try {
    const runner = join(dir, 'runner.mjs');
    await writeFile(runner, RUNNER);
    const [cmd, ...argv] = sandboxCommand(dir, runner);
    const out = await new Promise((resolve) => {
      const child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
      let stdout = '', done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ fatal: 'timeout (무한 반복 가능성)' }); }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 1e6) child.kill('SIGKILL'); });
      child.on('error', (e) => finish({ fatal: String(e.message) }));
      child.on('close', () => {
        // Only a line carrying the nonce counts; anything the tested code printed itself is ignored.
        const line = stdout.split('\n').find((l) => l.startsWith(nonce));
        try { finish(JSON.parse(line.slice(nonce.length))); } catch { finish({ fatal: 'no result (실행 중 오류)' }); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ code: cleaned, fnName, cases, nonce }));
    });
    if (out.fatal) return { passed: 0, total: cases.length, detail: String(out.fatal).slice(0, 200) };
    const r = out.results;
    if (!Array.isArray(r) || r.length !== cases.length || r.some((v) => typeof v !== 'boolean')) return { passed: 0, total: cases.length, detail: '결과 형식 오류' };
    const passed = r.filter(Boolean).length;
    return { passed, total: cases.length, detail: `숨은 테스트 ${passed}/${cases.length} 통과` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
