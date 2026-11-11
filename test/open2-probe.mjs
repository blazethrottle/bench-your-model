// Prints what the open-task generators produce and checks the scorers on simple answers.
import zlib from 'node:zlib';
import { codecTask, forecastTask, memoTask, OPEN2_INFO } from '../lib/tasks-open2.mjs';
import { genMemos } from '../lib/gen-open.mjs';

const t0 = Date.now();
const logs = OPEN2_INFO.logs();
console.log('log sample:\n' + logs[0].text.split('\n').slice(0, 12).join('\n'));
for (const x of logs) console.log('seed', x.seed, 'raw', x.bytes, 'gzip9', zlib.gzipSync(x.text, { level: 9 }).length, 'brotli11', OPEN2_INFO.logLine()[x.seed]);
console.log('codec starter', await codecTask.score('', codecTask.files));
const GZ = `import zlib from 'node:zlib';
export function compress(t){ return new Uint8Array(zlib.gzipSync(t,{level:9})); }
export function decompress(b){ return zlib.gunzipSync(b).toString('utf8'); }`;
console.log('codec gzip', await codecTask.score('', { 'codec.mjs': GZ }));
const CHEAT = `let keep=''; export function compress(t){ keep=t; return new Uint8Array([1]); } export function decompress(b){ return keep; }`;
console.log('codec cheat', await codecTask.score('', { 'codec.mjs': CHEAT }));

const S = OPEN2_INFO.sales();
console.log('sales train', S.train.length, 'test', S.test.length, 'oracle', S.oracle.toFixed(4), 'base', S.base.toFixed(4), 'csv bytes', forecastTask.files['train.csv'].length);
console.log(forecastTask.files['train.csv'].split('\n').slice(0, 4).join('\n'));
console.log('model starter', await forecastTask.score('', forecastTask.files));
// A simple answer: per store-item median baked in is not possible here without training, so use a price-free heuristic.
const SIMPLE = `export function predict(rows){ return rows.map((r)=> 22 * (r.promo_pct ? 1 + 0.04 * r.promo_pct : 1)); }`;
console.log('model simple', await forecastTask.score('', { 'model.mjs': SIMPLE }));

for (const m of genMemos(421, 300).slice(0, 25)) console.log(JSON.stringify(m.text), '=>', JSON.stringify(m.expected));
console.log('parser starter', await memoTask.score('', memoTask.files));
console.log('elapsed', Date.now() - t0, 'ms');
