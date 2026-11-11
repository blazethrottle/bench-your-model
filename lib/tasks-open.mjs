// planning-5: an optimization task with no correct answer. The model writes a solver; the harness runs that
// solver in the sandbox on hidden instances with a fixed time per instance and scores schedule quality.
// 0 points = the trivial schedule in the starter file, 100 points = the offline reference (or the best result seen so far).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProjectOutputs } from './sandbox.mjs';
import { genInstance, evaluate, baselineSolve, HIDDEN, PUBLIC } from './sched.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEST_FILE = join(ROOT, 'fixtures', 'sched', 'best.json');
const SEEN_FILE = join(ROOT, 'data', 'sched-best-seen.json');
const LIMIT_MS = 2000, GRACE_MS = 400;

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
// The 100-point line per instance: the better of the offline reference and the best value recorded before the
// line was frozen. It no longer moves while models are measured; tools/report.mjs rescoring uses the stored raw values.
function bestLine() {
  const ref = readJson(BEST_FILE), seen = readJson(SEEN_FILE); const out = {};
  for (const [seed] of HIDDEN) out[seed] = Math.min(ref[seed] ? ref[seed].best : Infinity, seen[seed] ?? Infinity);
  return out;
}

const SOLVER_STARTER = `// 풀이 프로그램. solve(instance)가 일정(기계별 작업 번호 배열)을 반환한다.
// 아래는 가장 단순한 배치다. 이 파일을 고쳐 더 좋은 일정을 만들어라.
export function solve(instance) {
  const out = Array.from({ length: instance.machines }, () => []);
  instance.jobs.forEach((job, i) => out[i % instance.machines].push(job.id));
  return out;
}
`;
const EVALUATE_SRC = `// 연습용 채점 스크립트: node evaluate.mjs
// instances/ 의 연습 문제마다 solve()를 실행해 유효성, 가중 지연 합계, 걸린 시간을 출력한다.
import { readdirSync, readFileSync } from 'node:fs';
import { solve } from './solver.mjs';

function evaluate(instance, solution) {
  const { machines, jobs, setup } = instance;
  if (!Array.isArray(solution) || solution.length !== machines) return { valid: false, reason: '기계 수가 맞지 않음' };
  const seen = new Uint8Array(jobs.length); let count = 0, value = 0;
  for (const seq of solution) {
    if (!Array.isArray(seq)) return { valid: false, reason: '기계별 순서가 배열이 아님' };
    let t = 0, prev = -1;
    for (const id of seq) {
      if (!Number.isInteger(id) || id < 0 || id >= jobs.length || seen[id]) return { valid: false, reason: '작업 번호가 잘못됐거나 중복됨' };
      seen[id] = 1; count++;
      const j = jobs[id];
      t += (prev < 0 ? 0 : setup[prev][j.family]) + j.duration;
      if (t > j.due) value += j.weight * (t - j.due);
      prev = j.family;
    }
  }
  if (count !== jobs.length) return { valid: false, reason: '빠진 작업이 있음' };
  return { valid: true, value };
}

for (const file of readdirSync('instances').filter((f) => f.endsWith('.json')).sort()) {
  const instance = JSON.parse(readFileSync('instances/' + file, 'utf8'));
  const t0 = performance.now();
  const result = evaluate(instance, solve(structuredClone(instance)));
  const ms = Math.round(performance.now() - t0);
  console.log(file, result.valid ? '가중 지연 합계 ' + result.value : '무효: ' + result.reason, '| ' + ms + 'ms' + (ms > instance.timeLimitMs ? ' (제한 시간 초과)' : ''));
}
`;
const README = `# 작업 일정 최적화

## 문제

작업 여러 개를 기계 여러 대에 나눠 순서대로 처리한다. 목표는 **가중 지연 합계를 최소로** 하는 일정을 찾는 것이다.

- 각 작업은 \`id\`, 소요 시간 \`duration\`, 납기 \`due\`, 가중치 \`weight\`, 종류 \`family\`를 갖는다.
- 각 기계는 시각 0에 시작해 자기에게 배정된 작업을 주어진 순서대로 쉬지 않고 처리한다.
- 한 기계에서 종류가 다른 작업이 이어지면 그 사이에 준비 시간 \`setup[앞 작업의 종류][뒤 작업의 종류]\`이 든다. 같은 종류면 0이고, 기계의 첫 작업 앞에는 준비 시간이 없다.
- 작업의 완료 시각이 납기보다 늦으면 지연이 생긴다. 지연 비용은 \`weight × (완료 시각 − 납기)\`이고, 늦지 않으면 0이다.
- 모든 작업의 지연 비용을 더한 값이 가중 지연 합계다. 작을수록 좋다.

## 입출력

\`solver.mjs\`의 \`solve(instance)\`를 고친다.

- 입력 \`instance\`: \`{ machines, jobs: [{ id, duration, due, weight, family }], setup, timeLimitMs }\`. 작업의 \`id\`는 0부터 차례로 매겨져 있다.
- 반환: 길이가 \`machines\`인 배열. 각 원소는 그 기계가 처리할 작업의 \`id\`를 처리 순서대로 담은 배열이다. 모든 작업이 정확히 한 번씩 들어 있어야 한다.

## 채점

- 공개하지 않은 문제 여섯 개(작업 160~340개, 기계 3~6대)로 채점한다. \`instances/\`의 두 문제는 연습용이다.
- 문제마다 \`solve\`를 한 번 호출한다. **호출 하나가 ${LIMIT_MS}ms 안에 끝나야 한다**(\`instance.timeLimitMs\`). 넘기면 그 문제는 0점이다. 채점 기기의 속도가 다를 수 있으니 여유를 두어라.
- 유효하지 않은 일정(빠지거나 중복된 작업 등)도 그 문제는 0점이다.
- 점수는 일정의 품질이다. 훨씬 긴 시간을 들여 찾은 기준 일정의 가중 지연 합계를 내 일정의 가중 지연 합계로 나눈 비율에 비례한다. 기준 일정과 같으면 100점, 합계가 기준의 두 배면 약 50점, 이 폴더에 들어 있는 처음 상태의 단순 배치는 0점이다. 정해진 정답은 없으며 더 좋은 일정을 찾을수록 점수가 오른다.
- 실행 환경: Node.js 단일 스레드, 외부 패키지 없음, 파일과 네트워크 접근 불가. \`solver.mjs\` 하나만 채점에 쓰인다.

## 연습

\`node evaluate.mjs\`를 실행하면 연습 문제의 가중 지연 합계와 걸린 시간이 나온다.
`;

const instances = () => HIDDEN.map(([seed, n, m]) => ({ seed, inst: genInstance(seed, n, m) }));
const files = { 'README.md': README, 'solver.mjs': SOLVER_STARTER, 'evaluate.mjs': EVALUATE_SRC, 'package.json': '{ "name": "schedule", "private": true, "type": "module" }\n' };
PUBLIC.forEach(([seed, n, m], i) => { files[`instances/practice${i + 1}.json`] = JSON.stringify(genInstance(seed, n, m)); });

export const openTask = {
  id: 'planning-5', cat: 'planning', title: '일정 최적화 풀이 프로그램', long: true, openEnded: true, timeoutSec: 600,
  files, keep: ['solver.mjs'], ref: '기준 풀이',
  prompt: `무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라.
제한 시간은 10분이다. 시간이 지나면 그때까지 작업 폴더에 남긴 파일만으로 채점하고, 응답으로 내는 답은 사라진다. 고친 파일을 일찍 저장하고, 시간을 남기고 끝내라.

현재 작업 폴더에 일정 최적화 과제가 있다. README.md에 문제, 입출력, 채점 방식이 적혀 있다.

할 일: solver.mjs의 solve(instance)를 고쳐, 공개하지 않은 문제에서 가중 지연 합계가 가능한 한 작은 일정을 만들게 하라.

- 이 과제에는 정해진 정답이 없다. 더 좋은 일정을 찾을수록 점수가 오른다. 유효한 일정을 내는 것만으로는 점수가 거의 없다.
- 호출 하나의 제한 시간을 넘기거나 유효하지 않은 일정을 내면 그 문제는 0점이다.
- 채점에는 solver.mjs 하나만 쓰인다. 다른 파일에 의존하지 마라.
- 작업은 이 폴더 안에서만 하라. 끝나면 어떤 방법을 썼는지 세 줄 이내로 요약해 응답하라.`,
  async score(_answer, work) {
    const src = work && work['solver.mjs'];
    if (!src) return { score: 0, detail: 'solver.mjs 를 찾지 못함' };
    const list = instances(); const best = bestLine();
    const res = await runProjectOutputs({ 'solver.mjs': src, 'package.json': files['package.json'] }, 'solver.mjs', list.map((x) => ({ fn: 'solve', args: [x.inst] })), list.length * (LIMIT_MS + GRACE_MS) + 15000);
    const parts = []; const raw = {}; let total = 0;
    list.forEach((x, i) => {
      const base = evaluate(x.inst, baselineSolve(x.inst)).value;
      const out = res.outputs[i]; const ms = res.ms[i];
      const ev = out === undefined ? { valid: false, reason: res.fatal || '실행 실패' } : evaluate(x.inst, out);
      if (!ev.valid) { parts.push('무효'); return; }
      if (ms === null || ms > LIMIT_MS + GRACE_MS) { parts.push('시간 초과'); return; }
      raw[x.seed] = ev.value;
      const line = Math.min(best[x.seed], ev.value);
      // Quality ratio (reference cost / this cost), rescaled so the starter schedule is 0 and matching the line is 100.
      // A straight line between starter and reference would squeeze every decent solver into 97-100.
      const q = (v) => (v <= 0 ? 1 : Math.min(1, line / v));
      const pts = base <= line ? 0 : Math.max(0, (100 * (q(ev.value) - q(base))) / (1 - q(base)));
      total += pts; parts.push(String(Math.round(pts)));
    });
    return { score: Math.round(total / list.length), detail: `문제별 점수 ${parts.join(' ')} · 가중 지연 합계 ${list.map((x) => raw[x.seed] ?? '-').join(' ')}`, raw };
  },
};

// Self-check helpers.
export const OPEN_INFO = { files, BEST_FILE, hasBest: () => existsSync(BEST_FILE), LIMIT_MS };
