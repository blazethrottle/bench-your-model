// Advanced tier: one hard task per objective category, each with many graded sub-items
// so that scores spread out instead of piling up at 100. Ground truth is computed by code wherever possible.
import { codeTask, keyedTask, JSON_RULE, pct, tags, attr, wellFormed, viewBoxIs } from './tasks.mjs';
import { mulberry32, extractJson, extractSvg, num } from './util.mjs';

// ---------- coding: spreadsheet evaluator ----------
const SHEET_REF = `function evalSheet(cells) {
  const PRI = { '#CYCLE': 3, '#ERR': 2, '#DIV/0': 1 };
  const isErr = (v) => typeof v === 'string';
  const worst = (xs) => xs.filter(isErr).reduce((a, b) => (a === null || PRI[b] > PRI[a] ? b : a), null);
  const CELL = /^[A-Z][1-9]\\d?/;
  function tokenize(s) {
    const toks = []; let i = 0;
    while (i < s.length) {
      const rest = s.slice(i); let m;
      if (rest[0] === ' ') { i++; continue; }
      if ((m = /^\\d+(\\.\\d+)?/.exec(rest))) { toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if ((m = /^(SUM|MIN|MAX)\\(([A-Z][1-9]\\d?):([A-Z][1-9]\\d?)\\)/.exec(rest))) {
        const c1 = m[2].charCodeAt(0), c2 = m[3].charCodeAt(0), r1 = +m[2].slice(1), r2 = +m[3].slice(1);
        if (c1 > c2 || r1 > r2) return null;
        toks.push({ t: 'fn', f: m[1], c1, c2, r1, r2 }); i += m[0].length; continue;
      }
      if ((m = CELL.exec(rest))) { toks.push({ t: 'ref', v: m[0] }); i += m[0].length; continue; }
      if ('+-*/()'.includes(rest[0])) { toks.push({ t: rest[0] }); i++; continue; }
      return null;
    }
    return toks;
  }
  function parse(src) {
    const toks = tokenize(src); if (!toks) return null;
    let p = 0; let bad = false;
    const peek = () => (toks[p] ? toks[p].t : null);
    function expr() { let l = term(); while (peek() === '+' || peek() === '-') { const op = toks[p++].t; l = { t: 'bin', op, l, r: term() }; } return l; }
    function term() { let l = unary(); while (peek() === '*' || peek() === '/') { const op = toks[p++].t; l = { t: 'bin', op, l, r: unary() }; } return l; }
    function unary() { if (peek() === '-') { p++; return { t: 'neg', e: unary() }; } return primary(); }
    function primary() {
      const k = toks[p];
      if (!k) { bad = true; return null; }
      if (k.t === 'num' || k.t === 'ref' || k.t === 'fn') { p++; return k; }
      if (k.t === '(') { p++; const e = expr(); if (peek() !== ')') { bad = true; return null; } p++; return e; }
      bad = true; return null;
    }
    const ast = expr();
    return bad || p !== toks.length ? null : ast;
  }
  const memo = {}, visiting = {};
  function ev(n) {
    if (n.t === 'num') return n.v;
    if (n.t === 'ref') return get(n.v);
    if (n.t === 'neg') { const v = ev(n.e); return isErr(v) ? v : -v; }
    if (n.t === 'fn') {
      const vals = [];
      for (const key of Object.keys(cells)) {
        if (!/^[A-Z][1-9]\\d?$/.test(key)) continue;
        const c = key.charCodeAt(0), r = +key.slice(1);
        if (c >= n.c1 && c <= n.c2 && r >= n.r1 && r <= n.r2) vals.push(get(key));
      }
      const e = worst(vals); if (e) return e;
      if (n.f === 'SUM') return vals.reduce((a, b) => a + b, 0);
      if (!vals.length) return 0;
      return n.f === 'MIN' ? Math.min(...vals) : Math.max(...vals);
    }
    const l = ev(n.l), r = ev(n.r); const e = worst([l, r]); if (e) return e;
    if (n.op === '+') return l + r; if (n.op === '-') return l - r; if (n.op === '*') return l * r;
    return r === 0 ? '#DIV/0' : l / r;
  }
  function get(name) {
    if (!Object.prototype.hasOwnProperty.call(cells, name)) return 0;
    if (name in memo) return memo[name];
    if (visiting[name]) return '#CYCLE';
    visiting[name] = true;
    const raw = String(cells[name]).trim(); let v;
    if (raw[0] === '=') { const ast = parse(raw.slice(1)); v = ast ? ev(ast) : '#ERR'; }
    else v = /^-?\\d+(\\.\\d+)?$/.test(raw) ? Number(raw) : '#ERR';
    visiting[name] = false; memo[name] = v; return v;
  }
  const out = {};
  for (const k of Object.keys(cells)) out[k] = get(k);
  return out;
}`;
const C = '#CYCLE', E = '#ERR', Z = '#DIV/0';
const sheet = (cells, expect) => ({ args: [cells], expect });

const codingHard = codeTask({
  id: 'coding-4', cat: 'coding', title: '스프레드시트 계산기', fnName: 'evalSheet', level: 'hard',
  body: `JavaScript 함수 evalSheet(cells)를 작성하라. 작은 스프레드시트를 계산한다.

입력: 셀 이름을 키로, 문자열을 값으로 갖는 객체. 셀 이름은 대문자 한 글자(A~Z)와 행 번호 1~99로 이루어진다(예: "A1", "C12").
출력: 입력과 같은 키를 가진 객체. 각 값은 계산 결과 숫자이거나 오류 문자열("#CYCLE", "#ERR", "#DIV/0") 중 하나다.

셀 값의 규칙 (앞뒤 공백은 무시한다)
1. "="로 시작하지 않으면 숫자 리터럴이다. 형식은 선택적 "-" 다음에 숫자, 선택적으로 소수점과 숫자다(예: "12", "-3.5"). 이 형식이 아니면 그 셀은 "#ERR"이다.
2. "="로 시작하면 수식이다. 수식에는 다음만 쓸 수 있다.
   - 음이 아닌 숫자 리터럴(예: 3, 0.5), 셀 참조(예: A1), 괄호, 이항 연산자 + - * /, 단항 마이너스(-). 단항 마이너스는 겹쳐 쓸 수 있다(--4는 4). 단항 플러스는 없다.
   - 함수 SUM(범위), MIN(범위), MAX(범위). 범위는 "A1:B3"처럼 왼쪽 위 셀과 오른쪽 아래 셀을 콜론으로 이은 직사각형이며 양 끝을 포함한다. 함수 인자는 범위 하나만 가능하다. 함수 이름과 "(" 사이, 범위 안에는 공백이 없다.
   - 그 밖의 위치에서는 토큰 사이 공백을 허용한다.
   - 연산 우선순위는 일반 산술과 같다: 단항 마이너스 > * / > + -. 같은 우선순위는 왼쪽부터 계산한다.
3. 수식을 문법대로 해석할 수 없으면 그 셀은 "#ERR"이며, 이때는 수식 안의 참조를 따라가지 않는다. 시작 셀이 끝 셀보다 오른쪽이나 아래에 있는 범위(예: B2:A1)도 해석 불가다. 소문자 셀 이름, 행 번호가 99를 넘는 참조도 해석 불가다.

참조와 범위
4. 입력에 없는 셀을 직접 참조하면 0으로 본다.
5. 범위에서는 입력에 있는 셀만 대상으로 한다. 대상 셀이 없으면 SUM, MIN, MAX 모두 0이다.

오류
6. 0으로 나누면 "#DIV/0"이다.
7. 자기 자신을 직접 또는 간접으로 참조하는 순환이 있으면, 순환 위의 셀과 그 셀에 의존하는 모든 셀은 "#CYCLE"이다. 범위에 자기 자신이 들어가는 것도 순환이다.
8. 오류 값을 가진 셀을 참조하면(범위 포함) 그 오류가 전파된다. 한 수식에서 여러 오류가 만나면 우선순위가 높은 것 하나가 결과다: "#CYCLE" > "#ERR" > "#DIV/0". 수식의 모든 부분을 평가한 뒤 우선순위를 적용한다(한쪽이 오류여도 다른 쪽을 평가한다).`,
  cases: [
    sheet({ A1: '5', A2: '=A1*2', A3: '=A1+A2' }, { A1: 5, A2: 10, A3: 15 }),
    sheet({ A1: '=2+3*4', A2: '=(2+3)*4', A3: '=10/4', A4: '=-A1+1', A5: '=2*-3', A6: '=--4' }, { A1: 14, A2: 20, A3: 2.5, A4: -13, A5: -6, A6: 4 }),
    sheet({ A1: '=B7+1' }, { A1: 1 }),
    sheet({ A1: '1', A2: '2', B1: '3', B2: '4', C1: '=SUM(A1:B2)', C2: '=MAX(A1:B2)-MIN(A1:B2)', C3: '=SUM(D1:E5)', C4: '=MIN(D1:D3)' }, { A1: 1, A2: 2, B1: 3, B2: 4, C1: 10, C2: 3, C3: 0, C4: 0 }),
    sheet({ A1: '0', A2: '=1/A1', A3: '=A2+1', A4: '=5' }, { A1: 0, A2: Z, A3: Z, A4: 5 }),
    sheet({ A1: '=B1', B1: '=A1+1', C1: '=B1*2', D1: '7' }, { A1: C, B1: C, C1: C, D1: 7 }),
    sheet({ A1: '=SUM(A1:A3)', A2: '1' }, { A1: C, A2: 1 }),
    sheet({ A1: '=1+', A2: '=A1+1', A3: 'abc', A4: '=(2+3', A5: '=2 3', A6: '=+3', A7: '=SUM(B2:A1)', A8: '=a1', A9: '=A100' }, { A1: E, A2: E, A3: E, A4: E, A5: E, A6: E, A7: E, A8: E, A9: E }),
    sheet({ A1: '=1/0', A2: '=1+', A3: '=A1+A2', A4: '=B1', B1: '=A4', A5: '=A3+A4', A6: '=A1+A4' }, { A1: Z, A2: E, A3: E, A4: C, B1: C, A5: C, A6: C }),
    sheet({ A1: '=B1+', B1: '=A1' }, { A1: E, B1: E }),
    sheet({ A1: ' 1.5 ', A2: '= ( A1 + 0.5 ) * 4 ' }, { A1: 1.5, A2: 8 }),
    sheet({ A1: '=1/0', A2: '3', A3: '=SUM(A1:A2)', A4: '=MAX(A2:A2)' }, { A1: Z, A2: 3, A3: Z, A4: 3 }),
    sheet({ A1: '1', A2: '=A1+1', A3: '=A2+1', A4: '=A3+1', A5: '=SUM(A1:A4)' }, { A1: 1, A2: 2, A3: 3, A4: 4, A5: 10 }),
    sheet({ A1: '-8', A2: '=A1/-2', A3: '=-(A1)' }, { A1: -8, A2: 4, A3: 8 }),
    sheet({ A1: '=0/0', A2: '=8-2-1', A3: '=16/4/2' }, { A1: Z, A2: 5, A3: 2 }),
    sheet({ A10: '4', A9: '2', B1: '=SUM(A9:A10)', B2: '=MIN(A9:A10)*B1' }, { A10: 4, A9: 2, B1: 6, B2: 12 }),
    sheet({ A1: '=A2/0', A2: '=A1' }, { A1: C, A2: C }),
    sheet({ A1: '', A2: '=', A3: '=()', A4: '1.', A5: '=3-', A6: '=SUM(A1)' }, { A1: E, A2: E, A3: E, A4: E, A5: E, A6: E }),
  ],
  ref: SHEET_REF,
});

// ---------- debugging: LRU cache with five independent bugs ----------
function runOps(capacity, ops) {
  const map = new Map(); const out = [];
  for (const op of ops) {
    if (op[0] === 'set') {
      const [, k, v] = op;
      if (map.has(k)) map.delete(k);
      else if (map.size >= capacity) map.delete(map.keys().next().value);
      map.set(k, v); out.push(null);
    } else if (op[0] === 'get') {
      const k = op[1];
      if (!map.has(k)) { out.push(-1); continue; }
      const v = map.get(k); map.delete(k); map.set(k, v); out.push(v);
    } else if (op[0] === 'keys') out.push([...map.keys()].reverse());
  }
  return out;
}
const lruCases = [
  [2, [['set', 'a', 1], ['set', 'b', 2], ['get', 'a'], ['set', 'c', 3], ['get', 'b'], ['get', 'a'], ['get', 'c'], ['keys']]],
  [2, [['set', 'a', 1], ['set', 'a', 2], ['set', 'b', 3], ['get', 'a'], ['get', 'b'], ['keys']]],
  [2, [['set', 'a', 0], ['get', 'a'], ['set', 'b', ''], ['get', 'b'], ['get', 'zz']]],
  [3, [['set', 'x', 1], ['set', 'y', 2], ['set', 'z', 3], ['keys'], ['get', 'x'], ['keys'], ['set', 'w', 4], ['keys'], ['get', 'y']]],
  [1, [['set', 'a', 1], ['set', 'b', 2], ['get', 'a'], ['get', 'b'], ['set', 'b', 5], ['get', 'b'], ['keys']]],
  [2, [['set', 'a', 1], ['set', 'b', 2], ['set', 'a', 9], ['set', 'c', 3], ['get', 'a'], ['get', 'b'], ['get', 'c']]],
  [3, [['get', 'none'], ['keys'], ['set', 'k', false], ['get', 'k'], ['keys']]],
  [2, [['set', 'a', 1], ['set', 'b', 2], ['get', 'a'], ['get', 'a'], ['set', 'c', 3], ['keys'], ['get', 'b']]],
  [3, [['set', 'a', 1], ['set', 'b', 2], ['set', 'c', 3], ['set', 'b', 20], ['set', 'd', 4], ['keys'], ['get', 'a'], ['get', 'b']]],
  [2, [['set', 'a', null], ['get', 'a'], ['set', 'b', 1], ['set', 'c', 2], ['get', 'a'], ['keys']]],
];
const debugHard = codeTask({
  id: 'debug-4', cat: 'debug', title: '캐시 로직 수정', fnName: 'runOps', level: 'hard',
  body: `아래 함수는 최근 사용 순서로 항목을 버리는 캐시(LRU)에 조작 목록을 차례로 적용하고, 조작마다 결과를 배열에 담아 돌려준다. 사용자 신고: "방금 쓴 값이 가끔 사라지고, 0을 저장하면 찾지 못한다." 신고된 것 말고도 명세와 어긋나는 곳이 더 있다. 명세에 맞게 고친 함수 전체를 제시하라. 함수 이름과 인자는 그대로 둔다.

명세
- capacity는 1 이상의 정수다. 저장된 키가 capacity개일 때 새 키를 넣으면, 가장 오래전에 사용된 키 하나를 먼저 버린다.
- "사용"은 get으로 값을 찾은 것과 set으로 값을 넣거나 바꾼 것을 모두 뜻한다.
- ["set", k, v]: 값을 저장한다. 이미 있는 키면 값만 바꾸고 다른 키를 버리지 않는다. 결과는 null.
- ["get", k]: 값이 있으면 그 값을, 없으면 -1을 결과로 낸다. 저장된 값은 0, 빈 문자열, false, null일 수도 있으며 이때도 저장된 값을 그대로 낸다.
- ["keys"]: 현재 키 목록을 가장 최근에 사용한 것부터 차례로 담은 배열을 결과로 낸다. 이 조작은 사용 순서를 바꾸지 않는다.

\`\`\`js
function runOps(capacity, ops) {
  const map = new Map(); const out = [];
  for (const op of ops) {
    if (op[0] === 'set') {
      const [, k, v] = op;
      if (map.size >= capacity) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      map.set(k, v);
      out.push(null);
    } else if (op[0] === 'get') {
      const k = op[1];
      if (!map.get(k)) { out.push(-1); continue; }
      const v = map.get(k);
      out.push(v);
    } else if (op[0] === 'keys') {
      out.push([...map.keys()]);
    }
  }
  return out;
}
\`\`\``,
  cases: lruCases.map(([cap, ops]) => ({ args: [cap, ops], expect: runOps(cap, ops) })),
  ref: runOps.toString(),
});

// ---------- research: five-document contract dossier ----------
const isNum = (n) => (v) => num(v) === n;
const isDate = (y, m, d) => (v) => { const p = String(v).match(/\d+/g); return !!p && p.length >= 3 && +p[0] === y && +p[1] === m && +p[2] === d; };
const researchHard = keyedTask({
  id: 'research-4', cat: 'research', title: '계약 문서 묶음 분석', level: 'hard',
  body: `아래는 한 용역 계약에 관한 문서 다섯 건이다. 문서만 근거로 질문에 답하라. 날짜 계산에서 "N일 이내"의 기한은 기준일에 N일을 더한 날짜다.

[문서 1: 계약서 요약] 계약일 2026-03-02. 계약 총액 4억 8,000만 원(부가세 별도). 지급 조건은 착수금 30%, 중도금 40%(2차 마일스톤 승인일로부터 14일 이내 지급), 잔금 30%(최종 검수 승인일로부터 30일 이내 지급)다. 최종 납기는 2026-09-30이다. 지체상금은 지체 1일당 계약 총액의 0.1%이며 상한은 계약 총액의 10%다. 지체 일수는 최종 납기 다음 날부터 최종 산출물 제출일까지를 모두 센다.
[문서 2: 6월 진행 보고] 1차 마일스톤은 4월 17일에 승인되었다. 2차 마일스톤은 6월 12일에 제출했고 6월 19일에 승인되었다. 투입 인력은 7명이고 1인당 월 인건비는 평균 650만 원이다. 6월 말까지 누적 투입 기간은 4개월이다.
[문서 3: 변경 합의서, 7월 8일] 범위 추가에 따라 계약 총액을 5억 2,000만 원으로 올리고 최종 납기를 2026-10-20으로 늦춘다. 지급 비율과 지체상금 조건은 바꾸지 않는다. 다만 지체상금은 변경된 총액을 기준으로 계산한다. 증액분 4,000만 원은 전액 잔금에 더해 지급한다.
[문서 4: 검수 메일, 11월] 최종 산출물은 11월 4일에 제출되었고 11월 6일에 최종 검수가 승인되었다.
[문서 5: 회계 메모] 착수금 1억 4,400만 원이 3월 10일에 입금되었다. 중도금 1억 9,200만 원이 7월 1일에 입금되었다. 작성자 의견: "중도금이 지급 기한을 넘겨 들어왔다."

질문
q1. 중도금의 지급 기한은 언제인가? (YYYY-MM-DD)
q2. 문서 5의 작성자 의견은 사실인가? ("사실" 또는 "사실 아님")
q3. 변경 합의 이후 잔금은 얼마인가? (원 단위 숫자)
q4. 변경된 납기 기준으로 지체 일수는 며칠인가? (숫자)
q5. 지체상금은 얼마인가? (원 단위 숫자)
q6. 잔금의 지급 기한은 언제인가? (YYYY-MM-DD)
q7. 지체상금을 잔금에서 공제한다면 실제로 지급할 잔금은 얼마인가? (원 단위 숫자)
q8. 6월 말까지의 누적 인건비는 얼마인가? (원 단위 숫자)
q9. 6월 말 기준으로 "그때까지 입금된 금액 − 누적 인건비"는 얼마인가? (원 단위 숫자, 모자라면 음수)
q10. 납기가 연장되지 않았다고 가정하면(원래 납기 기준) 지체 일수는 며칠인가? (숫자)
q11. q10의 가정에서 원래 총액 기준 지체상금은 얼마인가? (원 단위 숫자)
q12. 이 계약의 발주처 담당자 이름은 무엇인가? 문서에 없으면 "자료에 없음"이라고 써라.

답 형식: {"q1": "2026-01-01", "q2": "...", "q3": 0, ..., "q12": "..."}`,
  checks: {
    q1: isDate(2026, 7, 3), q2: (v) => typeof v === 'string' && /아님|아니|거짓|틀/.test(v), q3: isNum(184000000), q4: isNum(15), q5: isNum(7800000),
    q6: isDate(2026, 12, 6), q7: isNum(176200000), q8: isNum(182000000), q9: isNum(-38000000), q10: isNum(35), q11: isNum(16800000),
    q12: (v) => typeof v === 'string' && /없음|없다|알 수 없/.test(v),
  },
  ref: { q1: '2026-07-03', q2: '사실 아님', q3: 184000000, q4: 15, q5: 7800000, q6: '2026-12-06', q7: 176200000, q8: 182000000, q9: -38000000, q10: 35, q11: 16800000, q12: '자료에 없음' },
});

// ---------- planning: shift assignment, optimum by exhaustive search ----------
const PEOPLE = ['가온', '나래', '다인', '라희', '마루', '바다'];
const SHIFTS = ['월오전', '월오후', '화오전', '화오후', '수오전', '수오후'];
const PREF = (() => { const r = mulberry32(90210); return PEOPLE.map(() => SHIFTS.map(() => 1 + Math.floor(r() * 9))); })();
function shiftValid(idx) { // idx[i] = shift index of person i
  if (new Set(idx).size !== 6 || idx.some((s) => !(s >= 0 && s < 6))) return false;
  if (idx[0] < 2) return false;                               // 가온: 월요일 불가
  if (Math.floor(idx[1] / 2) === Math.floor(idx[2] / 2)) return false; // 나래, 다인: 같은 요일 불가
  if (idx[3] % 2 !== 0) return false;                         // 라희: 오전만
  if (idx.indexOf(5) !== 4 && idx.indexOf(5) !== 5) return false; // 수오후: 마루 또는 바다
  if (!(idx[0] < idx[1])) return false;                       // 가온이 나래보다 앞
  return true;
}
const shiftValue = (idx) => idx.reduce((a, s, i) => a + PREF[i][s], 0);
export const SHIFT_STATS = (() => {
  let best = null, worst = null, count = 0;
  const rec = (cur, used) => {
    if (cur.length === 6) { if (shiftValid(cur)) { count++; const v = shiftValue(cur); if (!best || v > best.v) best = { v, idx: [...cur] }; if (!worst || v < worst.v) worst = { v }; } return; }
    for (let s = 0; s < 6; s++) if (!used[s]) { used[s] = true; cur.push(s); rec(cur, used); cur.pop(); used[s] = false; }
  };
  rec([], []);
  return { best, worst, count };
})();
const planningHard = {
  id: 'planning-4', cat: 'planning', title: '근무 배정 최적화', level: 'hard',
  prompt: `여섯 명을 여섯 근무 시간대에 한 명씩 배정하라. 선호 점수 합계가 최대가 되어야 한다.

선호 점수 (높을수록 선호)
| 이름 | ${SHIFTS.join(' | ')} |
|---|${SHIFTS.map(() => '---').join('|')}|
${PEOPLE.map((p, i) => `| ${p} | ${PREF[i].join(' | ')} |`).join('\n')}

조건
1. 가온은 월요일에 근무할 수 없다.
2. 나래와 다인은 같은 요일에 근무할 수 없다.
3. 라희는 오전에만 근무할 수 있다.
4. 수요일 오후는 마루나 바다만 맡을 수 있다.
5. 가온의 근무는 나래의 근무보다 시간상 앞서야 한다(순서: ${SHIFTS.join(' → ')}).
6. 모든 사람은 정확히 한 시간대를 맡고, 모든 시간대에는 정확히 한 명이 배정된다.

답 형식: {"assignment": {"가온": "화오전", "나래": "...", "다인": "...", "라희": "...", "마루": "...", "바다": "..."}}` + JSON_RULE,
  ref: '```json\n' + JSON.stringify({ assignment: Object.fromEntries(PEOPLE.map((p, i) => [p, SHIFTS[SHIFT_STATS.best.idx[i]]])) }) + '\n```',
  score(answer) {
    const a = extractJson(answer); const as = a && a.assignment;
    if (!as || typeof as !== 'object') return { score: 0, detail: '배정 JSON을 찾지 못함' };
    const idx = PEOPLE.map((p) => SHIFTS.indexOf(String(as[p] || '').replace(/\s/g, '')));
    if (!shiftValid(idx)) return { score: 0, detail: '조건 위반 또는 배정 누락' };
    const v = shiftValue(idx); const { best, worst } = SHIFT_STATS;
    const s = best.v === worst.v ? 100 : Math.round(40 + (60 * (v - worst.v)) / (best.v - worst.v));
    return { score: s, detail: `조건 준수, 선호 합계 ${v} (최대 ${best.v})` };
  },
};

// ---------- repetitive accuracy: 40 orders with conditional rules ----------
const REGIONS = ['서울', '부산', '대전', '제주', '도서', '광주'];
function orderTotal(o) {
  const amount = o.qty * o.price;
  const rate = o.qty >= 50 ? 12 : o.qty >= 10 ? 5 : 0;
  let after = amount - Math.floor((amount * rate) / 100);
  if (o.grade === 'G') after -= Math.floor((after * 3) / 100);
  else if (o.grade === 'S' && rate === 0) after -= Math.floor(after / 100);
  const remote = o.region === '제주' || o.region === '도서';
  const ship = after >= 50000 ? (remote ? 3000 : 0) : remote ? 6000 : 3000;
  return after + ship;
}
const ORDERS = (() => {
  const r = mulberry32(31337); const pick = (n) => Math.floor(r() * n); const out = [];
  const qtys = [1, 3, 9, 10, 11, 49, 50, 51, 7, 24, 60, 2];
  for (let i = 1; i <= 40; i++) out.push({ id: i, qty: r() < 0.5 ? qtys[pick(qtys.length)] : 1 + pick(70), price: (50 + pick(950)) * 10, grade: ['G', 'S', 'N'][pick(3)], region: REGIONS[pick(REGIONS.length)] });
  return out;
})();
const repeatHard = {
  id: 'repeat-4', cat: 'repeat', title: '주문 40건 정산', level: 'hard',
  prompt: `주문 40건의 결제 합계를 규칙대로 계산하라. 한 건도 빠뜨리지 말고 순서를 유지하라. 모든 금액은 원 단위 정수다.

규칙 (이 순서로 적용한다)
1. 금액 = 수량 × 단가.
2. 수량 할인: 수량이 50 이상이면 12%, 10 이상 49 이하면 5%, 9 이하면 없음. 할인액은 "금액 × 할인율"에서 원 미만을 버린 값이고, 금액에서 뺀다.
3. 등급 할인: 등급 G는 2단계까지 적용한 금액의 3%를 더 뺀다. 등급 S는 2단계의 수량 할인이 없었던 주문에 한해 1%를 더 뺀다. 등급 N은 없음. 여기서도 할인액의 원 미만은 버린다.
4. 배송비: 3단계까지 적용한 금액이 50,000원 이상이면 제주와 도서는 3,000원, 그 밖의 지역은 0원이다. 50,000원 미만이면 제주와 도서는 6,000원, 그 밖의 지역은 3,000원이다.
5. 합계 = 3단계까지 적용한 금액 + 배송비.

주문 (id | 수량 | 단가 | 등급 | 지역)
${ORDERS.map((o) => `${o.id} | ${o.qty} | ${o.price} | ${o.grade} | ${o.region}`).join('\n')}

답 형식: {"totals": [{"id": 1, "total": 12345}, ...]}` + JSON_RULE,
  ref: '```json\n' + JSON.stringify({ totals: ORDERS.map((o) => ({ id: o.id, total: orderTotal(o) })) }) + '\n```',
  score(answer) {
    const a = extractJson(answer); const rows = Array.isArray(a) ? a : a && a.totals;
    if (!Array.isArray(rows)) return { score: 0, detail: '합계 JSON을 찾지 못함' };
    const by = new Map(rows.map((x) => [Number(x.id), Number(x.total)]));
    const ok = ORDERS.filter((o) => by.get(o.id) === orderTotal(o)).length;
    return { score: pct(ok, ORDERS.length), detail: `${ok}/${ORDERS.length}건 정확` };
  },
};

// ---------- reasoning: answers computed by exhaustive search ----------
const RA = (() => { let c = 0; for (let n = 1000; n <= 9999; n++) { const d = String(n).split('').map(Number); if (d[0] < d[1] && d[1] < d[2] && d[2] < d[3] && d[0] + d[1] + d[2] + d[3] === 20) c++; } return c; })();
const RB = (() => { const f = [1, 1]; for (let n = 2; n <= 10; n++) f[n] = f[n - 1] + 2 * f[n - 2]; return f[10]; })();
const RD = (() => { for (let n = 1; ; n++) if (n % 7 === 3 && n % 11 === 5 && n % 13 === 8) return n; })();
const RE = (() => { const g = Array.from({ length: 7 }, () => Array(7).fill(0)); for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6; y++) { if ((x === 2 && y === 3) || (x === 4 && y === 4)) { g[x][y] = 0; continue; } g[x][y] = x === 0 && y === 0 ? 1 : (x ? g[x - 1][y] : 0) + (y ? g[x][y - 1] : 0); } return g[6][6]; })();
// Logic puzzle: four people, floors 1-4, pets, drinks. Solutions enumerated; must be unique.
const NAMES = ['가영', '나리', '다솜', '라온'], PETS = ['개', '고양이', '새', '물고기'], DRINKS = ['커피', '차', '주스', '우유'];
const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
export const PUZZLE = (() => {
  const sols = [];
  for (const fl of perms([1, 2, 3, 4])) for (const pe of perms(PETS)) for (const dr of perms(DRINKS)) {
    const P = (name) => NAMES.indexOf(name); const who = (arr, v) => arr.indexOf(v);
    if (fl[P('가영')] !== fl[P('나리')] + 2) continue;
    const cat = who(pe, '고양이'); if (fl[cat] === 1 || dr[cat] !== '차') continue;
    if (dr[P('다솜')] !== '주스' || pe[P('다솜')] === '새') continue;
    if (pe[fl.indexOf(4)] !== '물고기') continue;
    if (fl[who(dr, '커피')] !== fl[who(pe, '개')] - 1) continue;
    if (pe[P('라온')] === '개') continue;
    if (pe[P('나리')] === '고양이') continue;
    sols.push({ fl, pe, dr });
  }
  return sols;
})();
const PZ = PUZZLE[0] || { fl: [0, 0, 0, 0], pe: PETS, dr: DRINKS };
const frac = (target) => (v) => { const m = /(-?\d+)\s*\/\s*(\d+)/.exec(String(v)); const x = m ? +m[1] / +m[2] : num(v); return Math.abs(x - target) < 1e-9; };
const reasoningHard = keyedTask({
  id: 'reasoning-4', cat: 'reasoning', title: '계산과 논리 여덟 문제', level: 'hard',
  body: `여덟 문제에 답하라.
a. 네 자리 자연수 중에서 각 자리 숫자가 왼쪽에서 오른쪽으로 갈수록 커지고(엄격한 증가) 자리 숫자의 합이 20인 수는 몇 개인가?
b. 가로 10칸, 세로 2칸인 판을 1×2 조각(가로나 세로로 놓을 수 있음)과 2×2 조각으로 빈틈없이 겹치지 않게 덮는 방법은 몇 가지인가?
c. 주사위 세 개를 던져 눈의 합이 10이 될 확률은? (기약분수 "a/b")
d. 7로 나누면 3이 남고, 11로 나누면 5가 남고, 13으로 나누면 8이 남는 가장 작은 자연수는?
e. 격자의 (0,0)에서 (6,6)까지 오른쪽이나 위로 한 칸씩만 움직여 간다. 점 (2,3)과 점 (4,4)를 지나지 않는 경로는 몇 가지인가?

다음은 f, g, h가 함께 쓰는 논리 문제다. 가영, 나리, 다솜, 라온은 4층 건물의 서로 다른 층(1~4층)에 살고, 서로 다른 동물(개, 고양이, 새, 물고기)을 키우며, 서로 다른 음료(커피, 차, 주스, 우유)를 마신다.
- 가영은 나리보다 정확히 두 층 위에 산다.
- 고양이를 키우는 사람은 1층에 살지 않으며 차를 마신다.
- 다솜은 주스를 마시고 새를 키우지 않는다.
- 4층에 사는 사람은 물고기를 키운다.
- 커피를 마시는 사람은 개를 키우는 사람의 바로 아래층에 산다.
- 라온은 개를 키우지 않는다.
- 나리는 고양이를 키우지 않는다.
f. 새를 키우는 사람은 몇 층에 사는가? (숫자)
g. 커피를 마시는 사람의 이름은?
h. 라온이 키우는 동물은?

답 형식: {"a": 0, "b": 0, "c": "1/2", "d": 0, "e": 0, "f": 0, "g": "...", "h": "..."}`,
  checks: {
    a: isNum(RA), b: isNum(RB), c: frac(27 / 216), d: isNum(RD), e: isNum(RE),
    f: isNum(PZ.fl[PZ.pe.indexOf('새')]), g: (v) => String(v).trim() === NAMES[PZ.dr.indexOf('커피')], h: (v) => String(v).trim() === PZ.pe[NAMES.indexOf('라온')],
  },
  ref: { a: RA, b: RB, c: '1/8', d: RD, e: RE, f: PZ.fl[PZ.pe.indexOf('새')], g: NAMES[PZ.dr.indexOf('커피')], h: PZ.pe[NAMES.indexOf('라온')] },
});

// ---------- visual: analog clock with exact geometry ----------
const polar = (deg, r) => [100 + r * Math.sin((deg * Math.PI) / 180), 100 - r * Math.cos((deg * Math.PI) / 180)];
const HOUR_DEG = (4 + 35 / 60) * 30, MIN_DEG = 35 * 6;
function hand(tag) {
  const p = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(attr(tag, k)));
  if (!p.every(Number.isFinite)) return null;
  const d1 = Math.hypot(p[0] - 100, p[1] - 100), d2 = Math.hypot(p[2] - 100, p[3] - 100);
  const [tx, ty] = d1 > d2 ? [p[0], p[1]] : [p[2], p[3]];
  return { deg: ((Math.atan2(tx - 100, -(ty - 100)) * 180) / Math.PI + 360) % 360, len: Math.max(d1, d2), base: Math.min(d1, d2) };
}
const degDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const r2 = (n) => Math.round(n * 100) / 100;
const visualHard = {
  id: 'visual-3', cat: 'visual', title: '4시 35분 시계', showSvg: true, level: 'hard',
  prompt: `4시 35분을 가리키는 아날로그 시계를 SVG로 그려라.

조건
- viewBox는 "0 0 200 200"이고 시계 중심은 (100, 100)이다.
- 시침은 class="hour"인 <line>, 분침은 class="minute"인 <line>이다. 두 바늘 모두 중심 (100, 100)에서 시작한다. 시침 길이는 50, 분침 길이는 75다.
- 시침은 분의 흐름을 반영한 정확한 각도를 가리켜야 한다(4시 정각 위치가 아니다).
- 눈금은 class="tick"인 <circle> 12개이며, 1시부터 12시까지의 각 시 위치에 하나씩, 중심에서 거리 85인 곳에 중심을 둔다.
- 좌표는 x1, y1, x2, y2, cx, cy 숫자 속성으로 직접 쓰고 transform은 쓰지 않는다. 소수 둘째 자리까지 쓴다.

SVG 코드는 응답 본문 맨 끝에 \`\`\`svg 코드블록 하나로만 제시하라. 파일을 만들지 말고 응답 본문에 직접 써라.`,
  ref: (() => {
    const [hx, hy] = polar(HOUR_DEG, 50), [mx, my] = polar(MIN_DEG, 75);
    const ticks = Array.from({ length: 12 }, (_, i) => { const [x, y] = polar((i + 1) * 30, 85); return `<circle class="tick" cx="${r2(x)}" cy="${r2(y)}" r="2"/>`; }).join('');
    return '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="95" fill="none" stroke="#333"/>' + ticks +
      `<line class="hour" x1="100" y1="100" x2="${r2(hx)}" y2="${r2(hy)}" stroke="#111" stroke-width="4"/><line class="minute" x1="100" y1="100" x2="${r2(mx)}" y2="${r2(my)}" stroke="#111" stroke-width="2"/></svg>\n\`\`\``;
  })(),
  score(answer) {
    const svg = extractSvg(answer); if (!svg) return { score: 0, detail: 'SVG를 찾지 못함', svg: '' };
    if (/\btransform\s*=/.test(svg)) return { score: 10, detail: 'transform 사용 (조건 위반)', svg };
    const byClass = (name, cls) => tags(svg, name).filter((t) => new RegExp(`(^|\\s)${cls}(\\s|$)`).test(attr(t, 'class') || ''));
    const h = byClass('line', 'hour').map(hand)[0], m = byClass('line', 'minute').map(hand)[0];
    const hit = new Set();
    for (const t of byClass('circle', 'tick')) {
      const x = Number(attr(t, 'cx')), y = Number(attr(t, 'cy'));
      for (let i = 1; i <= 12; i++) { const [px, py] = polar(i * 30, 85); if (Math.hypot(x - px, y - py) <= 1.5) hit.add(i); }
    }
    const tickCount = byClass('circle', 'tick').length;
    const parts = [
      [10, wellFormed(svg) && viewBoxIs(svg, 200, 200)],
      [25, !!h && h.base <= 1 && degDiff(h.deg, HOUR_DEG) <= 2],
      [20, !!m && m.base <= 1 && degDiff(m.deg, MIN_DEG) <= 2],
      [10, !!h && !!m && Math.abs(h.len - 50) <= 1.5 && Math.abs(m.len - 75) <= 1.5],
    ];
    const tickPts = tickCount === 12 ? Math.round((35 * hit.size) / 12) : Math.round((15 * hit.size) / 12);
    const s = parts.reduce((a, [w, ok]) => a + (ok ? w : 0), 0) + tickPts;
    return { score: s, svg, detail: `시침 ${h ? r2(h.deg) + '°' : '없음'}(정답 ${HOUR_DEG}°), 분침 ${m ? r2(m.deg) + '°' : '없음'}(정답 ${MIN_DEG}°), 눈금 ${hit.size}/12` };
  },
};

export const HARD_TASKS = [codingHard, debugHard, researchHard, planningHard, repeatHard, reasoningHard, visualHard];
