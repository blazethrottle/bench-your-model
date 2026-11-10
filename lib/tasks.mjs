// Task bank. Every task has: id, cat, title, prompt, score(answerText) -> { score: 0..100, detail }.
// Tasks with `judge` are scored partly by blind LLM judges (see judge.mjs); `score` returns the deterministic part.
// `ref` is a reference answer used only by test/selfcheck.mjs.
import { runTests } from './sandbox.mjs';
import {
  mulberry32, extractJson, extractCode, extractText, extractSvg, num, sameSet, isMissing,
} from './util.mjs';

export const CATEGORIES = [
  { id: 'coding', name: '코딩', desc: '요구 사항대로 함수를 작성하고 숨은 테스트로 채점합니다.' },
  { id: 'debug', name: '디버깅', desc: '버그가 있는 코드를 고치고 숨은 테스트로 채점합니다.' },
  { id: 'research', name: '리서치(자료 분석)', desc: '주어진 자료에서 계산, 대조, 모순 탐지, 없는 정보 구분을 합니다.' },
  { id: 'planning', name: '플래닝', desc: '제약 조건을 모두 지키는 일정과 배분을 만들고 규칙으로 검증합니다.' },
  { id: 'repeat', name: '반복업무 정확도', desc: '같은 규칙을 여러 건에 빠짐없이 적용하는지 건별로 대조합니다.' },
  { id: 'reasoning', name: '추론과 계산', desc: '정답이 하나인 논리, 수리 문제입니다.' },
  { id: 'product', name: '기획', desc: '제약이 있는 기획서를 쓰고, 형식 검사와 맹검 평가로 채점합니다.' },
  { id: 'creative', name: '창의력', desc: '제약이 있는 창작물을 만들고, 제약 검사와 맹검 평가로 채점합니다.' },
  { id: 'visual', name: '이미지 제작(SVG 코드)', desc: '그림을 코드로 그리게 하고 구조와 수치 정확도를 검사합니다. 실험 항목입니다.' },
];

export const JSON_RULE = '\n\n최종 답은 응답 본문 맨 끝에 ```json 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.';
const CODE_RULE = '\n\n최종 코드는 응답 본문 맨 끝에 ```js 코드블록 하나로만 제시하라. 함수 선언만 포함하고 export, 테스트 코드, 실행 예시는 넣지 마라. 파일을 만들지 말고 응답 본문에 직접 써라.';

export const pct = (ok, total) => Math.round((100 * ok) / total);

// ---------- coding / debug ----------
export function codeTask({ id, cat, title, body, fnName, cases, ref }) {
  return {
    id, cat, title, ref: '```js\n' + ref + '\n```',
    prompt: body + CODE_RULE,
    async score(answer) {
      const r = await runTests(extractCode(answer), fnName, cases);
      return { score: pct(r.passed, r.total), detail: r.detail };
    },
  };
}

const coding = [
  codeTask({
    id: 'coding-1', cat: 'coding', title: '구간 병합', fnName: 'mergeIntervals',
    body: `JavaScript 함수 mergeIntervals(intervals)를 작성하라.
- 입력: [시작, 끝] 형태의 닫힌 구간 배열. 정렬되어 있지 않을 수 있다.
- 겹치거나 끝점이 맞닿은 구간([1,4]와 [4,5])은 하나로 합친다.
- 출력: 시작값 오름차순으로 정렬된 병합 결과 배열. 입력이 비어 있으면 빈 배열.`,
    cases: [
      { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expect: [[1, 6], [8, 10], [15, 18]] },
      { args: [[]], expect: [] },
      { args: [[[1, 4], [4, 5]]], expect: [[1, 5]] },
      { args: [[[5, 7], [1, 2], [2, 3]]], expect: [[1, 3], [5, 7]] },
      { args: [[[1, 10], [2, 3], [4, 5]]], expect: [[1, 10]] },
      { args: [[[-3, -1], [-2, 0]]], expect: [[-3, 0]] },
      { args: [[[1, 1]]], expect: [[1, 1]] },
      { args: [[[3, 4], [1, 2]]], expect: [[1, 2], [3, 4]] },
    ],
    ref: `function mergeIntervals(intervals) {
  const s = intervals.map((x) => [...x]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}`,
  }),
  codeTask({
    id: 'coding-2', cat: 'coding', title: '빈도 상위 K개', fnName: 'topKFrequent',
    body: `JavaScript 함수 topKFrequent(words, k)를 작성하라.
- words: 문자열 배열. 대소문자를 구분한다("Apple"과 "apple"은 다른 단어).
- 등장 횟수가 많은 순서로 서로 다른 단어 k개를 배열로 반환한다.
- 횟수가 같으면 문자열 기본 비교(<) 기준 오름차순으로 정렬한다.
- 서로 다른 단어가 k개보다 적으면 있는 만큼만 반환한다.`,
    cases: [
      { args: [['a', 'b', 'a', 'c', 'b', 'a'], 2], expect: ['a', 'b'] },
      { args: [['x', 'y', 'z'], 2], expect: ['x', 'y'] },
      { args: [['b', 'a', 'b', 'a'], 1], expect: ['a'] },
      { args: [[], 3], expect: [] },
      { args: [['a'], 5], expect: ['a'] },
      { args: [['Apple', 'apple', 'apple'], 1], expect: ['apple'] },
      { args: [['c', 'b', 'a', 'c', 'b', 'a', 'd'], 3], expect: ['a', 'b', 'c'] },
    ],
    ref: `function topKFrequent(words, k) {
  const m = new Map();
  for (const w of words) m.set(w, (m.get(w) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, k).map((e) => e[0]);
}`,
  }),
  codeTask({
    id: 'coding-3', cat: 'coding', title: '시간 문자열 해석', fnName: 'parseDuration',
    body: `JavaScript 함수 parseDuration(str)를 작성하라. 문자열을 초 단위 정수로 바꾼다.
- 형식: "<음이 아닌 정수><단위>" 묶음이 하나 이상 이어진 문자열. 단위는 d(일), h(시간), m(분), s(초).
- 단위는 d, h, m, s 순서로만 나올 수 있고, 각 단위는 최대 한 번만 나온다. 예: "1h30m15s", "2d3s", "90m".
- 공백, 소수, 음수, 알 수 없는 단위, 순서 위반, 단위 중복, 빈 문자열, 숫자 없는 단위는 모두 잘못된 입력이다.
- 잘못된 입력에는 Error를 던진다.`,
    cases: [
      { args: ['1h30m15s'], expect: 5415 },
      { args: ['90m'], expect: 5400 },
      { args: ['1d'], expect: 86400 },
      { args: ['2d3s'], expect: 172803 },
      { args: ['0s'], expect: 0 },
      { args: ['10h0m'], expect: 36000 },
      { args: [''], throws: true },
      { args: ['5x'], throws: true },
      { args: ['1h1h'], throws: true },
      { args: ['30m1h'], throws: true },
      { args: ['1.5h'], throws: true },
      { args: [' 1h'], throws: true },
      { args: ['h'], throws: true },
      { args: ['-1h'], throws: true },
    ],
    ref: `function parseDuration(str) {
  const m = /^(?:(\\d+)d)?(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(str);
  if (typeof str !== 'string' || !m || str === '') throw new Error('invalid');
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}`,
  }),
];

const debug = [
  codeTask({
    id: 'debug-1', cat: 'debug', title: '이진 탐색 수정', fnName: 'lowerBound',
    body: `아래 함수는 오름차순 정렬된 배열에서 x 이상인 첫 원소의 인덱스를 반환해야 한다(그런 원소가 없으면 arr.length). 그런데 일부 입력에서 멈추지 않거나 틀린 값을 낸다. 원인을 찾아 고친 함수 전체를 제시하라. 함수 이름과 인자는 그대로 둔다.

\`\`\`js
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] < x) lo = mid;
    else hi = mid;
  }
  return lo;
}
\`\`\``,
    cases: [
      { args: [[1, 3, 5, 7], 5], expect: 2 },
      { args: [[1, 3, 5, 7], 8], expect: 4 },
      { args: [[], 1], expect: 0 },
      { args: [[1, 3, 5, 7], 0], expect: 0 },
      { args: [[2, 2, 2], 2], expect: 0 },
      { args: [[1, 2, 4], 3], expect: 2 },
      { args: [[1], 1], expect: 0 },
      { args: [[1], 2], expect: 1 },
      { args: [[1, 3, 5, 7], 7], expect: 3 },
    ],
    ref: `function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}`,
  }),
  codeTask({
    id: 'debug-2', cat: 'debug', title: '배열 묶기 수정', fnName: 'chunk',
    body: `아래 함수는 배열을 size개씩 묶어야 한다. 사용자 신고: "마지막 묶음이 사라질 때가 있고, size에 0을 넣으면 프로그램이 멈춘다." 고친 함수 전체를 제시하라. 함수 이름과 인자는 그대로 둔다.
요구 사항: 남는 원소는 마지막 묶음으로 포함한다. size가 양의 정수가 아니면 RangeError를 던진다.

\`\`\`js
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i + size <= arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
\`\`\``,
    cases: [
      { args: [[1, 2, 3, 4, 5], 2], expect: [[1, 2], [3, 4], [5]] },
      { args: [[1, 2, 3, 4], 2], expect: [[1, 2], [3, 4]] },
      { args: [[], 3], expect: [] },
      { args: [[1], 5], expect: [[1]] },
      { args: [[1, 2, 3], 1], expect: [[1], [2], [3]] },
      { args: [[1, 2], 0], throws: true },
      { args: [[1, 2], -1], throws: true },
      { args: [[1, 2], 1.5], throws: true },
    ],
    ref: `function chunk(arr, size) {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('size');
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}`,
  }),
  codeTask({
    id: 'debug-3', cat: 'debug', title: '금액 표시 수정', fnName: 'formatMoney',
    body: `아래 함수는 센트 단위 정수를 "$1,234.56" 형식으로 표시해야 한다. 신고된 증상: 5센트가 "$0.5"로 나오고, 음수 금액이 이상하게 표시된다. 고친 함수 전체를 제시하라. 함수 이름과 인자는 그대로 둔다.
요구 사항: 센트는 항상 두 자리. 달러 부분은 세 자리마다 쉼표. 음수는 "-$1,234.05"처럼 부호를 맨 앞에 둔다. 0은 "$0.00".

\`\`\`js
function formatMoney(cents) {
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const withCommas = String(dollars).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return '$' + withCommas + '.' + rest;
}
\`\`\``,
    cases: [
      { args: [123456], expect: '$1,234.56' },
      { args: [5], expect: '$0.05' },
      { args: [100], expect: '$1.00' },
      { args: [-123405], expect: '-$1,234.05' },
      { args: [0], expect: '$0.00' },
      { args: [99999999], expect: '$999,999.99' },
      { args: [-1], expect: '-$0.01' },
      { args: [1000], expect: '$10.00' },
      { args: [-100000], expect: '-$1,000.00' },
    ],
    ref: `function formatMoney(cents) {
  const neg = cents < 0, abs = Math.abs(cents);
  const d = String(Math.floor(abs / 100)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return (neg ? '-' : '') + '$' + d + '.' + String(abs % 100).padStart(2, '0');
}`,
  }),
];

// ---------- research (document analysis with answer keys) ----------
export function keyedTask({ id, cat, title, body, checks, ref }) {
  const keys = Object.keys(checks);
  return {
    id, cat, title, ref: '```json\n' + JSON.stringify(ref) + '\n```',
    prompt: body + JSON_RULE,
    score(answer) {
      const a = extractJson(answer);
      if (!a || Array.isArray(a)) return { score: 0, detail: 'JSON 답을 찾지 못함' };
      const wrong = keys.filter((k) => { try { return !checks[k](a[k]); } catch { return true; } });
      return { score: pct(keys.length - wrong.length, keys.length), detail: wrong.length ? `오답 문항: ${wrong.join(', ')}` : '전 문항 정답' };
    },
  };
}
const isNum = (n, tol = 0) => (v) => Math.abs(num(v) - n) <= tol;
const isStr = (s) => (v) => typeof v === 'string' && v.replace(/\s/g, '') === s;

const research = [
  keyedTask({
    id: 'research-1', cat: 'research', title: '분기 메모 대조',
    body: `아래는 한 회사의 3분기 내부 메모 네 건이다. 자료만 근거로 질문에 답하라.

[A. 영업 보고] 3분기 신규 계약은 42건이며, 이 중 수도권이 27건이다. 평균 계약 단가는 건당 1,800만 원이다. 2분기 신규 계약은 35건이었다.
[B. 재무 메모] 3분기 신규 계약 매출 합계는 7억 5,600만 원이다. 해지 고객은 6곳이며 모두 지방 고객이다. 분기 말 기준 전체 고객 수는 218곳이다.
[C. 운영 회의록] 배송 지연율은 7월 4.1%, 8월 3.6%, 9월 2.9%였다. 지연율 목표는 3.0% 이하다. 신규 물류센터는 대전에 11월 3일 문을 연다. 영업 보고의 수도권 계약 건수는 29건으로 집계되어 있다.
[D. 인사] 3분기 말 인원은 134명이고 4분기에 9명을 채용할 계획이다.

질문:
q1. A 기준으로 수도권 외 지역의 3분기 신규 계약은 몇 건인가? (숫자)
q2. A의 "건수 × 평균 단가"는 B의 매출 합계와 일치하는가? ("일치" 또는 "불일치")
q3. 3분기 신규 계약 건수는 2분기보다 몇 % 늘었는가? (숫자)
q4. 3분기 석 달 중 지연율 목표를 달성한 달은 몇 개인가? (숫자)
q5. 메모끼리 서로 다르게 적힌 수치가 하나 있다. 그 두 값을 배열로 써라. (예: [1, 2])
q6. 이 회사의 3분기 영업이익은 얼마인가? 자료에 없으면 "자료에 없음"이라고 써라.
q7. 4분기 채용이 계획대로 되고 퇴사자가 없다면 연말 인원은 몇 명인가? (숫자)

답 형식: {"q1": ..., "q2": ..., "q3": ..., "q4": ..., "q5": [...], "q6": ..., "q7": ...}`,
    checks: {
      q1: isNum(15), q2: isStr('일치'), q3: isNum(20), q4: isNum(1),
      q5: (v) => sameSet(v, [27, 29]), q6: isMissing, q7: isNum(143),
    },
    ref: { q1: 15, q2: '일치', q3: 20, q4: 1, q5: [27, 29], q6: '자료에 없음', q7: 143 },
  }),
  keyedTask({
    id: 'research-2', cat: 'research', title: '세 출처 교차 검증',
    body: `아래는 같은 제품(모델 K7)에 관한 세 출처다. 자료만 근거로 질문에 답하라.

[출처 1: 제조사 사양서, 2026-05] 배터리 용량 5,200mAh, 무게 198g, 충전 시간 68분(0→100%), 방수 등급 IP68, 출시가 89만 원.
[출처 2: 리뷰 기사, 2026-06] K7은 전작 K6(4,600mAh)보다 배터리가 600mAh 늘었다. 실측 무게는 201g이었다. 0→100% 충전에 1시간 12분이 걸렸다. 출시가는 89만 원이며 6월 할인으로 10% 내렸다. 방수 등급은 언급하지 않았다.
[출처 3: 판매 페이지, 2026-07] K7 배터리 5,000mAh, 무게 198g, 방수 IP67, 판매가 80만 1천 원.

질문:
q1. 출처 2의 서술로 계산한 K7의 배터리 용량은 몇 mAh인가? (숫자)
q2. 배터리 용량이 나머지 두 출처와 어긋나는 출처는 몇 번인가? (숫자)
q3. 출처 2의 실측 충전 시간은 출처 1의 수치보다 몇 분 긴가? (숫자)
q4. 6월 할인가는 몇 원인가? (숫자)
q5. 출처 3의 판매가는 6월 할인가와 일치하는가? ("일치" 또는 "불일치")
q6. 방수 등급을 서로 다르게 적은 두 출처의 번호를 배열로 써라.
q7. K6의 무게는 몇 g인가? 자료에 없으면 "자료에 없음"이라고 써라.

답 형식: {"q1": ..., "q2": ..., "q3": ..., "q4": ..., "q5": ..., "q6": [...], "q7": ...}`,
    checks: {
      q1: isNum(5200), q2: isNum(3), q3: isNum(4), q4: isNum(801000),
      q5: isStr('일치'), q6: (v) => sameSet(v, [1, 3]), q7: isMissing,
    },
    ref: { q1: 5200, q2: 3, q3: 4, q4: 801000, q5: '일치', q6: [1, 3], q7: '자료에 없음' },
  }),
  keyedTask({
    id: 'research-3', cat: 'research', title: '지표 표 해석',
    body: `아래 표는 한 서비스의 월별 지표다. 자료만 근거로 질문에 답하라.

| 월 | 방문자 | 가입 | 유료 전환 |
|---|---|---|---|
| 4월 | 12,000 | 600 | 48 |
| 5월 | 15,000 | 600 | 60 |
| 6월 | 10,000 | 700 | 49 |
| 7월 | 16,000 | 800 | 40 |

질문:
q1. 가입률(가입 ÷ 방문자)이 가장 높은 달은 몇 월인가? (숫자)
q2. 유료 전환율(유료 전환 ÷ 가입)이 가장 낮은 달은 몇 월인가? (숫자)
q3. 네 달의 유료 전환 합계는 몇 건인가? (숫자)
q4. "유료 전환 ÷ 방문자" 비율이 4월보다 높은 달은 몇 개인가? 같은 달은 세지 않는다. (숫자)
q5. 6월 방문자는 5월보다 몇 % 줄었는가? 소수 첫째 자리에서 반올림한 정수로 써라. (숫자)
q6. 8월 방문자는 몇 명인가? 자료에 없으면 "자료에 없음"이라고 써라.

답 형식: {"q1": ..., "q2": ..., "q3": ..., "q4": ..., "q5": ..., "q6": ...}`,
    checks: { q1: isNum(6), q2: isNum(7), q3: isNum(197), q4: isNum(1), q5: isNum(33), q6: isMissing },
    ref: { q1: 6, q2: 7, q3: 197, q4: 1, q5: 33, q6: '자료에 없음' },
  }),
];

// ---------- planning (constraint checkers) ----------
const P1 = { A: [3, []], B: [2, []], C: [4, ['A']], D: [2, ['A', 'B']], E: [3, ['C']], F: [1, ['D']], G: [2, ['E', 'F']], H: [3, ['B']] };
const P1_BEST = 12; // critical path A-C-E-G = 3+4+3+2, and a 12-day two-worker schedule exists (see ref).

const PLACES = {
  시장: { stay: 60, open: 540, close: 720 },
  미술관: { stay: 90, open: 600, close: 1020 },
  식당: { stay: 60, open: 720, close: 24 * 60, arriveBy: 810 },
  전망대: { stay: 45, open: 900, close: 1080 },
  서점: { stay: 30, open: 540, close: 1200 },
};
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m ? +m[1] * 60 + +m[2] : NaN; };

const PROJECTS = { P1: [30, 40], P2: [20, 25], P3: [45, 70], P4: [25, 30], P5: [15, 18], P6: [40, 55], P7: [10, 12], P8: [35, 50] };
const BUDGET = 100;
function projectsValid(sel) {
  const s = new Set(sel);
  if (s.size !== sel.length || sel.some((p) => !PROJECTS[p])) return false;
  if (sel.reduce((a, p) => a + PROJECTS[p][0], 0) > BUDGET) return false;
  if (s.has('P3') && !s.has('P7')) return false;
  if (s.has('P6') && s.has('P8')) return false;
  if (s.has('P2') && !(s.has('P1') || s.has('P4'))) return false;
  return true;
}
const projectsValue = (sel) => sel.reduce((a, p) => a + PROJECTS[p][1], 0);
export const P3_OPT = (() => {
  const names = Object.keys(PROJECTS); let best = { v: -1, sel: [] };
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const sel = names.filter((_, i) => mask & (1 << i));
    if (projectsValid(sel) && projectsValue(sel) > best.v) best = { v: projectsValue(sel), sel };
  }
  return best;
})();

const planning = [
  {
    id: 'planning-1', cat: 'planning', title: '두 사람 작업 일정',
    prompt: `작업 8개를 작업자 2명(1번, 2번)에게 배정해 가장 빨리 끝나는 일정을 짜라. 시간 단위는 일이고 0일에 시작한다.

| 작업 | 소요(일) | 먼저 끝나야 하는 작업 |
|---|---|---|
| A | 3 | 없음 |
| B | 2 | 없음 |
| C | 4 | A |
| D | 2 | A, B |
| E | 3 | C |
| F | 1 | D |
| G | 2 | E, F |
| H | 3 | B |

규칙: 한 작업자는 한 번에 한 작업만 한다. 작업은 중간에 끊지 않는다. 선행 작업이 모두 끝난 시점 이후에만 시작할 수 있다. 전체 종료 시점을 최소로 하라.

답 형식: {"schedule": [{"task": "A", "worker": 1, "start": 0, "end": 3}, ...]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ schedule: [
      { task: 'A', worker: 1, start: 0, end: 3 }, { task: 'C', worker: 1, start: 3, end: 7 }, { task: 'E', worker: 1, start: 7, end: 10 }, { task: 'G', worker: 1, start: 10, end: 12 },
      { task: 'B', worker: 2, start: 0, end: 2 }, { task: 'H', worker: 2, start: 2, end: 5 }, { task: 'D', worker: 2, start: 5, end: 7 }, { task: 'F', worker: 2, start: 7, end: 8 },
    ] }) + '\n```',
    score(answer) {
      const a = extractJson(answer); const sch = a && a.schedule;
      if (!Array.isArray(sch)) return { score: 0, detail: '일정 JSON을 찾지 못함' };
      const by = {}; const errs = [];
      for (const r of sch) { if (by[r.task]) errs.push(`${r.task} 중복`); by[r.task] = r; }
      for (const t of Object.keys(P1)) {
        const r = by[t];
        if (!r) { errs.push(`${t} 누락`); continue; }
        if (![1, 2].includes(Number(r.worker))) errs.push(`${t} 작업자 오류`);
        if (!(Number(r.start) >= 0) || Number(r.end) - Number(r.start) !== P1[t][0]) errs.push(`${t} 소요 시간 불일치`);
        for (const d of P1[t][1]) if (by[d] && Number(by[d].end) > Number(r.start)) errs.push(`${t}가 ${d}보다 먼저 시작`);
      }
      for (const w of [1, 2]) {
        const mine = sch.filter((r) => Number(r.worker) === w).sort((x, y) => x.start - y.start);
        for (let i = 1; i < mine.length; i++) if (Number(mine[i].start) < Number(mine[i - 1].end)) errs.push(`작업자 ${w} 겹침`);
      }
      if (errs.length) return { score: 0, detail: `규칙 위반: ${[...new Set(errs)].slice(0, 3).join(', ')}` };
      const makespan = Math.max(...sch.map((r) => Number(r.end)));
      return { score: Math.round(60 + 40 * Math.min(1, P1_BEST / makespan)), detail: `규칙 준수, 종료 ${makespan}일 (최적 ${P1_BEST}일)` };
    },
  },
  {
    id: 'planning-2', cat: 'planning', title: '하루 방문 동선',
    prompt: `하루 일정으로 다섯 곳을 모두 한 번씩 방문하는 동선을 짜라.

- 09:00에 호텔에서 출발하고, 18:30까지 호텔로 돌아와야 한다.
- 어느 두 장소 사이든(호텔 포함) 이동에 30분이 걸린다.
- 일찍 도착하면 기다릴 수 있다. 머무는 시간은 아래 최소 시간 이상이어야 한다.

| 장소 | 최소 체류 | 조건 |
|---|---|---|
| 시장 | 60분 | 09:00~12:00 사이에만 머물 수 있다 |
| 미술관 | 90분 | 10:00~17:00 사이에만 머물 수 있다 |
| 식당 | 60분 | 12:00~13:30 사이에 도착해야 한다 |
| 전망대 | 45분 | 15:00~18:00 사이에만 머물 수 있다 |
| 서점 | 30분 | 09:00~20:00 사이에만 머물 수 있다 |

"사이에만 머물 수 있다"는 도착 시각과 떠나는 시각이 모두 그 범위 안이어야 한다는 뜻이다.

답 형식(방문 순서대로): {"visits": [{"place": "시장", "arrive": "09:30", "leave": "10:30"}, ...]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ visits: [
      { place: '시장', arrive: '09:30', leave: '10:30' }, { place: '서점', arrive: '11:00', leave: '11:30' },
      { place: '식당', arrive: '12:00', leave: '13:00' }, { place: '미술관', arrive: '13:30', leave: '15:00' },
      { place: '전망대', arrive: '15:30', leave: '16:15' },
    ] }) + '\n```',
    score(answer) {
      const a = extractJson(answer); const v = a && a.visits;
      if (!Array.isArray(v)) return { score: 0, detail: '동선 JSON을 찾지 못함' };
      const fails = []; let total = 0;
      const check = (ok, msg) => { total++; if (!ok) fails.push(msg); };
      const names = v.map((x) => x.place);
      check(names.length === 5 && Object.keys(PLACES).every((p) => names.filter((n) => n === p).length === 1), '다섯 곳을 한 번씩 방문하지 않음');
      let prevLeave = 540;
      for (const x of v) {
        const p = PLACES[x.place]; const ar = hm(x.arrive), lv = hm(x.leave);
        if (!p) { check(false, `알 수 없는 장소 ${x.place}`); continue; }
        check(ar >= prevLeave + 30, `${x.place} 이동 시간 부족`);
        check(lv - ar >= p.stay, `${x.place} 체류 시간 부족`);
        check(ar >= p.open && lv <= p.close && (p.arriveBy === undefined || ar <= p.arriveBy), `${x.place} 시간 조건 위반`);
        if (Number.isFinite(lv)) prevLeave = lv;
      }
      check(prevLeave + 30 <= 1110, '18:30까지 호텔 복귀 실패');
      if (!fails.length) return { score: 100, detail: '모든 조건 충족' };
      return { score: Math.round((50 * (total - fails.length)) / total), detail: `조건 위반: ${fails.slice(0, 3).join(', ')}` };
    },
  },
  {
    id: 'planning-3', cat: 'planning', title: '예산 내 과제 선정',
    prompt: `예산 100 안에서 가치 합계가 최대가 되도록 과제를 골라라.

| 과제 | 비용 | 가치 |
|---|---|---|
| P1 | 30 | 40 |
| P2 | 20 | 25 |
| P3 | 45 | 70 |
| P4 | 25 | 30 |
| P5 | 15 | 18 |
| P6 | 40 | 55 |
| P7 | 10 | 12 |
| P8 | 35 | 50 |

조건: P3을 고르려면 P7도 골라야 한다. P6과 P8은 함께 고를 수 없다. P2를 고르려면 P1이나 P4 중 하나 이상을 골라야 한다. 비용 합계는 100을 넘을 수 없다.

답 형식: {"selected": ["P1", ...]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ selected: P3_OPT.sel }) + '\n```',
    score(answer) {
      const a = extractJson(answer); const sel = a && a.selected;
      if (!Array.isArray(sel)) return { score: 0, detail: '선정 JSON을 찾지 못함' };
      if (!projectsValid(sel)) return { score: 0, detail: '조건 또는 예산 위반' };
      const v = projectsValue(sel);
      return { score: Math.round((100 * v) / P3_OPT.v), detail: `가치 ${v} (최대 ${P3_OPT.v})` };
    },
  },
];

// ---------- repetitive accuracy (generated, rule-based ground truth) ----------
const pad = (n, w = 2) => String(n).padStart(w, '0');
function makeRecords() {
  const r = mulberry32(20261110); const rows = []; const truth = [];
  const pick = (n) => Math.floor(r() * n);
  for (let i = 1; i <= 20; i++) {
    const y = 2026, m = 1 + pick(12), d = 1 + pick(28);
    const dateRaw = [`${y}.${m}.${d}`, `${pad(y % 100)}/${pad(m)}/${pad(d)}`, `${y}년 ${m}월 ${d}일`, `${pad(m)}-${pad(d)}-${y}`][pick(4)];
    const a = 1000 + pick(9000), b = 1000 + pick(9000);
    const phoneRaw = [`010${a}${b}`, `010 ${a} ${b}`, `+82 10-${a}-${b}`, `010.${a}.${b}`][pick(4)];
    const amount = (1 + pick(980)) * 500;
    const man = amount / 10000;
    const amountRaw = [`${amount.toLocaleString('en-US')}원`, `₩${amount}`, `${man}만원`, `${amount} KRW`][pick(4)];
    rows.push(`${i} | ${dateRaw} | ${phoneRaw} | ${amountRaw}`);
    truth.push({ id: i, date: `${y}-${pad(m)}-${pad(d)}`, phone: `010-${a}-${b}`, amount });
  }
  return { rows, truth };
}
const REC = makeRecords();

const RULES = [['환불', ['환불', '결제 취소']], ['계정', ['로그인', '비밀번호']], ['배송', ['배송', '택배']], ['버그', ['오류', '에러']]];
function classify(msg) { for (const [label, kws] of RULES) if (kws.some((k) => msg.includes(k))) return label; return '기타'; }
function makeMessages() {
  const r = mulberry32(777); const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const frag = ['환불 부탁드립니다', '결제 취소가 안 돼요', '로그인이 안 됩니다', '비밀번호를 잊었어요', '배송이 늦어요', '택배가 안 왔어요', '오류가 납니다', '에러 화면이 떠요',
    '영업시간이 궁금해요', '쿠폰은 어디서 받나요', '제휴 문의드립니다', '감사 인사 전합니다', '매장 위치 알려 주세요'];
  const out = [];
  for (let i = 0; i < 24; i++) {
    const a = pick(frag), b = r() < 0.6 ? pick(frag) : '';
    out.push(b && b !== a ? `${b}. 그리고 ${a}.` : `${a}.`);
  }
  return out;
}
const MSGS = makeMessages();

function makeOps() {
  const r = mulberry32(4242); const pick = (n) => Math.floor(r() * n);
  let list = Array.from({ length: 12 }, () => 1 + pick(9));
  const start = [...list]; const lines = [];
  for (let i = 0; i < 15; i++) {
    const k = pick(7);
    if (k === 0) { const x = 1 + pick(9); list.push(x); lines.push(`맨 뒤에 ${x}을(를) 추가한다.`); }
    else if (k === 1 && list.length > 3) { const p = 1 + pick(list.length); list.splice(p - 1, 1); lines.push(`${p}번째 원소(1부터 셈)를 삭제한다.`); }
    else if (k === 2) { const x = 1 + pick(3); list = list.map((v) => v + x); lines.push(`모든 원소에 ${x}을(를) 더한다.`); }
    else if (k === 3) { list.reverse(); lines.push('순서를 뒤집는다.'); }
    else if (k === 4) { list.sort((a, b) => a - b); lines.push('오름차순으로 정렬한다.'); }
    else if (k === 5) { const x = list[pick(list.length)]; list = list.filter((v) => v !== x); lines.push(`값이 ${x}인 원소를 모두 제거한다.`); }
    else { const n = 1 + pick(3); list = [...list.slice(n), ...list.slice(0, n)]; lines.push(`앞에서 ${n}개를 떼어 순서를 유지한 채 맨 뒤로 옮긴다.`); }
  }
  return { start, lines, final: list };
}
const OPS = makeOps();

const repeat = [
  {
    id: 'repeat-1', cat: 'repeat', title: '고객 기록 20건 정리',
    prompt: `아래 기록 20건을 규칙대로 정리하라. 한 건도 빠뜨리지 말고 순서를 유지하라.

규칙
- date: YYYY-MM-DD로 바꾼다. 입력 형식은 네 가지다: "2026.3.5"(연.월.일), "26/03/05"(연/월/일, 연도는 20xx), "2026년 3월 5일", "03-05-2026"(월-일-연).
- phone: 010-XXXX-XXXX로 바꾼다. "+82 10"은 "010"과 같다.
- amount: 원 단위 정수로 바꾼다. "1.5만원"은 15000이다. 쉼표, 통화 기호, 단위는 제거한다.

기록 (id | date | phone | amount)
${REC.rows.join('\n')}

답 형식: {"records": [{"id": 1, "date": "2026-03-05", "phone": "010-1234-5678", "amount": 15000}, ...]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ records: REC.truth }) + '\n```',
    score(answer) {
      const a = extractJson(answer); const recs = Array.isArray(a) ? a : a && a.records;
      if (!Array.isArray(recs)) return { score: 0, detail: '기록 JSON을 찾지 못함' };
      const by = new Map(recs.map((x) => [Number(x.id), x]));
      const ok = REC.truth.filter((t) => { const x = by.get(t.id); return x && x.date === t.date && x.phone === t.phone && Number(x.amount) === t.amount; }).length;
      return { score: pct(ok, REC.truth.length), detail: `${ok}/${REC.truth.length}건 정확` };
    },
  },
  {
    id: 'repeat-2', cat: 'repeat', title: '문의 24건 분류',
    prompt: `고객 문의 24건을 아래 규칙으로 분류하라. 규칙은 위에서부터 차례로 적용하고, 처음 맞는 규칙의 분류를 쓴다.

1. "환불" 또는 "결제 취소"가 들어 있으면 → 환불
2. "로그인" 또는 "비밀번호"가 들어 있으면 → 계정
3. "배송" 또는 "택배"가 들어 있으면 → 배송
4. "오류" 또는 "에러"가 들어 있으면 → 버그
5. 어느 것도 아니면 → 기타

문의
${MSGS.map((m, i) => `${i + 1}. ${m}`).join('\n')}

답 형식(문의 순서대로 24개): {"labels": ["환불", "계정", ...]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ labels: MSGS.map(classify) }) + '\n```',
    score(answer) {
      const a = extractJson(answer); const labels = Array.isArray(a) ? a : a && a.labels;
      if (!Array.isArray(labels)) return { score: 0, detail: '분류 JSON을 찾지 못함' };
      const ok = MSGS.filter((m, i) => labels[i] === classify(m)).length;
      return { score: labels.length === MSGS.length ? pct(ok, MSGS.length) : Math.round(pct(ok, MSGS.length) / 2), detail: `${ok}/${MSGS.length}건 정확${labels.length === MSGS.length ? '' : ' (개수 불일치)'}` };
    },
  },
  {
    id: 'repeat-3', cat: 'repeat', title: '목록 조작 15단계',
    prompt: `아래 목록에 15개 조작을 순서대로 적용한 최종 목록을 구하라.

처음 목록: [${OPS.start.join(', ')}]

조작
${OPS.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}

답 형식: {"final": [ ... ]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ final: OPS.final }) + '\n```',
    score(answer) {
      const a = extractJson(answer); const f = Array.isArray(a) ? a : a && a.final;
      if (!Array.isArray(f)) return { score: 0, detail: '최종 목록 JSON을 찾지 못함' };
      const exact = f.length === OPS.final.length && f.every((v, i) => Number(v) === OPS.final[i]);
      if (exact) return { score: 100, detail: '최종 목록 일치' };
      const same = OPS.final.filter((v, i) => Number(f[i]) === v).length;
      return { score: f.length === OPS.final.length && same / OPS.final.length >= 0.8 ? 30 : 0, detail: `불일치 (${same}/${OPS.final.length} 자리 일치)` };
    },
  },
];

// ---------- reasoning (answers computed by code) ----------
const R1A = Array.from({ length: 1000 }, (_, i) => i + 1).filter((n) => (n % 3 === 0 || n % 5 === 0) && n % 15 !== 0).length;
const reasoning = [
  keyedTask({
    id: 'reasoning-1', cat: 'reasoning', title: '계산 네 문제',
    body: `네 문제에 숫자로 답하라.
a. 1부터 1000까지의 정수 중 3 또는 5의 배수이지만 15의 배수는 아닌 수는 몇 개인가?
b. 시계가 3시 40분일 때 시침과 분침이 이루는 작은 쪽 각은 몇 도인가?
c. 연속한 세 양의 정수의 곱이 2730이다. 가장 작은 수는?
d. 다섯 명이 원탁에 둘러앉는다(회전해서 같아지는 배치는 하나로 센다). A와 B가 이웃하지 않는 배치는 몇 가지인가?

답 형식: {"a": ..., "b": ..., "c": ..., "d": ...}`,
    checks: { a: isNum(R1A), b: isNum(130), c: isNum(13), d: isNum(12) },
    ref: { a: R1A, b: 130, c: 13, d: 12 },
  }),
  {
    id: 'reasoning-2', cat: 'reasoning', title: '논리 배치',
    prompt: `민수, 지영, 현우는 직업이 서로 다르고(의사, 교사, 요리사) 사는 도시도 서로 다르다(서울, 부산, 대구).

단서
1. 민수는 교사가 아니고 부산에 살지 않는다.
2. 부산에 사는 사람은 요리사다.
3. 지영은 대구에 산다.
4. 교사는 서울에 살지 않는다.

각 사람의 직업과 도시를 구하라.

답 형식: {"민수": {"직업": "...", "도시": "..."}, "지영": {...}, "현우": {...}}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ 민수: { 직업: '의사', 도시: '서울' }, 지영: { 직업: '교사', 도시: '대구' }, 현우: { 직업: '요리사', 도시: '부산' } }) + '\n```',
    score(answer) {
      const a = extractJson(answer); if (!a) return { score: 0, detail: 'JSON 답을 찾지 못함' };
      const key = { 민수: ['의사', '서울'], 지영: ['교사', '대구'], 현우: ['요리사', '부산'] };
      let ok = 0;
      for (const [n, [job, city]] of Object.entries(key)) { if (a[n] && a[n].직업 === job) ok++; if (a[n] && a[n].도시 === city) ok++; }
      return { score: ok === 6 ? 100 : Math.round((50 * ok) / 6), detail: `${ok}/6 항목 일치` };
    },
  },
  keyedTask({
    id: 'reasoning-3', cat: 'reasoning', title: '수리 네 문제',
    body: `네 문제에 숫자로 답하라.
a. 어떤 상품의 값을 20% 올린 뒤 25% 할인했다. 처음 값과 비교한 변화율은 몇 %인가? (내렸으면 음수)
b. A 혼자 하면 6일, B 혼자 하면 12일 걸리는 일이 있다. 둘이 함께 2일 일한 뒤 B 혼자 남은 일을 끝내려면 며칠이 더 걸리는가?
c. 다섯 명의 평균 점수가 70점이다. 한 명이 더 들어와 여섯 명의 평균이 72점이 되었다. 새로 들어온 사람의 점수는?
d. 수열 2, 6, 12, 20, 30 다음에 올 수는?

답 형식: {"a": ..., "b": ..., "c": ..., "d": ...}`,
    checks: { a: isNum(-10), b: isNum(6), c: isNum(82), d: isNum(42) },
    ref: { a: -10, b: 6, c: 82, d: 42 },
  }),
];

// ---------- product planning (deterministic format + blind judges) ----------
const PLAN_HEADS = ['목표', '타깃', '실행 계획', '예산', '리스크와 중단 조건'];
const PLAN_RUBRIC = [
  ['구체성', '수치, 일정, 담당이 구체적으로 적혀 있는가'],
  ['실행 가능성', '주어진 예산, 기간, 인력 제약 안에서 실제로 할 수 있는가'],
  ['리스크 인식', '실패 조건과 중단 기준이 측정 가능한 형태로 적혀 있는가'],
  ['논리 일관성', '목표, 실행, 예산이 서로 어긋나지 않는가'],
];
function planTask(id, title, brief) {
  const limit = 1500;
  return {
    id, cat: 'product', title,
    prompt: `${brief}

한 쪽짜리 기획서를 한국어로 써라. 아래 다섯 제목을 이 순서, 이 표기 그대로 써야 한다(각 줄은 "## "로 시작).
${PLAN_HEADS.map((h) => `## ${h}`).join('\n')}

분량은 공백 포함 ${limit}자 이내다. 기획서는 응답 본문 맨 끝에 \`\`\`text 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.`,
    ref: '```text\n' + PLAN_HEADS.map((h) => `## ${h}\n기간 안에 측정 가능한 수치 목표를 하나 정하고 주 1회 점검한다. 예산은 항목별로 나누고 합계가 한도를 넘지 않게 한다. 2주차 수치가 목표의 절반에 못 미치면 중단한다.`).join('\n') + '\n```',
    judge: { rubric: PLAN_RUBRIC, context: brief, detWeight: 0.3 },
    score(answer) {
      const t = extractText(answer);
      const idx = PLAN_HEADS.map((h) => t.search(new RegExp(`^##\\s*${h}\\s*$`, 'm')));
      const present = idx.filter((i) => i >= 0).length;
      const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
      const len = [...t].length;
      let s = 60 * (present / PLAN_HEADS.length) + (ordered ? 20 : 0) + (len > 0 && len <= limit ? 20 : 0);
      if (len < 200) s = Math.min(s, 20);
      return { score: Math.round(s), detail: `제목 ${present}/5, 순서 ${ordered ? '준수' : '위반'}, ${len}자` };
    },
  };
}
const product = [
  planTask('product-1', '유료 뉴스레터 출시', '상황: 혼자 운영하는 사람이 "스테이블코인과 결제 인프라"를 주제로 유료 뉴스레터를 4주 안에 출시하려 한다. 쓸 수 있는 예산은 50만 원이고 평일 저녁 2시간만 쓸 수 있다. 기존 독자는 무료 구독자 300명이다.'),
  planTask('product-2', '카페 평일 오후 매출', '상황: 좌석 20석인 동네 카페가 평일 오후 2~5시 매출을 6주 안에 늘리려 한다. 예산은 100만 원이고 직원은 사장 포함 2명이다. 현재 그 시간대 하루 평균 매출은 9만 원이다.'),
  planTask('product-3', '사내 AI 도구 시범 도입', '상황: 10명짜리 운영팀이 반복 보고서 작성에 AI 도구를 8주 동안 시범 도입하려 한다. 예산은 300만 원이다. 팀원 중 개발자는 없고, 고객 개인정보가 든 자료는 외부 서비스에 올릴 수 없다.'),
];

// ---------- creative (deterministic constraints + blind judges) ----------
const hangul = (s) => /^[가-힣]+$/.test(s);
const creative = [
  {
    id: 'creative-1', cat: 'creative', title: '브랜드 이름 8개',
    prompt: `24시간 무인 꽃집의 브랜드 이름 후보 8개를 지어라.
조건: 각 이름은 한글만 쓰고 2~5글자다. 서로 겹치지 않는다. 8개 중 정확히 3개에만 '온'이라는 글자가 들어간다.

답 형식: {"names": ["...", ...]}` + JSON_RULE,
    ref: '```json\n' + JSON.stringify({ names: ['온꽃', '꽃온밤', '온새미', '달꽃집', '밤꽃길', '새벽잎', '꽃마루', '잎새달'] }) + '\n```',
    judge: { rubric: [['독창성', '흔한 조합을 벗어났는가'], ['기억 용이성', '한 번 듣고 기억하기 쉬운가'], ['업종 적합성', '무인 꽃집이라는 업종과 어울리는가']], context: '24시간 무인 꽃집의 브랜드 이름 후보 8개', detWeight: 0.4 },
    score(answer) {
      const a = extractJson(answer); const names = Array.isArray(a) ? a : a && a.names;
      if (!Array.isArray(names)) return { score: 0, detail: '이름 JSON을 찾지 못함' };
      const c = [names.length === 8, names.every((n) => typeof n === 'string' && hangul(n) && [...n].length >= 2 && [...n].length <= 5),
        new Set(names).size === names.length, names.filter((n) => String(n).includes('온')).length === 3];
      return { score: pct(c.filter(Boolean).length, 4), detail: `제약 ${c.filter(Boolean).length}/4 충족` };
    },
  },
  {
    id: 'creative-2', cat: 'creative', title: '사행시',
    prompt: `"인공지능" 네 글자로 사행시를 지어라. 주제는 "월요일 아침"이다.
조건: 정확히 네 줄이다. 각 줄은 차례로 '인', '공', '지', '능'으로 시작한다. 각 줄은 공백 포함 25자 이내다.

작품은 응답 본문 맨 끝에 \`\`\`text 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.`,
    ref: '```text\n인사도 하기 전에 알람이 운다\n공기는 차고 이불은 따뜻하다\n지하철 문이 닫히며 한 주가 열린다\n능청스럽게 커피가 나를 깨운다\n```',
    judge: { rubric: [['재치', '읽는 사람이 웃거나 감탄할 지점이 있는가'], ['주제 적합성', '월요일 아침이라는 주제가 살아 있는가'], ['흐름', '네 줄이 하나의 글로 이어지는가']], context: '"인공지능" 사행시, 주제는 월요일 아침', detWeight: 0.4 },
    score(answer) {
      const lines = extractText(answer).split('\n').map((l) => l.trim()).filter(Boolean);
      const heads = ['인', '공', '지', '능'];
      const c = [lines.length === 4, heads.every((h, i) => (lines[i] || '').startsWith(h)), lines.length > 0 && lines.every((l) => [...l].length <= 25)];
      const started = heads.filter((h, i) => (lines[i] || '').startsWith(h)).length;
      if (started < 2) return { score: 0, detail: '사행시 형식이 아님' };
      return { score: pct(c.filter(Boolean).length, 3), detail: `제약 ${c.filter(Boolean).length}/3 충족` };
    },
  },
  {
    id: 'creative-3', cat: 'creative', title: '120자 초단편',
    prompt: `초단편 이야기를 한 편 써라.
조건: 공백 포함 120자 이내다. "우산", "영수증", "새벽" 세 낱말이 모두 들어간다. '비'라는 글자는 한 번도 쓰지 않는다(다른 낱말 안에 들어가는 것도 안 된다).

작품은 응답 본문 맨 끝에 \`\`\`text 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.`,
    ref: '```text\n새벽 편의점 영수증 뒷면에 그가 적었다. "우산은 두고 갈게." 맑은 날이었다. 나는 그 우산을 십 년째 펴지 못했다.\n```',
    judge: { rubric: [['여운', '끝난 뒤에 남는 것이 있는가'], ['독창성', '세 낱말을 뻔하지 않게 엮었는가'], ['문장력', '낭비 없는 문장인가']], context: '"우산", "영수증", "새벽"이 들어가는 120자 이내 초단편', detWeight: 0.4 },
    score(answer) {
      const t = extractText(answer); const len = [...t].length;
      const c = [len > 20 && len <= 120, ['우산', '영수증', '새벽'].every((w) => t.includes(w)), len > 0 && !t.includes('비')];
      if (!['우산', '영수증', '새벽'].some((w) => t.includes(w))) return { score: 0, detail: '지정 낱말이 하나도 없음' };
      return { score: pct(c.filter(Boolean).length, 3), detail: `제약 ${c.filter(Boolean).length}/3 충족, ${len}자` };
    },
  },
];

// ---------- visual (SVG structure checks) ----------
export const tags = (svg, name) => svg.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
export const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag); return m ? m[1] : undefined; };
const fillOf = (tag) => { const f = attr(tag, 'fill'); if (f) return f; const st = attr(tag, 'style') || ''; const m = /fill\s*:\s*([^;]+)/i.exec(st); return m ? m[1].trim() : undefined; };
function rgb(c) {
  if (!c) return null; c = c.trim().toLowerCase();
  const named = { red: [255, 0, 0], blue: [0, 0, 255], crimson: [220, 20, 60], royalblue: [65, 105, 225], dodgerblue: [30, 144, 255], navy: [0, 0, 128], firebrick: [178, 34, 34], tomato: [255, 99, 71] };
  if (named[c]) return named[c];
  let m = /^#([0-9a-f]{3})$/.exec(c); if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/.exec(c); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c); if (m) return [+m[1], +m[2], +m[3]];
  return null;
}
const isRed = (c) => { const v = rgb(c); return !!v && v[0] >= 170 && v[1] <= 110 && v[2] <= 110; };
const isBlue = (c) => { const v = rgb(c); return !!v && v[2] >= 120 && v[0] <= 110 && v[2] > v[1]; };
export function wellFormed(svg) {
  if (!svg) return false;
  const stack = []; const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g; let m;
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  while ((m = re.exec(body))) {
    if (m[4] === '/') continue;
    if (m[1] === '/') { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}
export const viewBoxIs = (svg, w, h) => { const vb = attr(tags(svg, 'svg')[0] || '', 'viewBox'); return !!vb && vb.trim().split(/[\s,]+/).map(Number).join(' ') === `0 0 ${w} ${h}`; };

const BARS = [['A', 10], ['B', 25], ['C', 40], ['D', 15], ['E', 30]];
const visual = [
  {
    id: 'visual-1', cat: 'visual', title: '도형 배치 그림', showSvg: true,
    prompt: `SVG 그림을 한 장 그려라.
조건: viewBox는 "0 0 400 300"이다. 빨간색으로 채운 원(<circle>) 하나와 파란색으로 채운 삼각형(<polygon>, 꼭짓점 3개) 하나가 있다. 삼각형 전체가 원의 중심보다 위쪽에 있다. "HELLO"라는 글자(<text>)가 들어 있다. 색은 fill 속성으로 지정한다.

SVG 코드는 응답 본문 맨 끝에 \`\`\`svg 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.`,
    ref: '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><circle cx="200" cy="200" r="60" fill="red"/><polygon points="200,40 160,120 240,120" fill="blue"/><text x="150" y="290">HELLO</text></svg>\n```',
    score(answer) {
      const svg = extractSvg(answer); if (!svg) return { score: 0, detail: 'SVG를 찾지 못함', svg: '' };
      const circle = tags(svg, 'circle').find((t) => isRed(fillOf(t)));
      const poly = tags(svg, 'polygon').find((t) => isBlue(fillOf(t)));
      const pts = poly ? (attr(poly, 'points') || '').trim().split(/[\s,]+/).map(Number) : [];
      const ys = pts.filter((_, i) => i % 2 === 1);
      const c = [wellFormed(svg), viewBoxIs(svg, 400, 300), !!circle, !!poly && pts.length === 6 && pts.every(Number.isFinite),
        !!circle && ys.length === 3 && Math.max(...ys) <= Number(attr(circle, 'cy')), /<text\b[^>]*>[^<]*HELLO/i.test(svg)];
      return { score: pct(c.filter(Boolean).length, c.length), detail: `구조 검사 ${c.filter(Boolean).length}/${c.length} 통과`, svg };
    },
  },
  {
    id: 'visual-2', cat: 'visual', title: '막대 차트', showSvg: true,
    prompt: `아래 데이터를 막대 차트로 그린 SVG를 만들어라.
데이터: A=10, B=25, C=40, D=15, E=30

조건: viewBox는 "0 0 500 300"이다. 막대는 class="bar"를 붙인 <rect> 다섯 개이며 A부터 E 순서로 왼쪽에서 오른쪽에 놓는다(x 값이 커지는 순서). 막대 높이(height)는 값에 정확히 비례한다. 다섯 막대의 아래쪽 끝(y + height)과 너비(width)는 서로 같다. x, y, width, height는 숫자 속성으로 직접 쓴다.

SVG 코드는 응답 본문 맨 끝에 \`\`\`svg 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.`,
    ref: '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300">' + BARS.map(([, v], i) => `<rect class="bar" x="${40 + i * 90}" y="${260 - v * 5}" width="60" height="${v * 5}" fill="#36c"/>`).join('') + '</svg>\n```',
    score(answer) {
      const svg = extractSvg(answer); if (!svg) return { score: 0, detail: 'SVG를 찾지 못함', svg: '' };
      const bars = tags(svg, 'rect').filter((t) => /\bbar\b/.test(attr(t, 'class') || ''))
        .map((t) => ({ x: +attr(t, 'x'), y: +attr(t, 'y'), w: +attr(t, 'width'), h: +attr(t, 'height') }));
      const five = bars.length === 5 && bars.every((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite));
      const ordered = five && bars.every((b, i) => i === 0 || b.x > bars[i - 1].x);
      const maxH = five ? Math.max(...bars.map((b) => b.h)) : 0;
      const prop = five && maxH > 0 && bars.every((b, i) => Math.abs(b.h / maxH - BARS[i][1] / 40) <= 0.02);
      const base = five && bars.every((b) => Math.abs(b.y + b.h - (bars[0].y + bars[0].h)) <= 1);
      const width = five && bars.every((b) => Math.abs(b.w - bars[0].w) <= 0.5);
      const c = [wellFormed(svg), viewBoxIs(svg, 500, 300), five, ordered, prop, base && width];
      return { score: pct(c.filter(Boolean).length, c.length), detail: `구조 검사 ${c.filter(Boolean).length}/${c.length} 통과`, svg };
    },
  },
];

export const BASE_TASKS = [...coding, ...debug, ...research, ...planning, ...repeat, ...reasoning, ...product, ...creative, ...visual];
