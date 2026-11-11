// LLM 벤치마커: local-only web service. Binds to 127.0.0.1 and drives the subscription CLIs.
import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, TASKS, tasksFor } from './lib/bank.mjs';
import { ask, probe, BIN } from './lib/providers.mjs';
import { judgeWork } from './lib/judge.mjs';
import { mean, median, round1 } from './lib/util.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.env.PORT || CONFIG.port || 4173);
const RUNS_DIR = join(ROOT, 'data', 'runs');
const keyOf = (m) => `${m.provider}:${m.model}`;
const MODELS = new Map(CONFIG.models.map((m) => [keyOf(m), m]));
const EFFORTS = CONFIG.efforts || ['default'];

let current = null; // { run, abort }

// ---------- scoring summary ----------
export function summarize(model) {
  const done = Object.values(model.tasks).filter((t) => t.score !== null && t.score !== undefined);
  const cats = {};
  for (const c of CATEGORIES) {
    const xs = done.filter((t) => t.cat === c.id).map((t) => t.score);
    if (xs.length) cats[c.id] = round1(mean(xs));
  }
  const catVals = Object.values(cats);
  // A work-folder task graded after a timeout still took real time, so it counts toward the time figures.
  const answered = done.filter((t) => t.kind === 'ok' || t.graded);
  const secs = answered.map((t) => t.ms / 1000);
  const outTok = answered.reduce((a, t) => a + (t.outTokens || 0), 0);
  const totalSec = secs.reduce((a, b) => a + b, 0);
  const costs = done.map((t) => t.costUsd).filter((v) => typeof v === 'number');
  return {
    cats, overall: catVals.length ? round1(mean(catVals)) : null,
    medianSec: secs.length ? round1(median(secs)) : null,
    outTokPerSec: totalSec > 0 ? round1(outTok / totalSec) : null,
    costUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
    avgInputTokens: answered.length ? Math.round(mean(answered.map((t) => t.inTokens || 0))) : null,
    completed: done.length, failures: done.filter((t) => t.kind !== 'ok' && !t.graded).length, timeouts: done.filter((t) => t.kind === 'timeout').length,
  };
}

async function saveRun(run) {
  await mkdir(RUNS_DIR, { recursive: true });
  const file = join(RUNS_DIR, `${run.id}.json`);
  await writeFile(file + '.tmp', JSON.stringify(run));
  await rename(file + '.tmp', file);
}

async function runModel(run, model, tasks, signal) {
  model.status = 'running';
  const timeoutMs = (CONFIG.taskTimeoutSec[run.mode] || 300) * 1000;
  let streak = 0;
  for (const task of tasks) {
    if (signal.aborted) { model.status = 'aborted'; break; }
    model.currentTask = task.id;
    const r = await ask({ provider: model.provider, model: model.model, behavesAs: model.behavesAs, effort: model.effort === 'default' ? undefined : model.effort, prompt: task.prompt, mode: run.mode, files: task.files, collect: !!task.files, inspect: task.inspect, timeoutMs: task.timeoutSec ? task.timeoutSec * 1000 : timeoutMs, signal });
    if (r.kind === 'aborted') { model.status = 'aborted'; break; }
    if (r.kind === 'limit' || r.kind === 'setup') { model.status = r.kind; model.error = r.error; break; }
    // Two failed calls in a row means the model or effort level is not usable; stop instead of recording zeros.
    streak = r.kind === 'error' ? streak + 1 : 0;
    if (streak >= 2) { model.status = 'error'; model.error = r.error; delete model.tasks[tasks[tasks.indexOf(task) - 1].id]; break; }
    const rec = {
      cat: task.cat, title: task.title, kind: r.kind, ms: r.ms, inTokens: r.inTokens ?? null, outTokens: r.outTokens ?? null,
      costUsd: r.costUsd ?? null, servedBy: r.servedBy || [], error: r.error || null, answer: (r.text || '').slice(0, 60000),
      turns: r.turns ?? null, denials: r.denials || [],
    };
    // A work-folder task that ran out of time is still graded on what it left in the folder.
    const gradable = r.kind === 'ok' || (task.files && r.kind === 'timeout' && r.workFiles);
    if (!gradable) {
      Object.assign(rec, { score: 0, detail: r.error || '응답 실패' });
    } else {
      let det;
      try { det = await task.score(r.text || '', r.workFiles || {}); if (r.kind !== 'ok') det.detail = `${r.error}. 폴더에 남은 결과로 채점: ${det.detail}`; } catch (e) { det = { score: 0, detail: `채점 중 오류: ${String(e && e.message).slice(0, 120)}` }; }
      rec.detail = det.detail; rec.detScore = det.score;
      if (det.raw !== undefined) rec.raw = det.raw; // raw objective values, so results can be rescored later
      // The submitted file itself is kept too, so it can be graded again later on a quiet machine.
      if (task.keep && r.workFiles) rec.work = Object.fromEntries(task.keep.filter((f) => typeof r.workFiles[f] === 'string').map((f) => [f, r.workFiles[f].slice(0, 400000)]));
      if (r.kind !== 'ok') rec.graded = true;
      if (det.svg !== undefined) rec.svg = det.svg.slice(0, 20000);
      if (task.judge) {
        const j = await judgeWork(task, r.text, run.judges, signal);
        rec.judges = j.results; rec.judgeScore = j.score;
        const w = task.judge.detWeight;
        rec.score = j.score === null ? det.score : Math.round(det.score * w + j.score * (1 - w));
        if (j.score === null) rec.detail += ' (심사 실패: 형식 점수만 반영)';
      } else rec.score = det.score;
    }
    model.tasks[task.id] = rec;
    model.summary = summarize(model);
    await saveRun(run);
  }
  model.currentTask = null;
  if (model.status === 'running') model.status = 'done';
  model.summary = summarize(model);
}

async function execute(run, signal) {
  const tasks = run.onlyTasks ? TASKS.filter((t) => run.onlyTasks.includes(t.id)) : tasksFor(run.depth);
  run.taskIds = tasks.map((t) => t.id);
  // Environment fingerprint: what the harness adds before any task text.
  const providers = [...new Set(run.models.map((m) => m.provider))];
  await Promise.all(providers.map(async (p) => {
    run.env[p] = { cli: BIN[p], ...(await probe(p, CONFIG.probeModels[p], run.mode, signal)) };
  }));
  await saveRun(run);
  const queue = [...run.models];
  const worker = async () => { for (let m = queue.shift(); m; m = queue.shift()) await runModel(run, m, tasks, signal).catch((e) => { m.status = 'error'; m.error = String(e && e.message); }); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(run.parallel || CONFIG.parallelModels || 2, run.models.length)) }, worker));
  run.status = signal.aborted ? 'aborted' : 'done';
  run.finishedAt = new Date().toISOString();
  await saveRun(run);
}

function startRun(body) {
  if (current && current.run.status === 'running') throw Object.assign(new Error('이미 측정이 진행 중입니다.'), { code: 409 });
  const keys = Array.isArray(body.models) ? [...new Set(body.models.map(String))] : [];
  const models = keys.map((k) => MODELS.get(k)).filter(Boolean);
  if (!models.length) throw Object.assign(new Error('측정할 모델을 하나 이상 고르세요.'), { code: 400 });
  const depth = ['full', 'long'].includes(body.depth) ? body.depth : 'quick';
  // Calibration helpers (API only): run chosen task ids, and repeat each model to see run-to-run spread.
  const onlyTasks = Array.isArray(body.taskIds) ? body.taskIds.map(String).filter((id) => TASKS.some((t) => t.id === id)) : null;
  const repeat = Math.min(3, Math.max(1, Number(body.repeat) || 1));
  const parallel = Math.min(6, Math.max(1, Number(body.parallel) || 0)) || null;
  const mode = body.mode === 'isolated' ? 'isolated' : 'asused';
  const efforts = (Array.isArray(body.efforts) ? [...new Set(body.efforts.map(String))] : ['default']).filter((e) => EFFORTS.includes(e));
  if (!efforts.length) efforts.push('default');
  const variants = models.flatMap((m) => efforts.flatMap((e) => Array.from({ length: repeat }, (_, i) => ({ ...m, key: `${keyOf(m)}@${e}${repeat > 1 ? `#${i + 1}` : ''}`, baseKey: keyOf(m), effort: e, label: `${m.label}${e === 'default' ? '' : ` · ${e}`}${repeat > 1 ? ` · ${i + 1}회차` : ''}` }))));
  const run = {
    id: new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6),
    startedAt: new Date().toISOString(), finishedAt: null, depth, mode, onlyTasks: onlyTasks && onlyTasks.length ? onlyTasks : null, repeat, parallel, status: 'running', env: {}, judges: CONFIG.judges, taskIds: [],
    models: variants.map((m) => ({ ...m, status: 'pending', currentTask: null, error: null, tasks: {}, summary: null })),
  };
  const abort = new AbortController();
  current = { run, abort };
  execute(run, abort.signal).catch(async (e) => { run.status = 'error'; run.error = String(e && e.message); run.finishedAt = new Date().toISOString(); await saveRun(run).catch(() => {}); });
  return run;
}

// ---------- read models ----------
const light = (run) => ({ ...run, models: run.models.map((m) => ({ ...m, tasks: Object.fromEntries(Object.entries(m.tasks).map(([id, t]) => [id, { ...t, answer: undefined, svg: undefined, judges: undefined, work: undefined }])) })) });

async function loadRuns() {
  let files = [];
  try { files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith('.json')); } catch { return []; }
  const runs = [];
  for (const f of files.sort().reverse()) { try { runs.push(JSON.parse(await readFile(join(RUNS_DIR, f), 'utf8'))); } catch {} }
  return runs;
}

// Repeats of one model in one run are folded into a single entry: the median of each figure, plus the score range.
function foldRepeats(models) {
  const med = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length ? round1(median(v)) : null; };
  const s = models.map((m) => m.summary);
  const cats = {};
  for (const c of CATEGORIES) { const v = med(s.map((x) => x.cats[c.id])); if (v !== null) cats[c.id] = v; }
  const overalls = s.map((x) => x.overall).filter((x) => typeof x === 'number');
  return {
    cats, overall: med(s.map((x) => x.overall)), medianSec: med(s.map((x) => x.medianSec)), outTokPerSec: med(s.map((x) => x.outTokPerSec)),
    costUsd: med(s.map((x) => x.costUsd)), avgInputTokens: med(s.map((x) => x.avgInputTokens)), completed: med(s.map((x) => x.completed)), failures: med(s.map((x) => x.failures)),
    repeats: models.length, overallRange: overalls.length > 1 ? [Math.min(...overalls), Math.max(...overalls)] : null,
  };
}

// Board = for each (model, mode) the most recent measurement that finished; full runs win over quick runs.
async function board() {
  const best = new Map();
  for (const run of await loadRuns()) {
    if (run.onlyTasks) continue; // partial task sets are calibration, not results
    const groups = new Map();
    for (const m of run.models) {
      if (m.status !== 'done' || !m.summary || m.summary.overall === null) continue;
      const gk = `${m.baseKey || m.key}@${m.effort || 'default'}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(m);
    }
    for (const [gk, members] of groups) {
      const m = { ...members[0], key: gk, label: members[0].label.replace(/ · \d+회차$/, ''), summary: members.length > 1 ? foldRepeats(members) : members[0].summary };
      const k = `${m.key}|${run.mode}|${run.depth === 'long' ? 'long' : 'short'}`; const prev = best.get(k);
      const cand = { key: m.key, baseKey: m.baseKey || m.key, effort: m.effort || 'default', label: m.label, provider: m.provider, mode: run.mode, depth: run.depth, tier: run.depth === 'long' ? 'long' : 'short', runId: run.id, measuredAt: run.finishedAt || run.startedAt, env: run.env[m.provider] || null, summary: m.summary };
      if (!prev || (prev.depth === 'quick' && run.depth === 'full')) best.set(k, cand);
    }
  }
  return [...best.values()];
}

// Demanding tier, per task: for each (model, effort, mode) and task, the most recent run that measured it.
// Repeats inside that run are folded into a median and a range. Partial runs (chosen task ids) count here.
async function longBoard() {
  const longIds = tasksFor('long').map((t) => t.id); const rows = new Map();
  for (const run of await loadRuns()) { // newest first
    if (run.depth !== 'long') continue;
    const groups = new Map();
    for (const m of run.models) {
      const gk = `${m.baseKey || m.key}@${m.effort || 'default'}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(m);
    }
    for (const [gk, members] of groups) {
      const rk = `${gk}|${run.mode}`;
      if (!rows.has(rk)) rows.set(rk, { key: gk, baseKey: members[0].baseKey || members[0].key, effort: members[0].effort || 'default', label: members[0].label.replace(/ · \d+회차$/, ''), provider: members[0].provider, mode: run.mode, tasks: {} });
      const row = rows.get(rk);
      for (const id of longIds) {
        if (row.tasks[id]) continue;
        const recs = members.map((m) => m.tasks[id]).filter((t) => t && typeof t.score === 'number');
        if (!recs.length) continue;
        const scores = recs.map((t) => t.score); const costs = recs.map((t) => t.costUsd).filter((v) => typeof v === 'number');
        row.tasks[id] = { score: round1(median(scores)), range: recs.length > 1 ? [Math.min(...scores), Math.max(...scores)] : null, n: recs.length, sec: Math.round(median(recs.map((t) => t.ms / 1000))), timeouts: recs.filter((t) => t.kind === 'timeout').length, costUsd: costs.length === recs.length ? Math.round(median(costs) * 100) / 100 : null, measuredAt: run.finishedAt || run.startedAt };
      }
    }
  }
  return [...rows.values()].filter((r) => Object.keys(r.tasks).length);
}

// ---------- http ----------
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = ''; req.on('data', (d) => { s += d; if (s.length > 1e5) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('잘못된 요청 본문'), { code: 400 })); } });
});
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  try {
    // Reject requests that reach this local server under another name (DNS rebinding) or from another site.
    if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'forbidden host' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'forbidden origin' });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json only' });
      if (url.pathname === '/api/run') return send(res, 200, light(startRun(await readBody(req))));
      if (url.pathname === '/api/cancel') { if (current && current.run.status === 'running') current.abort.abort(); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'not found' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, await readFile(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');
    if (url.pathname === '/api/config') {
      return send(res, 200, {
        categories: CATEGORIES, models: CONFIG.models.map((m) => ({ ...m, key: keyOf(m), available: !!BIN[m.provider] })), judges: CONFIG.judges, efforts: EFFORTS,
        counts: { quick: tasksFor('quick').length, full: tasksFor('full').length, long: tasksFor('long').length },
        tasks: TASKS.map((t) => ({ id: t.id, cat: t.cat, title: t.title, judged: !!t.judge, long: !!t.long })),
      });
    }
    if (url.pathname === '/api/current') return send(res, 200, current ? light(current.run) : null);
    if (url.pathname === '/api/board') return send(res, 200, await board());
    if (url.pathname === '/api/board-long') return send(res, 200, await longBoard());
    if (url.pathname === '/api/report') { try { return send(res, 200, await readFile(join(ROOT, 'data', 'report.json'), 'utf8')); } catch { return send(res, 404, { error: 'no report yet' }); } }
    if (url.pathname === '/api/runs') return send(res, 200, (await loadRuns()).map((r) => ({ id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, depth: r.depth, mode: r.mode, status: r.status, models: r.models.map((m) => ({ key: m.key, label: m.label, status: m.status, overall: m.summary && m.summary.overall })) })));
    const m = /^\/api\/runs\/([\w-]+)$/.exec(url.pathname);
    if (m) {
      if (current && current.run.id === m[1]) return send(res, 200, current.run);
      try { return send(res, 200, await readFile(join(RUNS_DIR, `${m[1]}.json`), 'utf8')); } catch { return send(res, 404, { error: 'not found' }); }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, e.code && e.code >= 400 && e.code < 500 ? e.code : 500, { error: String((e && e.message) || e) });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`LLM 벤치마커 실행 중: http://127.0.0.1:${PORT}`);
    console.log(`claude: ${BIN.claude || '찾지 못함'} | grok: ${BIN.grok || '찾지 못함'}`);
  });
}
