// Runs model-written code against hidden test cases in a separate, permission-restricted Node process.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = `
import { readFileSync } from 'node:fs';
const { code, fnName, cases } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
let fn;
try { fn = new Function(code + '\\n;return typeof ' + fnName + ' === "function" ? ' + fnName + ' : undefined;')(); }
catch (e) { console.log(JSON.stringify({ fatal: 'load: ' + String(e && e.message) })); process.exit(0); }
if (!fn) { console.log(JSON.stringify({ fatal: 'function ' + fnName + ' not found' })); process.exit(0); }
const results = cases.map((c) => {
  try {
    const got = fn(...structuredClone(c.args));
    if (c.throws) return false;
    return eq(got, c.expect);
  } catch { return !!c.throws; }
});
console.log(JSON.stringify({ results }));
`;

export async function runTests(code, fnName, cases, timeoutMs = 5000) {
  const cleaned = String(code || '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+/gm, '')
    .replace(/^\s*module\.exports\s*=.*$/gm, '');
  // macOS temp paths are symlinks; the permission model needs the real path.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bm-sbx-')));
  try {
    const runner = join(dir, 'runner.mjs');
    const payload = join(dir, 'payload.json');
    await writeFile(runner, RUNNER);
    await writeFile(payload, JSON.stringify({ code: cleaned, fnName, cases }));
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${dir}`, runner, payload], {
        stdio: ['ignore', 'pipe', 'pipe'], env: {},
      });
      let stdout = '', done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ fatal: 'timeout (무한 반복 가능성)' }); }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 1e6) child.kill('SIGKILL'); });
      child.on('error', (e) => finish({ fatal: String(e.message) }));
      child.on('close', () => {
        try { finish(JSON.parse(stdout.trim().split('\n').pop())); }
        catch { finish({ fatal: 'no result (실행 중 오류)' }); }
      });
    });
    if (out.fatal) return { passed: 0, total: cases.length, detail: out.fatal };
    const passed = out.results.filter(Boolean).length;
    return { passed, total: cases.length, detail: `숨은 테스트 ${passed}/${cases.length} 통과` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
