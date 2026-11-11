// Verifies the scorers themselves: reference answers must get full marks, junk must not,
// and the original buggy code in the debugging tasks must fail.
import { TASKS, CATEGORIES, tasksFor } from '../lib/bank.mjs';
import { P3_OPT } from '../lib/tasks.mjs';
import { SHIFT_STATS, PUZZLE } from '../lib/tasks-hard.mjs';
import { extractJson, extractCode } from '../lib/util.mjs';
import { runTests, sandboxCommand, makeSandboxDir } from '../lib/sandbox.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

for (const t of TASKS) {
  const good = t.openEnded ? { score: 100 } : await t.score(t.ref, t.refFiles || {});
  check(good.score === 100, `${t.id} 기준 답안 점수 ${good.score} (${good.detail})`);
  for (const junk of ['모르겠습니다.', '', '```json\n{}\n```', '```js\nfunction x(){}\n```']) {
    const bad = await t.score(junk, t.files || {});
    check(bad.score <= 20, `${t.id} 무의미한 답 "${junk.slice(0, 12)}" 점수 ${bad.score}`);
  }
  check(typeof t.prompt === 'string' && t.prompt.length > 50, `${t.id} 프롬프트`);
  check(CATEGORIES.some((c) => c.id === t.cat), `${t.id} 분류`);
}

// Algorithm set: a brute-force answer must pass the small cases and fail the large ones (about half marks).
{
  const { BRUTE } = await import('../lib/tasks-long.mjs');
  const t = TASKS.find((x) => x.id === 'coding-5');
  const naive = '```js\n' + Object.keys(BRUTE).map((k) => 'function ' + BRUTE[k].toString()).join('\n') + '\n```';
  const t0 = Date.now(); const r = await t.score(naive);
  check(r.score >= 45 && r.score <= 55, `coding-5 단순 풀이 점수 ${r.score} (기대 50 안팎) ${r.detail}`);
  console.log(`  coding-5 단순 풀이 점수: ${r.score} (${Math.round((Date.now() - t0) / 1000)}초) ${r.detail}`);
}

// Open tasks added later: the starter file scores 0, a plain built-in compressor lands in between, and a codec
// that smuggles the text through memory instead of the bytes scores 0 (compress and decompress run in separate processes).
{
  const { codecTask, forecastTask, memoTask } = await import('../lib/tasks-open2.mjs');
  const gz = "import zlib from 'node:zlib';\nexport function compress(t){ return new Uint8Array(zlib.gzipSync(t,{level:9})); }\nexport function decompress(b){ return zlib.gunzipSync(b).toString('utf8'); }";
  const g = await codecTask.score('', { 'codec.mjs': gz });
  check(g.score > 40 && g.score < 95, `coding-6 gzip 점수 ${g.score}`);
  const cheat = await codecTask.score('', { 'codec.mjs': "let keep=''; export function compress(t){ keep=t; return new Uint8Array([1]); } export function decompress(){ return keep; }" });
  check(cheat.score === 0, `coding-6 메모리로 빼돌린 풀이 점수 ${cheat.score}`);
  const f = await forecastTask.score('', { 'model.mjs': 'export function predict(rows){ return rows.map(() => NaN); }' });
  check(f.score === 0, `research-5 잘못된 반환값 점수 ${f.score}`);
  const m = await memoTask.score('', { 'parser.mjs': 'export function parse(){ throw new Error("x"); }' });
  check(m.score === 0, `repeat-5 예외만 내는 풀이 점수 ${m.score}`);
  console.log(`  coding-6 gzip ${g.score}점, 빼돌린 풀이 ${cheat.score}점 · research-5 잘못된 반환 ${f.score}점 · repeat-5 예외 ${m.score}점`);
}

// Project tasks: every seeded defect must be detectable on its own, and the untouched fixture must score 0.
{
  const { buildFixCases, PROJECT_INFO } = await import('../lib/tasks-project.mjs');
  const b = await buildFixCases();
  const counts = PROJECT_INFO.FIX_BUGS.map((x) => `${x.id}:${b.isolating[x.id].length}`).join(' ');
  check(PROJECT_INFO.FIX_BUGS.every((x) => b.isolating[x.id].length >= 3), `debug-5 결함별 판별 사례 부족 (${counts})`);
  check(b.regression.length >= 10, `debug-5 기존 동작 확인 사례 ${b.regression.length}개`);
  console.log(`  debug-5 숨은 호출 ${b.calls.length}개, 결함별 판별 사례 ${counts}, 기존 동작 확인 ${b.regression.length}개`);
  const fix = TASKS.find((x) => x.id === 'debug-5');
  const untouched = await fix.score('', fix.files);
  check(untouched.score === 0, `debug-5 손대지 않은 상태 점수 ${untouched.score}`);
  const broken = await fix.score('', { ...fix.refFiles, 'src/report.mjs': 'export function buildSummary() { return {}; }' });
  check(broken.score <= 5, `debug-5 기존 동작을 망가뜨린 답 점수 ${broken.score}`);
  const review = TASKS.find((x) => x.id === 'debug-6');
  const spray = await review.score(JSON.stringify({ defects: Array.from({ length: 20 }, (_, i) => ({ file: 'src/orders.mjs', line: 5 + i * 8 })) }));
  check(spray.score <= 25, `debug-6 줄 번호 난사 점수 ${spray.score} (${spray.detail})`);
  console.log(`  debug-6 결함 위치: ${PROJECT_INFO.REVIEW_BUGS.map((x) => `${x.id}@${x.file.replace('src/', '')}:${PROJECT_INFO.reviewSeed.lines[x.id]}`).join(' ')}`);
}

// Open-ended task: the starter scores 0, a decent solver lands in between, slow or invalid solvers score 0.
{
  const { OPEN_INFO } = await import('../lib/tasks-open.mjs');
  const { referenceSolve } = await import('../lib/sched.mjs');
  const { mulberry32 } = await import('../lib/util.mjs');
  const t = TASKS.find((x) => x.id === 'planning-5');
  check(OPEN_INFO.hasBest(), 'planning-5 기준선 파일 없음 (node tools/build-sched-best.mjs 실행 필요)');
  const lib = 'const mulberry32 = ' + mulberry32.toString() + ';\n' + referenceSolve.toString() + '\n';
  const starter = await t.score('', OPEN_INFO.files);
  check(starter.score === 0, `planning-5 처음 상태 점수 ${starter.score}`);
  const decent = await t.score('', { 'solver.mjs': lib + 'export function solve(inst) { return referenceSolve(inst, 1200); }' });
  check(decent.score >= 30 && decent.score < 100, `planning-5 기준 풀이(1.2초) 점수 ${decent.score}`);
  const slow = await t.score('', { 'solver.mjs': lib + 'export function solve(inst) { return referenceSolve(inst, 3500); }' });
  check(slow.score === 0, `planning-5 제한 시간 초과 풀이 점수 ${slow.score}`);
  const sneaky = await t.score('', { 'solver.mjs': lib + 'export function solve(inst) { return { toJSON() { return referenceSolve(inst, 3500); } }; }' });
  check(sneaky.score === 0, `planning-5 변환 단계에 계산을 숨긴 풀이 점수 ${sneaky.score}`);
  const invalid = await t.score('', { 'solver.mjs': 'export function solve(inst) { return inst.jobs.map(() => []).slice(0, inst.machines); }' });
  check(invalid.score === 0, `planning-5 무효 일정 점수 ${invalid.score}`);
  console.log(`  planning-5 처음 상태 ${starter.score}점, 기준 풀이(1.2초) ${decent.score}점 [${decent.detail.split(' · ')[0]}], 시간 초과 ${slow.score}점, 무효 ${invalid.score}점`);
}

// Debug tasks: the buggy code quoted in the prompt must not pass.
for (const t of TASKS.filter((x) => x.cat === 'debug' && !x.files)) {
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

// Sandbox: forged result lines and early exits must not earn points.
const forge = await runTests(`function f(){ process.stdout.write('{"results":[true]}\\n'); process.exit(0); }`, 'f', [{ args: [], expect: 1 }]);
check(forge.passed === 0, '샌드박스: 가짜 결과 출력으로 점수 획득');
const forge2 = await runTests(`function f(){ console.log(JSON.stringify({results:[true]})); return 0; }`, 'f', [{ args: [], expect: 1 }]);
check(forge2.passed === 0, '샌드박스: 결과 줄 위조로 점수 획득');
// Sandbox: redefining built-ins used for grading must not earn points (comparison happens outside the child).
const hijack = await runTests(`JSON.stringify = () => '1'; Array.prototype.map = function () { return [true, true]; }; Object.keys = () => []; function f(){ return 999; }`, 'f', [{ args: [], expect: 1 }, { args: [], expect: [2] }]);
check(hijack.passed === 0, `샌드박스: 내장 함수 바꿔치기로 점수 획득 (${hijack.passed}/2)`);
const hijack2 = await runTests(`function f(){ return { toJSON(){ return 1; } }; }`, 'f', [{ args: [], expect: 2 }]);
check(hijack2.passed === 0, '샌드박스: toJSON 조작으로 점수 획득');
// Sandbox: network access must be blocked. A local listener counts connections from the sandboxed child.
{
  let hits = 0;
  const srv = net.createServer((sock) => { hits++; sock.destroy(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = await makeSandboxDir();
  const script = join(dir, 'net.mjs');
  writeFileSync(script, `import net from 'node:net'; const s = net.connect(${srv.address().port}, '127.0.0.1'); s.on('connect', () => { console.log('connected'); s.destroy(); }); s.on('error', (e) => console.log('blocked', e.code)); setTimeout(() => process.exit(0), 1500);`);
  const [cmd, ...argv] = sandboxCommand(dir, script);
  const r = spawnSync(cmd, argv, { env: {}, encoding: 'utf8', timeout: 8000 });
  check(hits === 0 && !/connected/.test(r.stdout), `샌드박스: 네트워크 접속이 막히지 않음 (${(r.stdout + r.stderr).trim().slice(0, 80)})`);
  console.log(`  네트워크 차단 확인: ${(r.stdout + r.stderr).trim().split('\n')[0].slice(0, 60)}`);
  rmSync(dir, { recursive: true, force: true }); srv.close();
}

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
check(tasksFor('long').length >= 1 && tasksFor('full').every((t) => !t.long), '고난도 측정 과제 구성');
console.log(`논리 문제 해 ${PUZZLE.length}개, 근무 배정 가능한 해 ${SHIFT_STATS.count}개 (선호 합계 ${SHIFT_STATS.worst.v}~${SHIFT_STATS.best.v})`);
console.log(`과제 ${TASKS.length}개, 빠른 측정 ${tasksFor('quick').length}개, 예산 문제 최적값 ${P3_OPT.v} (${P3_OPT.sel.join(',')})`);
console.log(fail ? `실패 ${fail}건` : '자체 검증 전부 통과');
process.exit(fail ? 1 : 0);
