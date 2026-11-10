// Verifies the scorers themselves: reference answers must get full marks, junk must not,
// and the original buggy code in the debugging tasks must fail.
import { TASKS, CATEGORIES, tasksFor } from '../lib/bank.mjs';
import { P3_OPT } from '../lib/tasks.mjs';
import { SHIFT_STATS, PUZZLE } from '../lib/tasks-hard.mjs';
import { extractJson, extractCode } from '../lib/util.mjs';
import { runTests } from '../lib/sandbox.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

for (const t of TASKS) {
  const good = await t.score(t.ref);
  check(good.score === 100, `${t.id} 기준 답안 점수 ${good.score} (${good.detail})`);
  for (const junk of ['모르겠습니다.', '', '```json\n{}\n```', '```js\nfunction x(){}\n```']) {
    const bad = await t.score(junk);
    check(bad.score <= 20, `${t.id} 무의미한 답 "${junk.slice(0, 12)}" 점수 ${bad.score}`);
  }
  check(typeof t.prompt === 'string' && t.prompt.length > 50, `${t.id} 프롬프트`);
  check(CATEGORIES.some((c) => c.id === t.cat), `${t.id} 분류`);
}

// Debug tasks: the buggy code quoted in the prompt must not pass.
for (const t of TASKS.filter((x) => x.cat === 'debug')) {
  const buggy = /```js\n([\s\S]*?)```/.exec(t.prompt)[1];
  const r = await t.score('```js\n' + buggy + '\n```');
  check(r.score < 100, `${t.id} 버그 원본이 만점 (${r.score})`);
  console.log(`  ${t.id} 버그 원본 점수: ${r.score}`);
}

// Sandbox: file writes and process spawning must be blocked for model-written code.
const esc = await runTests(`function f(){ require('fs').writeFileSync('/tmp/bm-escape-test','x'); return 1; }`, 'f', [{ args: [], expect: 1 }]);
check(esc.passed === 0, '샌드박스: 파일 쓰기가 막히지 않음');
const esc2 = await runTests(`function f(){ return process.binding('fs') ? 1 : 0; }`, 'f', [{ args: [], expect: 1 }]);
check(esc2.passed === 0, '샌드박스: 내부 바인딩 접근이 막히지 않음');
const loop = await runTests('function f(){ while(true){} }', 'f', [{ args: [], expect: 1 }], 1500);
check(loop.passed === 0 && /timeout/.test(loop.detail), '샌드박스: 무한 반복 중단 실패');

// Extraction.
check(extractJson('설명\n```json\n{"a":1}\n```\n끝').a === 1, 'JSON 코드블록 추출');
check(extractJson('답은 {"a": [1,2]} 입니다').a.length === 2, 'JSON 본문 추출');
check(extractJson('처음 {"a":1} 그리고 최종\n```json\n{"a":2}\n```').a === 2, '마지막 JSON 우선');
check(extractCode('```js\nfunction a(){}\n```\n수정\n```js\nfunction b(){}\n```').includes('b()'), '마지막 코드블록 우선');

// Partial credit sanity.
const p1 = TASKS.find((t) => t.id === 'planning-1');
const slow = { schedule: [['A', 0, 3], ['B', 3, 5], ['C', 5, 9], ['D', 9, 11], ['E', 11, 14], ['F', 14, 15], ['G', 15, 17], ['H', 17, 20]].map(([task, start, end]) => ({ task, worker: 1, start, end })) };
const s = await p1.score(JSON.stringify(slow));
check(s.score > 60 && s.score < 100, `planning-1 느린 일정 부분 점수 ${s.score}`);
const bad = await p1.score(JSON.stringify({ schedule: slow.schedule.map((r) => (r.task === 'C' ? { ...r, start: 0, end: 4 } : r)) }));
check(bad.score === 0, `planning-1 규칙 위반 점수 ${bad.score}`);

check(PUZZLE.length === 1, `논리 문제의 해가 ${PUZZLE.length}개 (유일해야 함)`);
check(SHIFT_STATS.count >= 5 && SHIFT_STATS.best.v > SHIFT_STATS.worst.v, `근무 배정: 가능한 해 ${SHIFT_STATS.count}개`);
check(tasksFor('quick').every(Boolean) && tasksFor('quick').length === CATEGORIES.length, '빠른 측정 과제 구성');
console.log(`논리 문제 해 ${PUZZLE.length}개, 근무 배정 가능한 해 ${SHIFT_STATS.count}개 (선호 합계 ${SHIFT_STATS.worst.v}~${SHIFT_STATS.best.v})`);
console.log(`과제 ${TASKS.length}개, 빠른 측정 ${tasksFor('quick').length}개, 예산 문제 최적값 ${P3_OPT.v} (${P3_OPT.sel.join(',')})`);
console.log(fail ? `실패 ${fail}건` : '자체 검증 전부 통과');
process.exit(fail ? 1 : 0);
