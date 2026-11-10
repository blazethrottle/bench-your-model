// Demanding tier. These tasks are built so a model cannot simply check its own answer:
// hidden inputs are larger than anything shown, and efficiency only shows at full size.
// All expected values come from reference solutions here, cross-checked against brute force in the self-check.
import { runTests } from './sandbox.mjs';
import { mulberry32, extractCode } from './util.mjs';

// ---------- coding-5: eight algorithm problems, hidden large inputs ----------
export const REF = {
  countPairs(a, K, D) {
    const cnt = new Int32Array(K); let res = 0;
    const mod = (v) => ((v % K) + K) % K;
    for (let j = 0; j < a.length; j++) {
      if (j - D - 1 >= 0) cnt[mod(a[j - D - 1])]--;
      const r = mod(a[j]);
      res += cnt[(K - r) % K];
      cnt[r]++;
    }
    return res;
  },
  medianSubarrays(a, x) {
    const n = a.length, bit = new Int32Array(2 * n + 3); let res = 0, p = n + 1;
    const add = (i) => { for (; i < bit.length; i += i & -i) bit[i]++; };
    const sum = (i) => { let s = 0; for (; i > 0; i -= i & -i) s += bit[i]; return s; };
    add(p);
    for (let j = 0; j < n; j++) { p += a[j] >= x ? 1 : -1; res += sum(p - 1); add(p); }
    return res;
  },
  kthPairDistance(a, k) {
    const s = Float64Array.from(a).sort(); const n = s.length;
    const count = (d) => { let c = 0, i = 0; for (let j = 0; j < n; j++) { while (s[j] - s[i] > d) i++; c += j - i; } return c; };
    let lo = 0, hi = s[n - 1] - s[0];
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (count(mid) >= k) hi = mid; else lo = mid + 1; }
    return lo;
  },
  bestSchedule(jobs, G) {
    const js = [...jobs].sort((p, q) => p[1] - q[1]); const n = js.length; const ends = js.map((j) => j[1]); const dp = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const lim = js[i][0] - G; let lo = 0, hi = i; // number of earlier jobs with end <= lim
      while (lo < hi) { const m = (lo + hi) >> 1; if (ends[m] <= lim) lo = m + 1; else hi = m; }
      dp[i + 1] = Math.max(dp[i], js[i][2] + dp[lo]);
    }
    return dp[n];
  },
  distinctInRanges(a, queries) {
    const n = a.length, bit = new Int32Array(n + 1), out = new Array(queries.length), last = new Map();
    const add = (i, v) => { for (i++; i <= n; i += i & -i) bit[i] += v; };
    const sum = (i) => { let s = 0; for (i++; i > 0; i -= i & -i) s += bit[i]; return s; };
    const order = queries.map((_, i) => i).sort((p, q) => queries[p][1] - queries[q][1]); let r = -1;
    for (const qi of order) {
      const [l, rr] = queries[qi];
      while (r < rr) { r++; const pv = last.get(a[r]); if (pv !== undefined) add(pv, -1); add(r, 1); last.set(a[r], r); }
      out[qi] = sum(rr) - (l > 0 ? sum(l - 1) : 0);
    }
    return out;
  },
  shortestWithTeleports(grid) {
    const H = grid.length, W = grid[0].length, dist = new Int32Array(H * W).fill(-1), groups = {}; let s = -1, t = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = grid[y][x], id = y * W + x;
      if (c === 'S') s = id; else if (c === 'T') t = id; else if (c >= 'a' && c <= 'z') (groups[c] ||= []).push(id);
    }
    const q = new Int32Array(H * W); let head = 0, tail = 0; q[tail++] = s; dist[s] = 0;
    while (head < tail) {
      const id = q[head++], d = dist[id]; if (id === t) return d;
      const y = (id / W) | 0, x = id % W, c = grid[y][x];
      if (groups[c]) { for (const o of groups[c]) if (dist[o] < 0) { dist[o] = d + 1; q[tail++] = o; } groups[c] = null; }
      if (y > 0 && grid[y - 1][x] !== '#' && dist[id - W] < 0) { dist[id - W] = d + 1; q[tail++] = id - W; }
      if (y < H - 1 && grid[y + 1][x] !== '#' && dist[id + W] < 0) { dist[id + W] = d + 1; q[tail++] = id + W; }
      if (x > 0 && grid[y][x - 1] !== '#' && dist[id - 1] < 0) { dist[id - 1] = d + 1; q[tail++] = id - 1; }
      if (x < W - 1 && grid[y][x + 1] !== '#' && dist[id + 1] < 0) { dist[id + 1] = d + 1; q[tail++] = id + 1; }
    }
    return -1;
  },
  lisCount(a) {
    const M = 1000000007, vals = [...new Set(a)].sort((p, q) => p - q), rank = new Map(vals.map((v, i) => [v, i + 1])), m = vals.length;
    const bl = new Int32Array(m + 1), bc = new Float64Array(m + 1);
    let bestL = 0, bestC = 0;
    for (const v of a) {
      const r = rank.get(v); let L = 0, C = 1;
      for (let i = r - 1; i > 0; i -= i & -i) { if (bl[i] > L) { L = bl[i]; C = bc[i]; } else if (bl[i] === L && L > 0) C = (C + bc[i]) % M; }
      L += 1;
      for (let i = r; i <= m; i += i & -i) { if (bl[i] < L) { bl[i] = L; bc[i] = C; } else if (bl[i] === L) bc[i] = (bc[i] + C) % M; }
      if (L > bestL) { bestL = L; bestC = C; } else if (L === bestL) bestC = (bestC + C) % M;
    }
    return [bestL, bestC];
  },
  maxXorSubarray(a) {
    const n = a.length, ch = new Int32Array((n + 2) * 31 * 2); let nodes = 1, best = 0, p = 0;
    const insert = (v) => { let u = 0; for (let b = 29; b >= 0; b--) { const k = (v >> b) & 1; if (!ch[u * 2 + k]) ch[u * 2 + k] = nodes++; u = ch[u * 2 + k]; } };
    const query = (v) => { let u = 0, r = 0; for (let b = 29; b >= 0; b--) { const k = (v >> b) & 1; if (ch[u * 2 + (k ^ 1)]) { r |= 1 << b; u = ch[u * 2 + (k ^ 1)]; } else u = ch[u * 2 + k]; } return r; };
    insert(0);
    for (const v of a) { p ^= v; const r = query(p); if (r > best) best = r; insert(p); }
    return best;
  },
};

// Brute-force definitions used for the small hidden cases and to cross-check the references.
export const BRUTE = {
  countPairs(a, K, D) { let c = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length && j - i <= D; j++) if ((((a[i] + a[j]) % K) + K) % K === 0) c++; return c; },
  medianSubarrays(a, x) { let c = 0; for (let i = 0; i < a.length; i++) for (let j = i; j < a.length; j++) { const s = a.slice(i, j + 1).sort((p, q) => p - q); if (s[Math.ceil(s.length / 2) - 1] >= x) c++; } return c; },
  kthPairDistance(a, k) { const d = []; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) d.push(Math.abs(a[i] - a[j])); return d.sort((p, q) => p - q)[k - 1]; },
  bestSchedule(jobs, G) {
    let best = 0; const n = jobs.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const sel = jobs.filter((_, i) => mask & (1 << i)).sort((p, q) => p[0] - q[0]);
      if (sel.every((j, i) => i === 0 || j[0] >= sel[i - 1][1] + G)) best = Math.max(best, sel.reduce((s, j) => s + j[2], 0));
    }
    return best;
  },
  distinctInRanges(a, queries) { return queries.map(([l, r]) => new Set(a.slice(l, r + 1)).size); },
  shortestWithTeleports(grid) {
    const H = grid.length, W = grid[0].length, dist = new Map(); let start, target;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (grid[y][x] === 'S') start = [y, x]; if (grid[y][x] === 'T') target = [y, x]; }
    const q = [start]; dist.set(start.join(), 0);
    while (q.length) {
      const [y, x] = q.shift(), d = dist.get([y, x].join()); if (y === target[0] && x === target[1]) return d;
      const nb = [[y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]].filter(([p, r]) => p >= 0 && r >= 0 && p < H && r < W && grid[p][r] !== '#');
      const c = grid[y][x];
      if (c >= 'a' && c <= 'z') for (let p = 0; p < H; p++) for (let r = 0; r < W; r++) if (grid[p][r] === c && (p !== y || r !== x)) nb.push([p, r]);
      for (const n of nb) if (!dist.has(n.join())) { dist.set(n.join(), d + 1); q.push(n); }
    }
    return -1;
  },
  lisCount(a) {
    const n = a.length, L = new Array(n).fill(1), C = new Array(n).fill(1);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (a[j] < a[i]) { if (L[j] + 1 > L[i]) { L[i] = L[j] + 1; C[i] = C[j]; } else if (L[j] + 1 === L[i]) C[i] = (C[i] + C[j]) % 1000000007; }
    const best = Math.max(...L); return [best, L.reduce((s, l, i) => (l === best ? (s + C[i]) % 1000000007 : s), 0)];
  },
  maxXorSubarray(a) { let best = 0; for (let i = 0; i < a.length; i++) { let x = 0; for (let j = i; j < a.length; j++) { x ^= a[j]; if (x > best) best = x; } } return best; },
};

const NAMES = Object.keys(REF);
const LARGE_MS = 2500;

function gridOf(r, H, W, wallP, letters, letterP) {
  const rows = [];
  for (let y = 0; y < H; y++) { let s = ''; for (let x = 0; x < W; x++) { const u = r(); s += u < wallP ? '#' : u < wallP + letterP ? letters[Math.floor(r() * letters.length)] : '.'; } rows.push(s); }
  const put = (y, x, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
  put(0, 0, 'S'); put(H - 1, W - 1, 'T');
  return rows;
}

// Small cases: random inputs, expected values from brute force. Large cases: full-size inputs, expected from the reference.
export function buildCases() {
  const r = mulberry32(8675309); const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const arr = (n, lo, hi) => Array.from({ length: n }, () => int(lo, hi));
  const small = {
    countPairs: () => [arr(int(1, 14), -30, 30), int(1, 7), int(1, 6)],
    medianSubarrays: () => [arr(int(1, 10), 1, 9), int(1, 9)],
    kthPairDistance: () => { const a = arr(int(2, 10), -50, 50); return [a, int(1, (a.length * (a.length - 1)) / 2)]; },
    bestSchedule: () => [Array.from({ length: int(1, 9) }, () => { const s = int(0, 30); return [s, s + int(1, 10), int(1, 50)]; }), int(0, 4)],
    distinctInRanges: () => { const a = arr(int(1, 12), 1, 5); return [a, Array.from({ length: int(1, 6) }, () => { const l = int(0, a.length - 1); return [l, int(l, a.length - 1)]; })]; },
    shortestWithTeleports: () => [gridOf(r, int(2, 6), int(2, 6), 0.25, 'abc', 0.2)],
    lisCount: () => [arr(int(1, 12), 1, 8)],
    maxXorSubarray: () => [arr(int(1, 10), 0, 1023)],
  };
  const large = {
    countPairs: () => [[arr(200000, -1000000000, 1000000000), 1000, 100000], [arr(200000, 0, 5), 3, 199999]],
    medianSubarrays: () => [[arr(200000, 1, 1000), 500], [arr(200000, 1, 3), 2]],
    kthPairDistance: () => [[arr(100000, -1000000000, 1000000000), 2500000000], [arr(100000, 0, 1000), 4000000000]],
    bestSchedule: () => [[Array.from({ length: 100000 }, () => { const s = int(0, 1000000000); return [s, s + int(1, 5000), int(1, 1000000)]; }), 1000], [Array.from({ length: 100000 }, () => { const s = int(0, 200000); return [s, s + int(1, 100000), int(1, 1000000)]; }), 0]],
    distinctInRanges: () => [[arr(100000, 1, 100000), Array.from({ length: 100000 }, () => { const l = int(0, 30000); return [l, int(60000, 99999)]; })], [arr(100000, 1, 50), Array.from({ length: 100000 }, () => { const l = int(0, 99999); return [l, int(l, 99999)]; })]],
    shortestWithTeleports: () => [[gridOf(r, 600, 600, 0.3, 'a', 0.45)], [gridOf(r, 600, 600, 0.38, 'abcdefghijklmnopqrstuvwxyz', 0.3)]],
    lisCount: () => [[arr(100000, 1, 1000000000)], [Array.from({ length: 100000 }, (_, i) => Math.floor(i / 2) * 2 + int(0, 3))]],
    maxXorSubarray: () => [[arr(100000, 0, 1073741823)], [arr(100000, 0, 7)]],
  };
  const out = {};
  for (const name of NAMES) {
    const smalls = Array.from({ length: 8 }, () => small[name]()).map((args) => ({ fn: name, args, expect: BRUTE[name](...structuredClone(args)), kind: 'small' }));
    const larges = large[name]().map((args) => ({ fn: name, args, expect: REF[name](...args), maxMs: LARGE_MS, kind: 'large' }));
    out[name] = [...smalls, ...larges];
  }
  return out;
}
let CASES = null;
const cases = () => (CASES ||= buildCases());

const fnSrc = (name) => { const s = REF[name].toString(); return 'function ' + s; };
const ALGO_REF = '```js\n' + NAMES.map(fnSrc).join('\n') + '\n```';

const algoTask = {
  // Retired from every depth: in calibration (2026-11-11) the lightest model scored 100 twice, so it tells nothing apart.
  // Kept so the measurement can be repeated by task id.
  id: 'coding-5', cat: 'coding', title: '대용량 알고리즘 8문제', retired: true,
  ref: ALGO_REF,
  prompt: `무인 실행이다. 질문하거나 계획만 내놓지 말고 최종 답까지 완성하라.

JavaScript 함수 여덟 개를 작성하라. 채점은 숨은 입력으로 하며, 작은 입력의 정확성과 최대 크기 입력의 실행 시간을 모두 본다. 각 호출은 아래에 적힌 최대 크기에서 2초 안에 끝나야 한다(Node.js 단일 스레드). 단순한 풀이는 작은 입력만 통과한다.

1. countPairs(a, K, D): 정수 배열 a에서 i < j, j − i ≤ D이고 a[i] + a[j]가 K의 배수인 쌍 (i, j)의 개수. 값은 음수일 수 있다. 길이 ≤ 200,000, 1 ≤ K ≤ 100,000, 1 ≤ D < 길이 또는 그 이상, |값| ≤ 10^9.
2. medianSubarrays(a, x): 연속 부분 배열 중 중앙값이 x 이상인 것의 개수. 길이 L인 부분 배열의 중앙값은 오름차순으로 ⌈L/2⌉번째 값이다(짝수 길이면 가운데 둘 중 작은 쪽). 길이 ≤ 200,000.
3. kthPairDistance(a, k): 모든 쌍 i < j의 |a[i] − a[j]|를 오름차순으로 늘어놓았을 때 k번째(1부터 셈) 값. 길이 ≤ 100,000, |값| ≤ 10^9.
4. bestSchedule(jobs, G): jobs는 [시작, 끝, 가치] 배열(끝 > 시작). 일부를 골라 가치 합을 최대로 한다. 고른 작업을 시작 순으로 놓았을 때 다음 작업의 시작은 앞 작업의 끝 + G 이상이어야 한다. 최대 가치 합을 반환. 작업 수 ≤ 100,000, G ≥ 0.
5. distinctInRanges(a, queries): queries의 각 [l, r](0부터 세는 양 끝 포함 구간)에 대해 a[l..r]에 있는 서로 다른 값의 개수를 순서대로 담은 배열. 길이 ≤ 100,000, 질의 수 ≤ 100,000.
6. shortestWithTeleports(grid): 문자열 배열로 된 격자. 'S'에서 'T'까지의 최소 이동 횟수, 갈 수 없으면 −1. '#'은 벽이고 그 밖의 칸은 지날 수 있다. 상하좌우 한 칸 이동이 1회다. 소문자 칸 위에 있을 때는 같은 글자가 적힌 다른 임의의 칸으로 1회에 건너뛸 수 있다. 크기 ≤ 600 × 600.
7. lisCount(a): [가장 긴 순증가 부분 수열의 길이, 그 길이를 갖는 순증가 부분 수열의 개수를 1,000,000,007로 나눈 나머지]. 위치가 다르면 다른 부분 수열로 센다. 길이 ≤ 100,000.
8. maxXorSubarray(a): 비어 있지 않은 연속 부분 배열의 원소를 모두 XOR한 값의 최댓값. 0 ≤ 값 < 2^30, 길이 ≤ 100,000.

최종 코드는 응답 본문 맨 끝에 \`\`\`js 코드블록 하나로만 제시하라. 함수 선언 여덟 개만 포함하고 export, 테스트 코드, 실행 예시는 넣지 마라. 답은 파일이 아니라 응답 본문에 써라.`,
  async score(answer) {
    const code = extractCode(answer); const all = cases(); const parts = [];
    const results = await Promise.all(NAMES.map((name) => runTests(code, name, all[name], 15000)));
    let total = 0;
    NAMES.forEach((name, i) => {
      const cs = all[name], pass = results[i].pass || cs.map(() => false);
      const sm = cs.map((c, k) => (c.kind === 'small' ? pass[k] : null)).filter((v) => v !== null), lg = cs.map((c, k) => (c.kind === 'large' ? pass[k] : null)).filter((v) => v !== null);
      const s = 50 * (sm.filter(Boolean).length / sm.length) + 50 * (lg.filter(Boolean).length / lg.length);
      total += s; parts.push(`${i + 1}:${Math.round(s)}`);
    });
    return { score: Math.round(total / NAMES.length), detail: `문제별 점수 ${parts.join(' ')}` };
  },
};

export const LONG_TASKS = [algoTask];
