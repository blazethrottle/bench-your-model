// Calls the subscription CLIs (claude, grok) headlessly. No API keys are used or stored.
// mode "asused"   = the user's real environment (instructions, skills, tools), confined to a throwaway folder.
// mode "isolated" = bare model: no tools, no user instructions, minimal system prompt.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readdir, readFile, stat, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';

const SYS = 'You are a helpful assistant. Follow the instructions in the user message exactly.';

function findBin(name, extra) {
  const dirs = [...(process.env.PATH || '').split(':'), ...extra];
  for (const d of dirs) { const p = join(d, name); if (d && existsSync(p)) return p; }
  return null;
}
const HOME = homedir();
export const BIN = {
  claude: findBin('claude', [join(HOME, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']),
  grok: findBin('grok', [join(HOME, '.grok/bin'), '/opt/homebrew/bin', '/usr/local/bin']),
};

const GROK_ISOLATED_ENV = Object.fromEntries(
  ['CLAUDE', 'CURSOR'].flatMap((v) => ['AGENTS', 'SKILLS', 'RULES', 'MCPS', 'HOOKS'].map((k) => [`GROK_${v}_${k}_ENABLED`, 'false'])),
);

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

function exec(bin, args, { cwd, env, stdin, timeoutMs, signal }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false, timedOut = false;
    const finish = (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, out, err, ms: Date.now() - started, timedOut, aborted: !!(signal && signal.aborted) });
    };
    const kill = () => { try { child.kill('SIGTERM'); } catch {} setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000); };
    const onAbort = () => kill();
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', onAbort); }
    child.stdout.on('data', (d) => { if (out.length < 5e6) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 2e5) err += d; });
    child.on('error', (e) => { err += String(e.message); finish(-1); });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin || '');
  });
}

const LIMIT_RE = /usage limit|rate limit|limit reached|quota|exceeded your|out of (usage|credits)|한도/i;

function parseClaude(raw) {
  const o = JSON.parse(raw.out.trim().split('\n').filter(Boolean).pop());
  const u = o.usage || {};
  return {
    ok: !o.is_error && typeof o.result === 'string', text: o.result || '',
    inTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    outTokens: u.output_tokens || 0, costUsd: o.total_cost_usd ?? null,
    servedBy: Object.keys(o.modelUsage || {}), turns: o.num_turns ?? null,
    denials: Array.isArray(o.permission_denials) ? o.permission_denials.map((d) => `${d.tool_name || '?'}: ${JSON.stringify(d.tool_input || {}).slice(0, 120)}`).slice(0, 20) : [],
    error: o.is_error ? String(o.result || o.subtype || 'error').slice(0, 300) : null,
  };
}
function parseGrok(raw) {
  const o = JSON.parse(raw.out.trim());
  const u = o.usage || {};
  return {
    ok: typeof o.text === 'string' && o.stopReason !== 'error', text: o.text || '',
    inTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    outTokens: u.output_tokens || 0, costUsd: o.total_cost_usd ?? null,
    servedBy: Object.keys(o.modelUsage || {}), turns: o.num_turns ?? null,
    error: typeof o.text === 'string' ? null : 'no text',
  };
}

// Reads back what the model left in its work folder (text files only, bounded), keyed by relative path.
async function collectFiles(root) {
  const out = {}; let total = 0;
  const walk = async (dir) => {
    for (const name of await readdir(dir)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = join(dir, name); const st = await stat(p).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) { await walk(p); continue; }
      if (!st.isFile() || st.size > 400000 || total > 3e6) continue;
      out[relative(root, p).split(sep).join('/')] = await readFile(p, 'utf8'); total += st.size;
    }
  };
  await walk(root).catch(() => {});
  return out;
}

// `files` seeds the work folder before the call; `collect` returns its contents afterwards (also after a timeout).
export async function ask({ provider, model, prompt, mode = 'asused', effort, behavesAs, files, collect = false, inspect, webDomains, timeoutMs = 300000, signal }) {
  const bin = BIN[provider];
  if (!bin) return { ok: false, text: '', ms: 0, error: `${provider} 명령을 찾지 못함`, kind: 'setup' };
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bm-run-')));
  try {
    for (const [rel, content] of Object.entries(files || {})) {
      const p = join(cwd, rel); await mkdir(dirname(p), { recursive: true }); await writeFile(p, content);
    }
    let raw, parse;
    if (provider === 'claude') {
      const args = ['-p', '--model', model, '--output-format', 'json', '--no-session-persistence'];
      // A model newer than the installed CLI knows is registered through modelPicker so the CLI accepts it.
      const settings = behavesAs ? { modelPicker: { options: [{ model, behavesAs }] } } : {};
      if (mode === 'isolated') args.push('--tools', '', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--system-prompt', SYS);
      else {
        // File tools are confined to the work folder, and shell commands run in the OS sandbox so they
        // cannot write outside it either (this is what keeps a measurement from touching other projects).
        settings.permissions = { blockWritesOutsideWorkingDirectories: true };
        // A headless run has nobody to approve a web lookup, so a task that needs the web names the hosts it may fetch.
        // Nothing else is opened: no general search, no other hosts, and only for that task.
        if (Array.isArray(webDomains) && webDomains.length) settings.permissions.allow = webDomains.map((d) => `WebFetch(domain:${d})`);
        settings.sandbox = { enabled: true, allowUnsandboxedCommands: false, failIfUnavailable: true };
      }
      if (Object.keys(settings).length) args.push('--settings', JSON.stringify(settings));
      if (effort) args.push('--effort', effort);
      raw = await exec(bin, args, { cwd, env: cleanEnv(), stdin: prompt, timeoutMs, signal });
      parse = parseClaude;
    } else {
      const pf = join(cwd, '.bm-prompt.txt');
      await writeFile(pf, prompt);
      const args = ['--prompt-file', pf, '-m', model, '--output-format', 'json', '--cwd', cwd, '--sandbox', 'workspace'];
      if (mode === 'isolated') args.push('--tools', '', '--disable-web-search', '--no-subagents', '--verbatim', '--system-prompt-override', SYS);
      if (effort) args.push('--reasoning-effort', effort);
      raw = await exec(bin, args, { cwd, env: cleanEnv(mode === 'isolated' ? GROK_ISOLATED_ENV : {}), timeoutMs, signal });
      parse = parseGrok;
    }
    const base = { ms: raw.ms, workFiles: collect ? await collectFiles(cwd) : undefined };
    // Binary results (video) cannot travel as text, so the task inspects them in place before the folder is removed.
    if (inspect && base.workFiles) { try { base.workFiles['__inspect.json'] = JSON.stringify(await inspect(cwd)); } catch (e) { base.workFiles['__inspect.json'] = JSON.stringify({ error: String(e && e.message) }); } }
    if (raw.aborted) return { ...base, ok: false, text: '', error: '중단됨', kind: 'aborted' };
    if (raw.timedOut) return { ...base, ok: false, text: '', error: `시간 초과 (${Math.round(timeoutMs / 1000)}초)`, kind: 'timeout' };
    try {
      const p = parse(raw);
      if (!p.ok) {
        const msg = p.error || raw.err.slice(-300) || 'unknown error';
        return { ...base, ...p, error: msg, kind: LIMIT_RE.test(msg + raw.err) ? 'limit' : 'error' };
      }
      return { ...base, ...p, kind: 'ok' };
    } catch {
      const msg = (raw.err || raw.out || `exit ${raw.code}`).trim().slice(-300);
      return { ...base, ok: false, text: '', error: msg, kind: LIMIT_RE.test(msg) ? 'limit' : 'error' };
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// One tiny call that records how many input tokens the environment itself adds before any task text.
export async function probe(provider, model, mode, signal, behavesAs) {
  const r = await ask({ provider, model, prompt: 'Reply with only: OK', mode, behavesAs, timeoutMs: 120000, signal });
  return { ok: r.ok, baselineInputTokens: r.ok ? r.inTokens : null, error: r.ok ? null : r.error, kind: r.kind };
}
