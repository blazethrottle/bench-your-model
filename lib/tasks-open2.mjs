// Three more tasks without a single correct answer, one per kind of work:
//   coding-6   write a compressor for a server log        (score: smallest size seen / this size)
//   research-5 fit a demand forecast from 70,000 rows     (score: best possible error / this error)
//   repeat-5   normalize free-form order memos            (score: share of hidden memos fully correct)
// In each, the model edits one file in a work folder and the harness runs that file on hidden data in the sandbox.
import zlib from 'node:zlib';
import { runProjectOutputs } from './sandbox.mjs';
import { genLog, genSales, salesCsv, male, SALES_COLUMNS, genMemos, MEMO_FIELDS } from './gen-open.mjs';

const PKG = '{ "name": "task", "private": true, "type": "module" }\n';
export const OPEN_MINUTES = 10;
export const UNATTENDED_OPEN = `무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라.
제한 시간은 ${OPEN_MINUTES}분이다. 시간이 지나면 그때까지 작업 폴더에 남긴 파일만으로 채점하고, 응답으로 내는 답은 사라진다. 고친 파일을 일찍 저장하고, 시간을 남기고 끝내라.`;
// Quality ratio (line / value) rescaled so the starter file is 0 and matching the line is 100.
export const ratioPts = (v, base, line) => {
  const q = (x) => (x <= 0 ? 1 : Math.min(1, line / x));
  return base <= line ? 0 : Math.max(0, (100 * (q(v) - q(base))) / (1 - q(base)));
};
const lazy = (fn) => { let v; return () => (v === undefined ? (v = fn()) : v); };

// ---------- coding-6: log compression ----------
const LOG_HIDDEN = [[7301, 7000], [7302, 7000], [7303, 7000], [7304, 7000]], LOG_PUBLIC = [[311, 6000], [312, 6000]];
const CODEC_LIMIT = 10000, CODEC_GRACE = 1500;
const logs = lazy(() => LOG_HIDDEN.map(([seed, n]) => { const text = genLog(seed, n); return { seed, text, bytes: Buffer.byteLength(text) }; }));
// Provisional 100-point line: the strongest general-purpose setting of the built-in compressor.
// The report rescoring replaces it with the smallest size any measured answer reached.
const logLine = lazy(() => Object.fromEntries(logs().map((x) => [x.seed, zlib.brotliCompressSync(x.text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }).length])));
const CODEC_STARTER = `// 압축기. compress(text)는 바이트(Uint8Array)를, decompress(bytes)는 원래 문자열을 돌려준다.
// 아래는 아무것도 줄이지 않는 처음 상태다. 이 파일을 고쳐 결과를 더 작게 만들어라.
export function compress(text) {
  return new TextEncoder().encode(text);
}
export function decompress(bytes) {
  return new TextDecoder().decode(bytes);
}
`;
const CODEC_EVAL = `// 연습용: node evaluate.mjs
// logs/ 의 연습 파일마다 압축 크기, 복원 일치 여부, 걸린 시간을 출력한다.
import { readdirSync, readFileSync } from 'node:fs';
import { compress, decompress } from './codec.mjs';

for (const file of readdirSync('logs').filter((f) => f.endsWith('.log')).sort()) {
  const text = readFileSync('logs/' + file, 'utf8');
  const t0 = performance.now(); const packed = compress(text); const t1 = performance.now();
  const back = decompress(packed); const t2 = performance.now();
  const raw = Buffer.byteLength(text);
  console.log(file, '원문', raw, '바이트 → 압축', packed.length, '바이트 (' + (raw / packed.length).toFixed(2) + '배)', back === text ? '복원 일치' : '복원 불일치(0점)', '| 압축 ' + Math.round(t1 - t0) + 'ms, 복원 ' + Math.round(t2 - t1) + 'ms');
}
`;
const CODEC_GRADE = `import { compress, decompress } from './codec.mjs';
export function enc(text) { const b = compress(text); if (!(b instanceof Uint8Array)) throw new Error('not bytes'); return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64'); }
export function dec(b64) { const s = decompress(new Uint8Array(Buffer.from(b64, 'base64'))); if (typeof s !== 'string') throw new Error('not text'); return s; }
`;
const CODEC_README = `# 서버 로그 압축기

## 문제

웹 서비스의 접근 로그를 가능한 한 작게 압축하는 \`codec.mjs\`를 만든다.

- \`compress(text)\`: 로그 전체(문자열)를 받아 바이트 배열(\`Uint8Array\`)을 돌려준다.
- \`decompress(bytes)\`: 그 바이트 배열을 받아 원래 문자열을 **한 글자도 다르지 않게** 돌려준다.

\`logs/\`에 연습용 로그 두 개가 있다. 채점용 로그는 같은 서비스가 다른 날에 남긴 것이며 형식이 같다.

## 채점

- 공개하지 않은 로그 네 개(각 약 7,000줄)로 채점한다.
- 압축과 복원은 **서로 다른 프로세스**에서 실행한다. 복원 쪽은 압축 결과 바이트만 받는다. 복원한 문자열이 원문과 다르면 그 로그는 0점이다.
- 로그 하나의 압축과 복원이 각각 ${CODEC_LIMIT / 1000}초 안에 끝나야 한다. 넘기면 그 로그는 0점이다. 채점 기기의 속도가 다를 수 있으니 여유를 두어라.
- 점수는 압축 크기로 정한다. 지금까지 측정된 가장 작은 압축 크기를 내 압축 크기로 나눈 비율에 비례한다. 크기가 그 두 배면 약 50점이고, 이 폴더의 처음 상태(원문 그대로)는 0점이다. 정해진 정답은 없으며 작게 만들수록 점수가 오른다.
- Node.js 내장 압축 모듈(\`node:zlib\`)을 그대로 쓰는 것은 출발점일 뿐이다. 이 로그가 가진 규칙성을 이용할수록 더 작아진다.
- 실행 환경: Node.js 단일 스레드, 내장 모듈만 사용 가능, 외부 패키지 없음, 파일과 네트워크 접근 불가. \`codec.mjs\` 하나만 채점에 쓰인다.

## 연습

\`node evaluate.mjs\`를 실행하면 연습 로그의 압축 크기, 복원 일치 여부, 걸린 시간이 나온다.
`;
const codecFiles = { 'README.md': CODEC_README, 'codec.mjs': CODEC_STARTER, 'evaluate.mjs': CODEC_EVAL, 'package.json': PKG };
LOG_PUBLIC.forEach(([seed, n], i) => { codecFiles[`logs/practice${i + 1}.log`] = genLog(seed, n); });

export const codecTask = {
  id: 'coding-6', cat: 'coding', title: '서버 로그 압축기', long: true, openEnded: true, timeoutSec: OPEN_MINUTES * 60,
  files: codecFiles, keep: ['codec.mjs'], ref: '기준 풀이',
  prompt: `${UNATTENDED_OPEN}

현재 작업 폴더에 로그 압축 과제가 있다. README.md에 문제와 채점 방식이 적혀 있다.

할 일: codec.mjs의 compress와 decompress를 고쳐, 공개하지 않은 로그의 압축 결과가 가능한 한 작아지게 하라.

- 이 과제에는 정해진 정답이 없다. 더 작게 만들수록 점수가 오른다.
- 복원한 문자열이 원문과 한 글자라도 다르거나 제한 시간을 넘기면 그 로그는 0점이다.
- 채점에는 codec.mjs 하나만 쓰인다. 다른 파일에 의존하지 마라.
- 작업은 이 폴더 안에서만 하라. 끝나면 어떤 방법을 썼는지 세 줄 이내로 요약해 응답하라.`,
  async score(_answer, work) {
    const src = work && work['codec.mjs'];
    if (!src) return { score: 0, detail: 'codec.mjs 를 찾지 못함' };
    const set = logs(), line = logLine();
    const f = { 'codec.mjs': src, '__grade.mjs': CODEC_GRADE, 'package.json': PKG };
    const budget = set.length * (CODEC_LIMIT + CODEC_GRACE) + 15000;
    const A = await runProjectOutputs(f, '__grade.mjs', set.map((x) => ({ fn: 'enc', args: [x.text] })), budget);
    const packed = A.outputs.map((o, i) => (typeof o === 'string' && A.ms[i] !== null && A.ms[i] <= CODEC_LIMIT + CODEC_GRACE ? o : null));
    const B = await runProjectOutputs(f, '__grade.mjs', set.map((_, i) => ({ fn: 'dec', args: [packed[i] ?? ''] })), budget);
    const parts = [], raw = {}; let total = 0;
    set.forEach((x, i) => {
      if (packed[i] === null) { parts.push(A.outputs[i] === undefined ? '압축 실패' : '압축 시간 초과'); return; }
      if (B.outputs[i] !== x.text) { parts.push('복원 불일치'); return; }
      if (B.ms[i] === null || B.ms[i] > CODEC_LIMIT + CODEC_GRACE) { parts.push('복원 시간 초과'); return; }
      const size = Buffer.from(packed[i], 'base64').length;
      raw[x.seed] = size;
      const pts = ratioPts(size, x.bytes, Math.min(line[x.seed], size));
      total += pts; parts.push(String(Math.round(pts)));
    });
    return { score: Math.round(total / set.length), detail: `로그별 점수 ${parts.join(' ')} · 압축 크기 ${set.map((x) => raw[x.seed] ?? '-').join(' ')} (원문 ${set.map((x) => x.bytes).join(' ')})`, raw };
  },
};

// ---------- research-5: demand forecast ----------
const PREDICT_LIMIT = 5000, PREDICT_GRACE = 1000;
const sales = lazy(() => {
  const g = genSales();
  const test = [...g.held.map((x) => ({ ...x, part: 'held' })), ...g.future.map((x) => ({ ...x, part: 'future' }))];
  const actual = test.map((x) => x.units);
  const oracle = male(test.map((x) => x.mu), actual), base = male(test.map(() => 20), actual);
  return { train: g.train, test, actual, oracle, base };
});
const MODEL_STARTER = `// 수요 예측 모델. predict(rows)는 행마다 예상 판매 수량(units)을 숫자로 돌려준다.
// 아래는 모든 행에 같은 값을 내는 처음 상태다. 이 파일을 고쳐 예측을 더 정확하게 만들어라.
export function predict(rows) {
  return rows.map(() => 20);
}
`;
const MODEL_EVAL = `// 연습용: node evaluate.mjs
// train.csv 의 마지막 6주(2026-05-20 이후)를 검증용으로 삼아 예측 오차를 출력한다.
// 이 기간을 학습에 썼다면 여기서 나오는 오차는 실제보다 좋게 나온다.
import { readFileSync } from 'node:fs';
import { predict } from './model.mjs';

const [head, ...lines] = readFileSync('train.csv', 'utf8').trim().split('\\n');
const cols = head.split(',');
const NUM = new Set(['price', 'promo_pct', 'holiday', 'temp_c', 'rain_mm', 'units']);
const rows = lines.map((l) => { const v = l.split(','); const o = {}; cols.forEach((c, i) => { o[c] = NUM.has(c) ? Number(v[i]) : v[i]; }); return o; });
const valid = rows.filter((r) => r.date >= '2026-05-20');
const t0 = performance.now();
const pred = predict(valid.map(({ units, ...rest }) => rest));
const ms = Math.round(performance.now() - t0);
let s = 0; valid.forEach((r, i) => { s += Math.abs(Math.log1p(pred[i]) - Math.log1p(r.units)); });
console.log('검증 행', valid.length, '| 평균 절대 로그 오차', (s / valid.length).toFixed(4), '| ' + ms + 'ms');
`;
const MODEL_README = `# 편의점 수요 예측

## 문제

편의점 8곳의 상품별 일일 판매 기록(\`train.csv\`, 약 7만 행, 2025-01-01 ~ 2026-06-30)이 있다. 이 기록을 분석해, 주어진 조건에서 판매 수량을 예측하는 \`model.mjs\`를 만든다.

열: \`date\`(날짜), \`store\`(매장), \`store_type\`(매장 유형), \`item\`(상품), \`category\`(분류), \`price\`(그날 판매가), \`promo_pct\`(할인율 %), \`holiday\`(공휴일 1/0), \`temp_c\`(기온), \`rain_mm\`(강수량), \`units\`(판매 수량).

- 학습 기록에는 잘못 입력된 값이 일부 섞여 있다. 채점용 기록에는 없다.
- 일부 날짜의 행은 빠져 있다.

## 입출력

\`model.mjs\`의 \`predict(rows)\`를 고친다.

- 입력 \`rows\`: \`units\`를 뺀 나머지 열을 가진 객체의 배열. 숫자 열은 숫자형이다.
- 반환: 같은 길이의 숫자 배열. 각 행의 예상 판매 수량이며 0 이상의 유한한 수여야 한다.

## 채점

- 공개하지 않은 행으로 채점한다. 절반가량은 학습 기간 안에서 빠져 있는 행이고, 나머지는 **그 뒤 6주(2026-07-01 ~ 2026-08-11)** 의 행이다. 기온, 강수량, 가격, 할인율은 채점 행에도 주어진다.
- 오차는 평균 절대 로그 오차다: \`|ln(1+예측) − ln(1+실제)|\`의 평균.
- 점수는 이 데이터에서 이론상 가능한 가장 작은 오차를 내 오차로 나눈 비율에 비례한다. 오차가 그 두 배면 약 50점이고, 이 폴더의 처음 상태(모든 행에 같은 값)는 0점이다. 판매량에는 예측할 수 없는 변동이 섞여 있어 오차를 0으로 만들 수는 없다.
- \`predict\` 호출 한 번(약 1만 4천 행)이 ${PREDICT_LIMIT / 1000}초 안에 끝나야 한다. 넘기거나 반환값이 잘못되면 0점이다.
- 실행 환경: Node.js 단일 스레드, 외부 패키지 없음, **파일과 네트워크 접근 불가**. \`model.mjs\` 하나만 채점에 쓰이므로, 학습으로 얻은 값은 이 파일 안에 적어 넣어야 한다. 파일 크기는 300KB 이하로 하라.

## 연습

\`node evaluate.mjs\`를 실행하면 학습 기록의 마지막 6주에 대한 오차가 나온다.
`;
const modelFiles = lazy(() => ({ 'README.md': MODEL_README, 'model.mjs': MODEL_STARTER, 'evaluate.mjs': MODEL_EVAL, 'package.json': PKG, 'train.csv': salesCsv(sales().train) }));

export const forecastTask = {
  id: 'research-5', cat: 'research', title: '판매 기록 분석과 수요 예측', long: true, openEnded: true, timeoutSec: OPEN_MINUTES * 60,
  get files() { return modelFiles(); }, keep: ['model.mjs'], ref: '기준 풀이',
  prompt: `${UNATTENDED_OPEN}

현재 작업 폴더에 수요 예측 과제가 있다. README.md에 문제, 입출력, 채점 방식이 적혀 있다.

할 일: train.csv를 분석해 판매 수량에 영향을 주는 요인을 찾고, model.mjs의 predict(rows)를 고쳐 공개하지 않은 행의 예측 오차가 가능한 한 작아지게 하라.

- 이 과제에는 정해진 정답이 없다. 오차가 작을수록 점수가 오른다.
- 채점 행의 절반은 학습 기간 뒤 6주의 행이다. 학습 기간에만 잘 맞는 모델은 점수가 낮다.
- 채점에는 model.mjs 하나만 쓰이고 채점 환경에서는 파일을 읽을 수 없다. 학습으로 얻은 값은 model.mjs 안에 적어 넣어라.
- 작업은 이 폴더 안에서만 하라. 끝나면 어떤 요인을 반영했는지 세 줄 이내로 요약해 응답하라.`,
  async score(_answer, work) {
    const src = work && work['model.mjs'];
    if (!src) return { score: 0, detail: 'model.mjs 를 찾지 못함' };
    const S = sales();
    const res = await runProjectOutputs({ 'model.mjs': src, 'package.json': PKG }, 'model.mjs', [{ fn: 'predict', args: [S.test.map((x) => x.row)] }], PREDICT_LIMIT + PREDICT_GRACE + 15000);
    const out = res.outputs[0];
    if (!Array.isArray(out) || out.length !== S.test.length || out.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return { score: 0, detail: `예측 실패: ${res.fatal || (res.hung ? '실행이 끝나지 않음' : '반환값이 잘못됨')}` };
    if (res.ms[0] === null || res.ms[0] > PREDICT_LIMIT + PREDICT_GRACE) return { score: 0, detail: `시간 초과 (${Math.round(res.ms[0])}ms)` };
    const err = male(out, S.actual);
    const part = (p) => { const idx = S.test.map((x, i) => (x.part === p ? i : -1)).filter((i) => i >= 0); return male(idx.map((i) => out[i]), idx.map((i) => S.actual[i])); };
    const raw = { err, held: part('held'), future: part('future') };
    const f4 = (v) => v.toFixed(4);
    return { score: Math.round(ratioPts(err, S.base, S.oracle)), detail: `오차 ${f4(err)} (학습 기간 내 ${f4(raw.held)}, 이후 6주 ${f4(raw.future)}) · 이론상 최소 ${f4(S.oracle)}, 처음 상태 ${f4(S.base)}`, raw };
  },
};

// ---------- repeat-5: order memo normalization ----------
const MEMO_HIDDEN = [8801, 1200], MEMO_PUBLIC = [421, 300];
const memos = lazy(() => genMemos(...MEMO_HIDDEN));
const PARSER_STARTER = `// 주문 메모 정규화. parse(text)는 메모 한 건을 받아 정해진 형식의 객체를 돌려준다.
// 아래는 아무것도 읽지 못하는 처음 상태다. 이 파일을 고쳐라.
export function parse(text) {
  return { date: null, phone: null, item: null, qty: null, amount: null, pay: null, rush: false };
}
`;
const PARSER_EVAL = `// 연습용: node evaluate.mjs
// examples.jsonl 의 예시마다 parse()를 실행해 일치율과 틀린 예시 일부를 출력한다.
import { readFileSync } from 'node:fs';
import { parse } from './parser.mjs';

const rows = readFileSync('examples.jsonl', 'utf8').trim().split('\\n').map((l) => JSON.parse(l));
const FIELDS = ${JSON.stringify(MEMO_FIELDS)};
let ok = 0; const wrong = [];
for (const r of rows) {
  let got; try { got = parse(r.text); } catch (e) { got = { error: String(e.message) }; }
  const bad = FIELDS.filter((f) => !got || got[f] !== r.expected[f]);
  if (bad.length) wrong.push({ text: r.text, bad, got, expected: r.expected }); else ok++;
}
console.log('일치', ok, '/', rows.length);
for (const w of wrong.slice(0, Number(process.argv[2] || 5))) console.log(JSON.stringify(w));
`;
const PARSER_README = `# 주문 메모 정규화

## 문제

영업 담당자들이 제각각의 방식으로 적은 주문 메모를 정해진 형식으로 바꾸는 \`parser.mjs\`를 만든다. \`examples.jsonl\`에 메모와 정답 쌍이 ${MEMO_PUBLIC[1]}건 있다(한 줄에 \`{ "text", "expected" }\` 하나).

\`parse(text)\`는 메모 한 건을 받아 아래 객체를 돌려준다.

| 항목 | 형식 | 뜻 |
|---|---|---|
| \`date\` | \`"YYYY-MM-DD"\` | 주문일. 연도가 없으면 2026년이다. |
| \`phone\` | \`"010-0000-0000"\` | 주문 고객의 휴대전화 번호. |
| \`item\` | \`"A-1024"\` | 품번. 영문 대문자 한 글자, 붙임표, 숫자 네 자리. |
| \`qty\` | 정수 | 주문 수량(낱개 기준). |
| \`amount\` | 정수 | 고객이 실제로 낼 총액(원). |
| \`pay\` | \`"card"\`, \`"cash"\`, \`"transfer"\` | 결제 수단(카드, 현금, 계좌 이체). |
| \`rush\` | \`true\`, \`false\` | 급한 주문인지 여부. |

## 규칙

- 메모에는 주문일이 아닌 날짜(배송일, 납기, 희망일 등)가 함께 있을 수 있다. 그런 날짜에는 그 뜻을 나타내는 말이 바로 앞에 붙는다. \`date\`에는 주문일만 쓴다.
- 메모에는 고객이 아닌 사람이나 매장의 전화번호(기사, 담당자, 매장 등)가 함께 있을 수 있다. 그런 번호에는 그 뜻을 나타내는 말이 바로 앞에 붙는다.
- 수량 단위: 1박스는 12개, 1묶음은 6개다. 사은품이나 샘플의 수량은 주문 수량이 아니다.
- 금액: 단가와 수량만 적힌 메모는 총액이 단가 × 수량이다. 할인이나 쿠폰이 적혀 있으면 그만큼 뺀 금액이다. 부가세(VAT)가 별도라고 적혀 있으면 10%를 더한 금액이고, 포함이라고 적혀 있으면 그대로다.
- 급한 주문: 급함, 긴급, 당일, 퀵 같은 표시가 있으면 \`true\`다. 급하지 않다고 적힌 경우는 \`false\`다.
- 날짜, 전화번호, 품번, 수량, 금액, 결제 수단을 적는 방식은 담당자마다 다르다. 어떤 방식이 쓰이는지는 예시에서 확인하라.

## 채점

- 공개하지 않은 메모 ${MEMO_HIDDEN[1]}건으로 채점한다. 예시와 같은 사람들이 쓴 메모이므로 적는 방식의 종류는 같지만, 예시에서 드물게 나온 방식도 채점 메모에는 여러 번 나온다.
- 일곱 항목이 모두 정답과 같아야 그 메모가 정답이다. 점수는 정답인 메모의 비율이다.
- 전체 메모의 처리가 5초 안에 끝나야 한다.
- 실행 환경: Node.js 단일 스레드, 외부 패키지 없음, 파일과 네트워크 접근 불가. \`parser.mjs\` 하나만 채점에 쓰인다.

## 연습

\`node evaluate.mjs\`를 실행하면 예시의 일치율과 틀린 예시 다섯 건이 나온다. \`node evaluate.mjs 30\`처럼 숫자를 주면 그만큼 보여 준다.
`;
const PARSER_GRADE = `import { parse } from './parser.mjs';
export function run(texts) { return texts.map((t) => { try { const o = parse(t); return o && typeof o === 'object' ? o : null; } catch { return null; } }); }
`;
const parserFiles = lazy(() => ({ 'README.md': PARSER_README, 'parser.mjs': PARSER_STARTER, 'evaluate.mjs': PARSER_EVAL, 'package.json': PKG, 'examples.jsonl': genMemos(...MEMO_PUBLIC).map((x) => JSON.stringify(x)).join('\n') + '\n' }));

export const memoTask = {
  id: 'repeat-5', cat: 'repeat', title: '주문 메모 정규화 프로그램', long: true, openEnded: true, timeoutSec: OPEN_MINUTES * 60,
  get files() { return parserFiles(); }, keep: ['parser.mjs'], ref: '기준 풀이',
  prompt: `${UNATTENDED_OPEN}

현재 작업 폴더에 주문 메모 정규화 과제가 있다. README.md에 출력 형식, 규칙, 채점 방식이 적혀 있다.

할 일: examples.jsonl의 예시를 살펴 메모를 적는 방식들을 파악하고, parser.mjs의 parse(text)를 고쳐 공개하지 않은 메모를 가능한 한 많이 정확하게 바꾸게 하라.

- 채점 메모는 예시와 다른 메모다. 예시의 문장을 외워서 답하는 방식은 통하지 않는다.
- 일곱 항목이 모두 맞아야 그 메모가 정답이다.
- 채점에는 parser.mjs 하나만 쓰인다. 다른 파일에 의존하지 마라.
- 작업은 이 폴더 안에서만 하라. 끝나면 예시 일치율과 남은 문제를 세 줄 이내로 요약해 응답하라.`,
  async score(_answer, work) {
    const src = work && work['parser.mjs'];
    if (!src) return { score: 0, detail: 'parser.mjs 를 찾지 못함' };
    const set = memos();
    const res = await runProjectOutputs({ 'parser.mjs': src, '__grade.mjs': PARSER_GRADE, 'package.json': PKG }, '__grade.mjs', [{ fn: 'run', args: [set.map((x) => x.text)] }], 5000 + 1000 + 15000);
    const out = res.outputs[0];
    if (!Array.isArray(out) || out.length !== set.length) return { score: 0, detail: `실행 실패: ${res.fatal || (res.hung ? '실행이 끝나지 않음' : '반환값이 잘못됨')}` };
    if (res.ms[0] === null || res.ms[0] > 6000) return { score: 0, detail: `시간 초과 (${Math.round(res.ms[0])}ms)` };
    let ok = 0; const miss = Object.fromEntries(MEMO_FIELDS.map((f) => [f, 0]));
    set.forEach((x, i) => { const g = out[i] || {}; let all = true; for (const f of MEMO_FIELDS) if (g[f] !== x.expected[f]) { miss[f]++; all = false; } if (all) ok++; });
    const pct = (100 * ok) / set.length;
    return { score: Math.round(pct), detail: `정답 ${ok}/${set.length}건 (${pct.toFixed(1)}%) · 항목별 오답 ${MEMO_FIELDS.map((f) => `${f} ${miss[f]}`).join(', ')}`, raw: { ok, total: set.length, miss } };
  },
};

export const OPEN2_TASKS = [codecTask, forecastTask, memoTask];
export const OPEN2_INFO = { logs, logLine, sales, memos, SALES_COLUMNS };
