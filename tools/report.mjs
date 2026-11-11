// Builds one score table for every measured model and effort level, plus model-selection criteria.
// Reads data/runs, rescoring the open-ended tasks from stored raw values against one fixed 100-point line
// (the best result any measured answer reached), so results from different runs are comparable.
//
//   node tools/report.mjs                 build data/report.json and data/report.md
//   node tools/report.mjs --regrade       first run every stored answer file again, one at a time (quiet machine)
//   node tools/report.mjs --since <ISO>   only runs started at or after this time (default: data/campaign.json)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS, CATEGORIES } from '../lib/bank.mjs';
import { genInstance, evaluate, baselineSolve, HIDDEN } from '../lib/sched.mjs';
import { OPEN2_INFO, ratioPts } from '../lib/tasks-open2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const CONFIG = readJson(join(ROOT, 'config.json'), {});
const args = process.argv.slice(2);
const campaign = readJson(join(DATA, 'campaign.json'), {});
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : campaign.since || '1970-01-01';
const REGRADE = args.includes('--regrade');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const r1 = (v) => Math.round(v * 10) / 10;

const OPEN = [
  { id: 'coding-6', title: '로그 압축', sub: '코딩 · 알고리즘 설계', work: '성능을 끝까지 짜내야 하는 코딩 (압축, 최적화 구현)' },
  { id: 'research-5', title: '수요 예측', sub: '데이터 분석 · 모델링', work: '데이터 분석과 예측 모델 만들기' },
  { id: 'planning-5', title: '일정 최적화', sub: '계획 · 탐색', work: '제약이 많은 계획과 일정 최적화' },
  { id: 'repeat-5', title: '메모 정규화', sub: '반복 업무 자동화', work: '비정형 자료를 규칙대로 정리하는 자동화' },
];
const PROJECT = [{ id: 'debug-5', title: '결함 수정', sub: '파일 10개 프로젝트' }, { id: 'debug-6', title: '코드 검토', sub: '결함 12개 찾기' }];
const OPEN_IDS = OPEN.map((x) => x.id);

// ---------- load ----------
const runs = readdirSync(join(DATA, 'runs')).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(DATA, 'runs', f), null)).filter((r) => r && r.startedAt >= since && r.mode === 'asused');
const labelOf = new Map((CONFIG.models || []).map((m) => [`${m.provider}:${m.model}`, m.label]));
const records = [], shortRuns = new Map();
for (const run of runs) {
  for (const m of run.models) {
    const base = m.baseKey || m.key.split('@')[0], effort = m.effort || 'default', rowKey = `${base}@${effort}`;
    const row = { rowKey, base, effort, provider: m.provider, label: labelOf.get(base) || base };
    for (const [taskId, rec] of Object.entries(m.tasks || {})) records.push({ ...row, taskId, runId: run.id, mkey: m.key, rec });
    if (run.depth === 'full' && !run.onlyTasks && m.status === 'done' && m.summary) shortRuns.set(rowKey, { ...row, summary: m.summary, tasks: m.tasks }); // newest wins
  }
}

// ---------- optional sequential regrade of stored answer files ----------
const cacheFile = join(DATA, 'regrade.json');
const cache = readJson(cacheFile, {});
if (REGRADE) {
  const todo = records.filter((x) => OPEN_IDS.includes(x.taskId) && x.rec.work && Object.keys(x.rec.work).length && !cache[`${x.runId}|${x.mkey}|${x.taskId}`]);
  console.log(`재채점 대상 ${todo.length}건`);
  for (const x of todo) {
    const task = TASKS.find((t) => t.id === x.taskId);
    const res = await task.score('', x.rec.work);
    cache[`${x.runId}|${x.mkey}|${x.taskId}`] = { raw: res.raw ?? null, detail: res.detail };
    writeFileSync(cacheFile, JSON.stringify(cache));
    process.stdout.write('.');
  }
  console.log('');
}
const rawOf = (x) => { const c = cache[`${x.runId}|${x.mkey}|${x.taskId}`]; return c ? c.raw : x.rec.raw ?? null; };

// ---------- one fixed 100-point line per task ----------
const usable = (x) => x.rec.kind === 'ok' || x.rec.graded; // an error or usage-limit stop is not a measurement
const open = records.filter((x) => OPEN_IDS.includes(x.taskId) && usable(x));
const sched = HIDDEN.map(([seed, n, m]) => { const inst = genInstance(seed, n, m); return { seed, base: evaluate(inst, baselineSolve(inst)).value }; });
const schedRef = readJson(join(ROOT, 'fixtures', 'sched', 'best.json'), {});
const minRaw = (taskId, seed, start) => open.filter((x) => x.taskId === taskId).reduce((a, x) => { const v = rawOf(x) && rawOf(x)[seed]; return typeof v === 'number' && v < a ? v : a; }, start);
const lines = {
  'planning-5': Object.fromEntries(sched.map((s) => [s.seed, minRaw('planning-5', s.seed, schedRef[s.seed] ? schedRef[s.seed].best : Infinity)])),
  'coding-6': Object.fromEntries(OPEN2_INFO.logs().map((l) => [l.seed, minRaw('coding-6', l.seed, OPEN2_INFO.logLine()[l.seed])])),
};
const sales = OPEN2_INFO.sales();
function finalScore(x) {
  const raw = rawOf(x);
  if (!raw) return 0;
  if (x.taskId === 'planning-5') return sched.reduce((a, s) => a + (typeof raw[s.seed] === 'number' ? ratioPts(raw[s.seed], s.base, lines['planning-5'][s.seed]) : 0), 0) / sched.length;
  if (x.taskId === 'coding-6') { const ls = OPEN2_INFO.logs(); return ls.reduce((a, l) => a + (typeof raw[l.seed] === 'number' ? ratioPts(raw[l.seed], l.bytes, lines['coding-6'][l.seed]) : 0), 0) / ls.length; }
  if (x.taskId === 'research-5') return typeof raw.err === 'number' ? ratioPts(raw.err, sales.base, sales.oracle) : 0;
  if (x.taskId === 'repeat-5') return raw.total ? (100 * raw.ok) / raw.total : 0;
  return x.rec.score;
}

// ---------- aggregate ----------
const rows = new Map();
const rowOf = (x) => { if (!rows.has(x.rowKey)) rows.set(x.rowKey, { key: x.rowKey, base: x.base, effort: x.effort, provider: x.provider, label: x.label, cells: {}, cost: 0, costKnown: 0, costMissing: 0, timeouts: 0, calls: 0, errors: 0 }); return rows.get(x.rowKey); };
const dur = (sec) => (sec >= 90 ? `${r1(sec / 60)}분` : `${Math.round(sec)}초`);
const byCell = new Map();
for (const x of records) {
  const row = rowOf(x);
  if (!usable(x)) { row.errors++; continue; }
  row.calls++; if (x.rec.kind === 'timeout') row.timeouts++;
  if (typeof x.rec.costUsd === 'number') { row.cost += x.rec.costUsd; row.costKnown++; } else row.costMissing++;
  if (OPEN_IDS.includes(x.taskId) || PROJECT.some((p) => p.id === x.taskId)) {
    const k = `${x.rowKey}|${x.taskId}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push({ score: OPEN_IDS.includes(x.taskId) ? finalScore(x) : x.rec.score, sec: x.rec.ms / 1000, timeout: x.rec.kind === 'timeout' });
  }
}
const stat = new Map();
for (const [k, xs] of byCell) {
  const sc = xs.map((v) => v.score);
  stat.set(k, { med: median(sc), min: Math.min(...sc), max: Math.max(...sc), n: xs.length, sec: median(xs.map((v) => v.sec)), timeouts: xs.filter((v) => v.timeout).length });
}
// A column's typical run-to-run spread: the median range among cells measured more than once.
const spreadOf = (taskId) => { const rs = [...stat].filter(([k, s]) => k.endsWith(`|${taskId}`) && s.n > 1).map(([, s]) => s.max - s.min); return rs.length ? median(rs) : null; };
const interval = (s, spread) => (s.n > 1 ? [s.min, s.max] : spread === null ? [s.med, s.med] : [s.med - spread, s.med + spread]);
const tiedSets = {};
for (const t of [...OPEN, ...PROJECT]) {
  const col = [...rows.values()].map((r) => ({ r, s: stat.get(`${r.key}|${t.id}`) })).filter((x) => x.s);
  if (!col.length) continue;
  const spread = spreadOf(t.id), best = col.reduce((a, b) => (b.s.med > a.s.med ? b : a)), bi = interval(best.s, spread);
  tiedSets[t.id] = { best: best.r.key, tied: [], spread };
  for (const { r, s } of col) {
    const iv = interval(s, spread), tie = r.key !== best.r.key && iv[1] >= bi[0];
    if (tie || r.key === best.r.key) tiedSets[t.id].tied.push(r.key);
    r.cells[t.id] = { v: String(Math.round(s.med)), s: `${s.n > 1 ? `${Math.round(s.min)}~${Math.round(s.max)} · ` : ''}${s.n}회 · ${dur(s.sec)}${s.timeouts ? ` · 시간 초과 ${s.timeouts}` : ''}`, score: s.med, mark: r.key === best.r.key ? 'best' : tie ? 'tie' : null, warn: s.timeouts > 0 };
  }
}
for (const r of rows.values()) {
  const xs = OPEN.map((t) => stat.get(`${r.key}|${t.id}`)).filter(Boolean);
  if (xs.length === OPEN.length) { r.openAvg = xs.reduce((a, s) => a + s.med, 0) / xs.length; r.cells.openAvg = { v: String(r1(r.openAvg)), score: r.openAvg }; }
  const sh = shortRuns.get(r.key);
  if (sh) {
    for (const c of CATEGORIES) if (typeof sh.summary.cats[c.id] === 'number') r.cells[`cat-${c.id}`] = { v: String(Math.round(sh.summary.cats[c.id])), score: sh.summary.cats[c.id] };
    r.shortAvg = sh.summary.overall; r.shortSec = sh.summary.medianSec;
    r.cells.shortAvg = { v: String(sh.summary.overall), score: sh.summary.overall };
    r.cells.shortSec = { v: sh.summary.medianSec === null ? '-' : `${sh.summary.medianSec}초` };
  }
  r.cells.cost = { v: r.costKnown ? `$${r.cost.toFixed(2)}` : '-', s: r.costMissing ? `미보고 ${r.costMissing}건` : '' };
  r.cells.timeouts = { v: `${r.timeouts}/${r.calls}`, warn: r.timeouts > 0, s: r.errors ? `오류 ${r.errors}건 제외` : '' };
}
{ // best marks for the averages and short-tier columns
  for (const id of ['openAvg', 'shortAvg', ...CATEGORIES.map((c) => `cat-${c.id}`)]) {
    const xs = [...rows.values()].filter((r) => r.cells[id] && typeof r.cells[id].score === 'number');
    if (xs.length) { const top = Math.max(...xs.map((r) => r.cells[id].score)); for (const r of xs) if (r.cells[id].score === top) r.cells[id].mark = 'best'; }
  }
}
const EFFORT = { default: '설정 기본값', low: '낮음(low)', medium: '중간(medium)', high: '높음(high)', xhigh: '매우 높음(xhigh)' };
const sorted = [...rows.values()].sort((a, b) => (b.openAvg ?? -1) - (a.openAvg ?? -1) || a.label.localeCompare(b.label));
const name = (r) => `${r.label} · ${r.effort}`;

// ---------- criteria ----------
const criteria = [];
const pickFor = (taskId) => {
  const set = tiedSets[taskId]; if (!set) return null;
  const tied = set.tied.map((k) => ({ r: rows.get(k), s: stat.get(`${k}|${taskId}`) })).filter((x) => x.s.timeouts * 2 <= x.s.n);
  if (!tied.length) return null;
  const fast = tied.reduce((a, b) => (b.s.sec < a.s.sec ? b : a)), top = { r: rows.get(set.best), s: stat.get(`${set.best}|${taskId}`) };
  return { fast, top, tied, spread: set.spread };
};
for (const t of OPEN) {
  const p = pickFor(t.id); if (!p) continue;
  const same = p.fast.r.key === p.top.r.key;
  criteria.push({ work: t.work, pick: name(p.fast.r), alt: same ? (p.tied.length > 1 ? p.tied.filter((x) => x.r.key !== p.fast.r.key).sort((a, b) => b.s.med - a.s.med).slice(0, 2).map((x) => name(x.r)).join(', ') : null) : name(p.top.r),
    why: same ? `${t.title} ${Math.round(p.fast.s.med)}점으로 최고점이고 ${dur(p.fast.s.sec)} 걸렸습니다.${p.tied.length > 1 ? ` 측정 편차 안에서 같은 조합이 ${p.tied.length - 1}개 더 있습니다.` : ' 다른 조합과의 차이가 측정 편차보다 큽니다.'}` : `${t.title} ${Math.round(p.fast.s.med)}점(${dur(p.fast.s.sec)})으로, 최고점 ${name(p.top.r)}의 ${Math.round(p.top.s.med)}점(${dur(p.top.s.sec)})과 측정 편차 안에서 같으면서 가장 빨랐습니다.` });
}
{
  const both = [...rows.values()].map((r) => ({ r, a: stat.get(`${r.key}|debug-5`), b: stat.get(`${r.key}|debug-6`) })).filter((x) => x.a && x.b);
  const full = both.filter((x) => x.a.med >= 100 && x.b.med >= 100 && !x.a.timeouts && !x.b.timeouts).sort((x, y) => x.a.sec + x.b.sec - (y.a.sec + y.b.sec));
  if (full.length) criteria.push({ work: '명세가 분명한 코드 수정과 검토', pick: name(full[0].r), alt: full.slice(1, 3).map((x) => name(x.r)).join(', ') || null, why: `결함 수정과 코드 검토 모두 만점인 조합이 ${full.length}개이고, 그중 가장 빨랐습니다(두 과제 합계 ${dur(full[0].a.sec + full[0].b.sec)}). 점수로는 갈리지 않으므로 속도와 사용량으로 고릅니다.` });
  const slow = both.filter((x) => x.a.timeouts || x.b.timeouts).map((x) => name(x.r));
  if (slow.length) criteria.push({ work: '(피할 조합) 여러 단계 작업', pick: '-', alt: null, why: `제한 시간을 넘긴 조합: ${slow.join(', ')}.` });
}
{
  const sh = [...rows.values()].filter((r) => typeof r.shortAvg === 'number');
  if (sh.length) {
    const top = Math.max(...sh.map((r) => r.shortAvg)), near = sh.filter((r) => top - r.shortAvg <= 2).sort((a, b) => (a.shortSec ?? 1e9) - (b.shortSec ?? 1e9));
    criteria.push({ work: '한 번에 끝나는 짧은 질문과 작업', pick: name(near[0]), alt: near.slice(1, 3).map(name).join(', ') || null, why: `일반 과제 33개 평균이 최고점(${top})에서 2점 안에 있는 조합이 ${near.length}개이고, 그중 응답이 가장 빨랐습니다(과제당 중앙값 ${near[0].shortSec}초). 2점은 과제 한 개의 오답 하나에 해당하는 크기라 같은 수준으로 봅니다.` });
  }
}

// ---------- output ----------
const columns = [
  ...OPEN.map((t) => ({ id: t.id, title: t.title, sub: t.sub })), { id: 'openAvg', title: '고난도 평균', sub: '네 과제' },
  ...PROJECT.map((t) => ({ id: t.id, title: t.title, sub: t.sub })),
  ...CATEGORIES.map((c) => ({ id: `cat-${c.id}`, title: c.name.replace(/\(.*\)/, '') })), { id: 'shortAvg', title: '일반 평균' }, { id: 'shortSec', title: '응답 시간', sub: '일반 과제 중앙값' },
  { id: 'cost', title: '정가 환산 비용', sub: '측정 전체' }, { id: 'timeouts', title: '시간 초과', sub: '건수/호출' },
];
const groups = [{ title: '고난도: 정답이 없는 과제 (점수 · 범위 · 횟수 · 걸린 시간)', span: OPEN.length + 1 }, { title: '고난도: 정답이 있는 과제', span: PROJECT.length }, { title: '일반 과제 33개 (분류별 점수)', span: CATEGORIES.length + 2 }, { title: '비용과 안정성', span: 2 }];
const extra = readJson(join(DATA, 'report-notes.json'), {});
const report = {
  title: 'Grok · Claude 통합 성적표', generatedAt: new Date().toISOString(),
  scope: `${since.slice(0, 16).replace('T', ' ')}(UTC) 이후 측정 ${runs.length}회, 호출 ${records.length}건 · 실사용 환경`,
  summary: extra.summary || [], columns, groups,
  rows: sorted.map((r) => ({ key: r.key, label: r.label, sub: `추론 강도 ${EFFORT[r.effort] || r.effort}`, provider: r.provider, cells: r.cells })),
  legend: '● 그 열의 최고점 · ○ 최고점과 측정 편차 안에서 같음(반복 측정의 점수 범위가 겹침). 고난도 점수는 반복 측정의 중앙값이고, 100점은 측정된 답안 가운데 가장 좋은 결과입니다(수요 예측은 이론상 최소 오차).',
  criteria: [...criteria, ...(extra.criteria || [])], notes: extra.notes || [],
  lines, spreads: Object.fromEntries(Object.entries(tiedSets).map(([k, v]) => [k, v.spread])),
};
writeFileSync(join(DATA, 'report.json'), JSON.stringify(report, null, 1));
const cellMd = (x) => (x ? `${x.v}${x.mark === 'best' ? ' ●' : x.mark === 'tie' ? ' ○' : ''}${x.s ? ` (${x.s})` : ''}` : '-');
const md = [`# ${report.title}`, '', `${report.scope}`, '', ...report.summary.map((s) => `- ${s}`), '',
  `| 모델 · 추론 강도 | ${columns.map((c) => c.title).join(' | ')} |`, `|---|${columns.map(() => '---').join('|')}|`,
  ...sorted.map((r) => `| ${name(r)} | ${columns.map((c) => cellMd(r.cells[c.id])).join(' | ')} |`), '', report.legend, '',
  '## 작업별 모델 선택 기준', '', '| 작업 종류 | 먼저 쓸 모델 | 대안 | 근거 |', '|---|---|---|---|', ...report.criteria.map((c) => `| ${c.work} | ${c.pick} | ${c.alt || '-'} | ${c.why} |`), '',
  '## 읽을 때의 주의점', '', ...report.notes.map((n) => `- ${n}`), ''].join('\n');
writeFileSync(join(DATA, 'report.md'), md);
console.log(md);
