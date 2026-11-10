// Offline: sets the 100-point line for planning-5 by running the reference optimizer with a long budget
// (far more time than a measured solver gets). Writes fixtures/sched/best.json. Usage: node tools/build-sched-best.mjs [seconds]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genInstance, evaluate, baselineSolve, referenceSolve, HIDDEN } from '../lib/sched.mjs';

const seconds = Number(process.argv[2]) || 15;
const out = {};
for (const [seed, n, m] of HIDDEN) {
  const inst = genInstance(seed, n, m);
  const base = evaluate(inst, baselineSolve(inst)).value;
  let best = Infinity;
  for (const s of [1, 2]) best = Math.min(best, evaluate(inst, referenceSolve(inst, seconds * 1000, s)).value);
  const quick = evaluate(inst, referenceSolve(inst, 1500, 3)).value;
  out[seed] = { n, m, base, best };
  console.log(`instance ${seed} (n=${n}, m=${m}): baseline ${base}, reference(${seconds}s x2) ${best}, reference(1.5s) ${quick} -> ${Math.round((100 * (best / quick - best / base)) / (1 - best / base))}점`);
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sched', 'best.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('written', file);
