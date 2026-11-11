// Judges every stored long-report answer again with one fixed pair of judges, one from each model family,
// so every answer is scored by the same judges under the same settings. Results go to data/rejudge.json.
//   node tools/rejudge.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from '../lib/bank.mjs';
import { judgeWork } from '../lib/judge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), DATA = join(ROOT, 'data');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const since = (readJson(join(DATA, 'campaign.json'), {}).since) || '1970';
const JUDGES = [{ provider: 'grok', model: 'grok-4.7', effort: 'low', timeoutSec: 300 }];
const task = TASKS.find((t) => t.id === 'writing-1');
const out = readJson(join(DATA, 'rejudge.json'), {});
const todo = [];
for (const f of readdirSync(join(DATA, 'runs')).filter((x) => x.endsWith('.json')).sort()) {
  const run = readJson(join(DATA, 'runs', f), null);
  if (!run || run.startedAt < since) continue;
  for (const m of run.models) { const t = m.tasks && m.tasks['writing-1']; if (t && t.kind === 'ok' && t.answer && !out[`${run.id}|${m.key}`]) todo.push({ key: `${run.id}|${m.key}`, answer: t.answer }); }
}
console.log(`심사 대상 ${todo.length}건`);
const worker = async () => { for (let x = todo.shift(); x; x = todo.shift()) { const j = await judgeWork(task, x.answer, JUDGES); out[x.key] = j; writeFileSync(join(DATA, 'rejudge.json'), JSON.stringify(out)); process.stdout.write(j.results.map((r) => (r.ok ? r.score : 'x')).join('/') + ' '); } };
await Promise.all([worker(), worker(), worker()]);
console.log('\n완료');
