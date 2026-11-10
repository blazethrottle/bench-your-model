// Open-ended scheduling problem used by planning-5: parallel machines, family setup times, weighted tardiness.
// There is no "correct answer", only better and worse schedules, so scores cannot pile up at 100.
import { mulberry32 } from './util.mjs';

export function genInstance(seed, n, m) {
  const r = mulberry32(seed); const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const families = 5;
  const setup = Array.from({ length: families }, (_, a) => Array.from({ length: families }, (_, b) => (a === b ? 0 : int(5, 30))));
  const jobs = Array.from({ length: n }, (_, id) => ({ id, duration: int(5, 40), weight: int(1, 10), family: int(0, families - 1), due: 0 }));
  const horizon = jobs.reduce((s, j) => s + j.duration, 0) / m;
  for (const j of jobs) j.due = Math.round(horizon * (0.15 + 0.75 * r()));
  return { machines: m, jobs, setup, timeLimitMs: 2000 };
}

// Checks a schedule and returns its total weighted tardiness (lower is better).
export function evaluate(instance, solution) {
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

// Trivial baseline: jobs in id order, dealt out to machines in turn. This is the 0-point line.
export function baselineSolve(instance) {
  const out = Array.from({ length: instance.machines }, () => []);
  instance.jobs.forEach((j, i) => out[i % instance.machines].push(j.id));
  return out;
}

// Reference optimizer (greedy start + simulated annealing). Used offline with a long budget to set the 100-point line.
export function referenceSolve(instance, budgetMs, seed = 1) {
  const { machines: m, jobs, setup } = instance; const n = jobs.length; const r = mulberry32(seed);
  const dur = jobs.map((j) => j.duration), wt = jobs.map((j) => j.weight), fam = jobs.map((j) => j.family), due = jobs.map((j) => j.due);
  const cost = (seq) => { let t = 0, prev = -1, v = 0; for (let k = 0; k < seq.length; k++) { const id = seq[k]; t += (prev < 0 ? 0 : setup[prev][fam[id]]) + dur[id]; if (t > due[id]) v += wt[id] * (t - due[id]); prev = fam[id]; } return v; };
  // Greedy start: always extend the machine that frees up first with the most urgent job per unit of time.
  const sol = Array.from({ length: m }, () => []); const time = new Array(m).fill(0), last = new Array(m).fill(-1); const left = new Set(jobs.map((j) => j.id));
  const avg = dur.reduce((a, b) => a + b, 0) / n;
  while (left.size) {
    let k = 0; for (let i = 1; i < m; i++) if (time[i] < time[k]) k = i;
    let best = -1, bestScore = -Infinity;
    for (const id of left) {
      const s = last[k] < 0 ? 0 : setup[last[k]][fam[id]]; const slack = Math.max(0, due[id] - dur[id] - s - time[k]);
      const score = (wt[id] / (dur[id] + s)) * Math.exp(-slack / (2 * avg));
      if (score > bestScore) { bestScore = score; best = id; }
    }
    sol[k].push(best); time[k] += (last[k] < 0 ? 0 : setup[last[k]][fam[best]]) + dur[best]; last[k] = fam[best]; left.delete(best);
  }
  const costs = sol.map(cost); let cur = costs.reduce((a, b) => a + b, 0); let bestVal = cur; let bestSol = sol.map((s) => [...s]);
  const start = Date.now(); let temp = Math.max(1, cur / n) * 0.5; const t0 = temp; let iter = 0;
  while (true) {
    if ((iter++ & 255) === 0) { const el = Date.now() - start; if (el >= budgetMs) break; temp = t0 * Math.pow(0.001, el / budgetMs); }
    const a = Math.floor(r() * m), b = Math.floor(r() * m);
    if (!sol[a].length) continue;
    const i = Math.floor(r() * sol[a].length);
    if (r() < 0.5) { // move one job
      const id = sol[a][i]; sol[a].splice(i, 1);
      const j = Math.floor(r() * (sol[b].length + 1)); sol[b].splice(j, 0, id);
      const ca = cost(sol[a]), cb = a === b ? ca : cost(sol[b]); const next = cur - costs[a] - (a === b ? 0 : costs[b]) + ca + (a === b ? 0 : cb);
      if (next <= cur || r() < Math.exp((cur - next) / temp)) { costs[a] = ca; costs[b] = cb; cur = next; } else { sol[b].splice(j, 1); sol[a].splice(i, 0, id); }
    } else { // swap two jobs
      if (!sol[b].length) continue;
      const j = Math.floor(r() * sol[b].length); if (a === b && i === j) continue;
      const x = sol[a][i]; sol[a][i] = sol[b][j]; sol[b][j] = x;
      const ca = cost(sol[a]), cb = a === b ? ca : cost(sol[b]); const next = cur - costs[a] - (a === b ? 0 : costs[b]) + ca + (a === b ? 0 : cb);
      if (next <= cur || r() < Math.exp((cur - next) / temp)) { costs[a] = ca; costs[b] = cb; cur = next; } else { const y = sol[a][i]; sol[a][i] = sol[b][j]; sol[b][j] = y; }
    }
    if (cur < bestVal) { bestVal = cur; bestSol = sol.map((s) => [...s]); }
  }
  return bestSol;
}

// Hidden instances (never shown to the model) and the two public practice instances.
export const HIDDEN = [[9101, 160, 3], [9102, 220, 4], [9103, 300, 5], [9104, 260, 4], [9105, 180, 6], [9106, 340, 6]];
export const PUBLIC = [[501, 120, 3], [502, 240, 5]];
