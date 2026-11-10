// Runs model-written code against hidden test cases in a separate, locked-down Node process.
// Layers: Node permission model (no file writes, no child processes, reads limited to one temp folder),
// an empty environment, an OS sandbox profile that denies all network access, and a time limit.
// The child never sees the expected answers: it only returns what the code produced, and grading happens here.
// Its report comes back on a line tagged with a one-time nonce that the tested code cannot read.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// The payload (code, inputs, nonce) arrives on stdin, so nothing the tested code can reach holds the nonce:
// it lives only in this module's scope, and code built with new Function sees the global scope only.
// Every built-in the runner needs is captured before the tested code loads, so redefining globals changes nothing.
const RUNNER = `
const write = process.stdout.write.bind(process.stdout);
const stringify = JSON.stringify, parse = JSON.parse, clone = structuredClone, Fn = Function;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const payload = parse(input);
  input = '';
  const nonce = payload.nonce, inputs = payload.inputs, fnName = payload.fnName;
  const emit = (obj) => write(nonce + stringify(obj) + '\\n');
  let fn;
  try { fn = new Fn(payload.code + '\\n;return typeof ' + fnName + ' === "function" ? ' + fnName + ' : undefined;')(); }
  catch (e) { emit({ fatal: 'load: ' + String(e && e.message) }); return; }
  if (!fn) { emit({ fatal: 'function ' + fnName + ' not found' }); return; }
  const outputs = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      const got = fn(...clone(inputs[i]));
      let json;
      try { json = stringify(got); } catch { json = undefined; }
      outputs[i] = { threw: false, json: typeof json === 'string' ? json : null };
    } catch { outputs[i] = { threw: true, json: null }; }
  }
  emit({ outputs });
});
`;

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const NO_NETWORK = '(version 1)(allow default)(deny network*)';

// Builds the command line for a locked-down Node child. Exported so the self-check can probe it directly.
// Fails closed: without a way to block the network, model-written code is not run at all.
export function sandboxCommand(dir, script, args = []) {
  const node = [process.execPath, '--permission', `--allow-fs-read=${dir}`, script, ...args];
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

export async function runTests(code, fnName, cases, timeoutMs = 5000) {
  const total = cases.length;
  const cleaned = String(code || '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+/gm, '')
    .replace(/^\s*module\.exports\s*=.*$/gm, '');
  const dir = await makeSandboxDir();
  const nonce = `@@${randomBytes(24).toString('hex')}@@`;
  try {
    const runner = join(dir, 'runner.mjs');
    await writeFile(runner, RUNNER);
    let cmd, argv;
    try { [cmd, ...argv] = sandboxCommand(dir, runner); } catch (e) { return { passed: 0, total, detail: String(e.message) }; }
    const out = await new Promise((resolve) => {
      const child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
      let stdout = '', done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ fatal: 'timeout (무한 반복 가능성)' }); }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 2e6) child.kill('SIGKILL'); });
      child.on('error', (e) => finish({ fatal: String(e.message) }));
      child.on('close', () => {
        // Only a line carrying the nonce counts; anything the tested code printed itself is ignored.
        const line = stdout.split('\n').find((l) => l.startsWith(nonce));
        try { finish(JSON.parse(line.slice(nonce.length))); } catch { finish({ fatal: 'no result (실행 중 오류)' }); }
      });
      child.stdin.on('error', () => {});
      // Expected answers stay in this process; the child receives inputs only.
      child.stdin.end(JSON.stringify({ code: cleaned, fnName, inputs: cases.map((c) => c.args), nonce }));
    });
    if (out.fatal) return { passed: 0, total, detail: String(out.fatal).slice(0, 200) };
    const o = out.outputs;
    if (!Array.isArray(o) || o.length !== total) return { passed: 0, total, detail: '결과 형식 오류' };
    const passed = cases.filter((c, i) => {
      const r = o[i];
      if (!r || typeof r !== 'object') return false;
      if (c.throws) return r.threw === true;
      return r.threw === false && typeof r.json === 'string' && sameValue(r.json, c.expect);
    }).length;
    return { passed, total, detail: `숨은 테스트 ${passed}/${total} 통과` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
