// Work-folder tasks built on the orderflow fixture (fixtures/orderflow is the correct reference).
// debug-5: the folder holds the project with seeded defects; hidden event scripts grade the repaired code.
// debug-6: a different set of seeded defects; the model reports locations, graded on recall with a precision penalty.
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProjectOutputs } from './sandbox.mjs';
import { mulberry32, extractJson } from './util.mjs';

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'orderflow');
const SRC = Object.fromEntries(readdirSync(join(FIX_DIR, 'src')).filter((f) => f.endsWith('.mjs')).sort().map((f) => [`src/${f}`, readFileSync(join(FIX_DIR, 'src', f), 'utf8')]));
const README = readFileSync(join(FIX_DIR, 'README.md'), 'utf8');
const PKG = readFileSync(join(FIX_DIR, 'package.json'), 'utf8');

// Each defect is one exact text replacement in the reference source.
const FIX_BUGS = [
  { id: 'F1', file: 'src/pricing.mjs', find: 'if (qty >= 10) return 5;', put: 'if (qty > 10) return 5;' },
  { id: 'F2', file: 'src/pricing.mjs', find: 'const share = i === lines.length - 1 ? couponDiscount - allocated : Math.floor((couponDiscount * line.net) / subtotal);', put: 'const share = Math.floor((couponDiscount * line.net) / subtotal);' },
  { id: 'F3', file: 'src/pricing.mjs', find: 'const freeShipping = merchandise >= FREE_SHIPPING_MIN', put: 'const freeShipping = subtotal >= FREE_SHIPPING_MIN' },
  { id: 'F4', file: 'src/pricing.mjs', find: 'const tax = Math.floor((taxableBase * 10 + 50) / 100);', put: 'const tax = Math.floor((taxableBase * 10) / 100);' },
  { id: 'F5', file: 'src/dates.mjs', find: '    current += 1;\n    if (!isWeekend(current)) left -= 1;', put: '    if (!isWeekend(current)) left -= 1;\n    current += 1;' },
  { id: 'F6', file: 'src/orders.mjs', find: "\n    if (reserve(state.inventory, order.lines)) order.status = 'reserved';", put: "\n    if (!reserve(state.inventory, order.lines)) break;\n    order.status = 'reserved';" },
  { id: 'F7', file: 'src/inventory.mjs', find: '    inv[line.sku].onHand -= line.qty;\n    inv[line.sku].reserved -= line.qty;', put: '    inv[line.sku].onHand -= line.qty;' },
  { id: 'F8', file: 'src/orders.mjs', find: "if (line.returned + item.qty > line.qty) return 'RETURN_QTY';", put: "if (item.qty > line.qty) return 'RETURN_QTY';" },
  { id: 'F9', file: 'src/report.mjs', find: '(a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)', put: '(a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)' },
  { id: 'F10', file: 'src/dates.mjs', find: '  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== date) return null;\n', put: '' },
];
const REVIEW_BUGS = [
  { id: 'R1', file: 'src/pricing.mjs', find: 'const lines = mergeItems(items).map((item) => {', put: 'const lines = items.map((item) => {' },
  { id: 'R2', file: 'src/orders.mjs', find: 'const usable = !state.pct10Used.has(event.customer);', put: 'const usable = !state.pct10Used.has(event.id);' },
  { id: 'R3', file: 'src/pricing.mjs', find: 'Math.ceil((weight - 10000) / 5000)', put: 'Math.floor((weight - 10000) / 5000)' },
  { id: 'R4', file: 'src/pricing.mjs', find: "const shipping = (freeShipping ? 0 : shippingBase(weight)) + (region === 'JEJU' ? JEJU_SURCHARGE : 0);", put: "const shipping = freeShipping ? 0 : shippingBase(weight) + (region === 'JEJU' ? JEJU_SURCHARGE : 0);" },
  { id: 'R5', file: 'src/pricing.mjs', find: 'const taxableBase = lines.reduce((sum, line) => sum + (line.taxable ? line.net : 0), 0);', put: 'const taxableBase = lines.reduce((sum, line) => sum + (line.taxable ? line.gross - line.tierDiscount : 0), 0);' },
  { id: 'R6', file: 'src/inventory.mjs', find: '  for (const line of lines) if (available(inv, line.sku) < line.qty) return false;\n  for (const line of lines) inv[line.sku].reserved += line.qty;\n  return true;', put: '  for (const line of lines) {\n    if (available(inv, line.sku) < line.qty) return false;\n    inv[line.sku].reserved += line.qty;\n  }\n  return true;' },
  { id: 'R7', file: 'src/orders.mjs', find: '    release(state.inventory, order.lines);\n    postFullRefund(state.ledger, order);', put: '    postFullRefund(state.ledger, order);' },
  { id: 'R8', file: 'src/orders.mjs', find: "if (day - order.deliveredDay > RETURN_WINDOW_DAYS) return 'RETURN_WINDOW';", put: "if (day - order.deliveredDay >= RETURN_WINDOW_DAYS) return 'RETURN_WINDOW';" },
  { id: 'R9', file: 'src/orders.mjs', find: "if (order.lines.every((line) => line.returned === line.qty)) order.status = 'returned';", put: "if (order.lines.some((line) => line.returned === line.qty)) order.status = 'returned';" },
  { id: 'R10', file: 'src/orders.mjs', find: "if (event.amount !== order.total) return 'BAD_AMOUNT';", put: "if (event.amount < order.total) return 'BAD_AMOUNT';" },
  { id: 'R11', file: 'src/pricing.mjs', find: "coupon === 'FIX5000' && subtotal >= FIX5000_MIN", put: "coupon === 'FIX5000' && subtotal > FIX5000_MIN" },
  { id: 'R12', file: 'src/ledger.mjs', find: '  ledger.cash -= order.total;\n  ledger.revenue -= order.merchandise;\n  ledger.shipping -= order.shipping;', put: '  ledger.cash -= order.total;\n  ledger.revenue -= order.merchandise;' },
];

// Applies defects and returns the files plus the line where each defect starts.
export function seed(bugs) {
  const files = { ...SRC }; const mark = (id) => `/*@@${id}@@*/`;
  for (const b of bugs) {
    if (files[b.file].split(b.find).length !== 2) throw new Error(`defect ${b.id}: target text must occur exactly once`);
    files[b.file] = files[b.file].replace(b.find, () => (b.put.startsWith('\n') ? '\n' + mark(b.id) + b.put.slice(1) : mark(b.id) + b.put));
  }
  const lines = {};
  for (const b of bugs) { const at = files[b.file].indexOf(mark(b.id)); lines[b.id] = files[b.file].slice(0, at).split('\n').length; }
  for (const f of Object.keys(files)) files[f] = files[f].replace(/\/\*@@\w+@@\*\//g, '');
  return { files, lines };
}

// ---------- hidden cases: generated event scripts and price quotes ----------
const SKUS = ['TEA-01', 'MUG-02', 'BOOK-03', 'RICE-04', 'PAN-05', 'PEN-06'];
const QTYS = [1, 1, 2, 3, 5, 9, 10, 11, 12, 49, 50, 51];
function genScript(r, n) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)]; const events = []; const ids = []; let day = Date.UTC(2026, 2, 2) / 86400000;
  const date = () => new Date(day * 86400000).toISOString().slice(0, 10);
  const items = (small) => Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ sku: pick(SKUS), qty: small ? 1 + Math.floor(r() * 3) : pick(QTYS) }));
  for (const sku of SKUS) if (r() < 0.8) events.push({ type: 'stock', date: date(), sku, qty: pick([5, 20, 60, 120]) });
  while (events.length < n) {
    if (r() < 0.6) day += Math.floor(r() * 4);
    const u = r(); const id = ids.length ? pick(ids) : 'O0';
    if (u < 0.22 || !ids.length) { const nid = `O${ids.length + 1}`; ids.push(nid); events.push({ type: 'order', date: date(), id: nid, customer: pick(['가람', '나은', '다온', '라미']), region: pick(['SEOUL', 'BUSAN', 'JEJU', 'DAEGU']), items: items(false), coupon: pick([undefined, undefined, 'PCT10', 'PCT10', 'FIX5000', 'FREESHIP', 'HELLO']) }); }
    else if (u < 0.40) events.push({ type: 'pay', date: date(), id, amount: '@total' });
    else if (u < 0.54) events.push({ type: 'ship', date: date(), id });
    else if (u < 0.66) events.push({ type: 'deliver', date: date(), id });
    else if (u < 0.76) events.push({ type: 'return', date: date(), id, items: [{ sku: '@line', qty: pick([1, 1, 2, 5]) }] });
    else if (u < 0.83) events.push({ type: 'cancel', date: date(), id });
    else if (u < 0.92) events.push({ type: 'stock', date: date(), sku: pick(SKUS), qty: pick([1, 5, 20, 60]) });
    else events.push(pick([{ type: 'pay', date: date(), id, amount: 1 }, { type: 'stock', date: '2026-02-30', sku: 'TEA-01', qty: 5 }, { type: 'order', date: date(), id: `X${events.length}`, customer: '가람', region: 'SEOUL', items: [{ sku: 'NOPE-99', qty: 0 }] }, { type: 'refund', date: date(), id }, { type: 'ship', date: '2026-13-01', id }, { type: 'order', date: date(), id, customer: '나은', region: 'SEOUL', items: [] }]));
  }
  return events;
}

// Placeholders ('@total', '@line') are resolved against the reference engine so that pay amounts and return lines are valid.
function resolve(ref, events) {
  const out = [];
  for (const e of events) {
    const ev = structuredClone(e);
    if (ev.amount === '@total' || (ev.items && ev.items[0] && ev.items[0].sku === '@line')) {
      const order = ref.processEvents([...out]).orders.find((o) => o.id === ev.id);
      if (ev.amount === '@total') ev.amount = order ? order.total : 1000;
      else { const src = [...out].reverse().find((x) => x.type === 'order' && x.id === ev.id && Array.isArray(x.items) && x.items.length); ev.items[0].sku = src ? src.items[Math.floor(src.items.length / 2)].sku : 'TEA-01'; }
    }
    out.push(ev);
  }
  return out;
}

const HAND = [ // situations random scripts rarely reach: equal net spend, Friday shipping, split returns, waiting orders
  [{ type: 'stock', date: '2026-03-02', sku: 'MUG-02', qty: 10 }, { type: 'order', date: '2026-03-02', id: 'A', customer: '하늘', region: 'SEOUL', items: [{ sku: 'MUG-02', qty: 1 }] }, { type: 'order', date: '2026-03-02', id: 'B', customer: '가람', region: 'SEOUL', items: [{ sku: 'MUG-02', qty: 1 }] }, { type: 'order', date: '2026-03-02', id: 'C', customer: '마루', region: 'SEOUL', items: [{ sku: 'MUG-02', qty: 1 }] }, { type: 'order', date: '2026-03-02', id: 'D', customer: '보람', region: 'SEOUL', items: [{ sku: 'MUG-02', qty: 1 }] }, { type: 'pay', date: '2026-03-03', id: 'A', amount: '@total' }, { type: 'pay', date: '2026-03-03', id: 'B', amount: '@total' }, { type: 'pay', date: '2026-03-03', id: 'C', amount: '@total' }, { type: 'pay', date: '2026-03-03', id: 'D', amount: '@total' }],
  [{ type: 'stock', date: '2026-03-02', sku: 'PAN-05', qty: 5 }, { type: 'order', date: '2026-03-05', id: 'A', customer: '가람', region: 'BUSAN', items: [{ sku: 'PAN-05', qty: 1 }] }, { type: 'pay', date: '2026-03-05', id: 'A', amount: '@total' }, { type: 'ship', date: '2026-03-06', id: 'A' }, { type: 'order', date: '2026-03-06', id: 'B', customer: '나은', region: 'JEJU', items: [{ sku: 'PAN-05', qty: 2 }] }, { type: 'pay', date: '2026-03-06', id: 'B', amount: '@total' }, { type: 'ship', date: '2026-03-07', id: 'B' }, { type: 'order', date: '2026-03-06', id: 'C', customer: '다온', region: 'SEOUL', items: [{ sku: 'PAN-05', qty: 1 }] }, { type: 'pay', date: '2026-03-06', id: 'C', amount: '@total' }, { type: 'ship', date: '2026-03-06', id: 'C' }],
  [{ type: 'stock', date: '2026-03-02', sku: 'PEN-06', qty: 100 }, { type: 'stock', date: '2026-03-02', sku: 'TEA-01', qty: 100 }, { type: 'order', date: '2026-03-02', id: 'A', customer: '가람', region: 'SEOUL', items: [{ sku: 'PEN-06', qty: 7 }, { sku: 'TEA-01', qty: 3 }], coupon: 'PCT10' }, { type: 'pay', date: '2026-03-02', id: 'A', amount: '@total' }, { type: 'ship', date: '2026-03-03', id: 'A' }, { type: 'deliver', date: '2026-03-04', id: 'A' }, { type: 'return', date: '2026-03-10', id: 'A', items: [{ sku: 'TEA-01', qty: 2 }] }, { type: 'return', date: '2026-03-11', id: 'A', items: [{ sku: 'TEA-01', qty: 2 }] }, { type: 'return', date: '2026-03-18', id: 'A', items: [{ sku: 'TEA-01', qty: 1 }] }, { type: 'return', date: '2026-03-19', id: 'A', items: [{ sku: 'PEN-06', qty: 7 }] }],
  [{ type: 'order', date: '2026-03-02', id: 'A', customer: '가람', region: 'SEOUL', items: [{ sku: 'RICE-04', qty: 3 }] }, { type: 'order', date: '2026-03-02', id: 'B', customer: '나은', region: 'DAEGU', items: [{ sku: 'RICE-04', qty: 1 }] }, { type: 'order', date: '2026-03-02', id: 'C', customer: '다온', region: 'JEJU', items: [{ sku: 'RICE-04', qty: 1 }, { sku: 'TEA-01', qty: 1 }] }, { type: 'stock', date: '2026-03-03', sku: 'RICE-04', qty: 2 }, { type: 'stock', date: '2026-03-03', sku: 'TEA-01', qty: 1 }, { type: 'pay', date: '2026-03-04', id: 'B', amount: '@total' }, { type: 'cancel', date: '2026-03-04', id: 'B' }, { type: 'stock', date: '2026-03-05', sku: 'RICE-04', qty: 2 }],
  [{ type: 'stock', date: '2026-03-02', sku: 'BOOK-03', qty: 10 }, { type: 'stock', date: '2026-03-02', sku: 'MUG-02', qty: 10 }, { type: 'order', date: '2026-03-02', id: 'A', customer: '나은', region: 'BUSAN', items: [{ sku: 'BOOK-03', qty: 2 }, { sku: 'MUG-02', qty: 1 }, { sku: 'BOOK-03', qty: 1 }], coupon: 'FIX5000' }, { type: 'order', date: '2026-02-30', id: 'Z', customer: '나은', region: 'BUSAN', items: [{ sku: 'BOOK-03', qty: 1 }] }, { type: 'pay', date: '2026-03-02', id: 'A', amount: '@total' }, { type: 'order', date: '2026-03-03', id: 'B', customer: '가람', region: 'BUSAN', items: [{ sku: 'BOOK-03', qty: 2 }, { sku: 'MUG-02', qty: 1 }, { sku: 'BOOK-03', qty: 1 }], coupon: 'FIX5000' }, { type: 'pay', date: '2026-03-03', id: 'B', amount: '@total' }],
];

// Short scenarios aimed at one area each, so that a single defect can be told apart from the others.
function lifecycle(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)]; let day = Date.UTC(2026, 2, 2) / 86400000 + Math.floor(r() * 7);
  const date = () => new Date(day * 86400000).toISOString().slice(0, 10); const ev = [];
  const skus = [pick(SKUS), pick(SKUS)].filter((v, i, a) => a.indexOf(v) === i);
  for (const sku of skus) ev.push({ type: 'stock', date: date(), sku, qty: 200 });
  const items = skus.map((sku) => ({ sku, qty: pick([1, 2, 3, 4, 6, 7]) }));
  ev.push({ type: 'order', date: date(), id: 'A', customer: '가람', region: pick(['SEOUL', 'BUSAN', 'JEJU']), items, coupon: pick([undefined, undefined, 'PCT10', 'FIX5000']) });
  ev.push({ type: 'pay', date: date(), id: 'A', amount: '@total' });
  day += Math.floor(r() * 5); ev.push({ type: 'ship', date: date(), id: 'A' });
  day += 1 + Math.floor(r() * 3); ev.push({ type: 'deliver', date: date(), id: 'A' });
  const n = Math.floor(r() * 4);
  for (let k = 0; k < n; k++) { day += Math.floor(r() * 6); const it = pick(items); ev.push({ type: 'return', date: date(), id: 'A', items: [{ sku: it.sku, qty: pick([1, 1, 2, it.qty]) }] }); }
  return ev;
}
function tieScript(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)]; const sku = pick(SKUS), qty = pick([1, 2, 3]);
  const names = ['하늘', '가람', '마루', '보람', '나은', '다온'].sort(() => r() - 0.5).slice(0, 4 + Math.floor(r() * 2));
  const ev = [{ type: 'stock', date: '2026-03-02', sku, qty: 100 }];
  names.forEach((c, i) => ev.push({ type: 'order', date: '2026-03-02', id: `T${i}`, customer: c, region: 'SEOUL', items: [{ sku, qty }] }));
  names.forEach((c, i) => ev.push({ type: 'pay', date: '2026-03-03', id: `T${i}`, amount: '@total' }));
  return ev;
}
function backorderScript(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)]; const sku = pick(SKUS), big = pick([3, 4, 5]), small = pick([1, 2]);
  return [
    { type: 'order', date: '2026-03-02', id: 'A', customer: '가람', region: 'SEOUL', items: [{ sku, qty: big }] },
    { type: 'order', date: '2026-03-02', id: 'B', customer: '나은', region: 'BUSAN', items: [{ sku, qty: small }] },
    { type: 'order', date: '2026-03-02', id: 'C', customer: '다온', region: 'DAEGU', items: [{ sku, qty: small }] },
    { type: 'stock', date: '2026-03-03', sku, qty: small + (r() < 0.5 ? 0 : small) },
  ];
}

// A unit is one call seen through one view of its result; defects are told apart at this level.
const VIEWS = { processEvents: ['orders', 'inventory', 'ledger', 'revenueByCategory', 'topCustomers', 'rejected'], quote: [null] };
const view = (value, v) => JSON.stringify(v === null ? value : value == null ? undefined : value[v]);

let BUILT = null;
// Builds every hidden case once: expected values from the reference, plus which units isolate which defect.
export async function buildFixCases() {
  if (BUILT) return BUILT;
  const ref = await import(pathToFileURL(join(FIX_DIR, 'src', 'index.mjs')).href);
  const r = mulberry32(424242); const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const calls = [];
  for (const h of HAND) calls.push({ fn: 'processEvents', args: [resolve(ref, h)] });
  for (let i = 0; i < 60; i++) calls.push({ fn: 'processEvents', args: [resolve(ref, genScript(r, 14 + Math.floor(r() * 14)))] });
  for (let i = 0; i < 260; i++) calls.push({ fn: 'processEvents', args: [resolve(ref, lifecycle(r))] });
  for (let i = 0; i < 30; i++) calls.push({ fn: 'processEvents', args: [resolve(ref, tieScript(r))] });
  for (let i = 0; i < 30; i++) calls.push({ fn: 'processEvents', args: [resolve(ref, backorderScript(r))] });
  for (let i = 0; i < 500; i++) calls.push({ fn: 'quote', args: [Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ sku: pick(SKUS), qty: pick(QTYS) })), pick([undefined, 'PCT10', 'PCT10', 'FIX5000', 'FREESHIP']), pick(['SEOUL', 'JEJU', 'BUSAN'])] });
  const expect = calls.map((c) => JSON.parse(JSON.stringify(ref[c.fn](...structuredClone(c.args)))));
  const units = calls.flatMap((c, i) => VIEWS[c.fn].map((v) => ({ call: i, v })));
  const judge = (outputs) => units.map((u) => outputs[u.call] !== undefined && view(outputs[u.call], u.v) === view(expect[u.call], u.v));

  // Load each single-defect variant (our own code) from a temp folder and see which units it breaks.
  const tmp = mkdtempSync(join(tmpdir(), 'bm-variants-'));
  const outcome = async (files, tag) => {
    for (const [rel, content] of Object.entries(files)) { const p = join(tmp, tag, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); }
    writeFileSync(join(tmp, tag, 'package.json'), PKG);
    const mod = await import(pathToFileURL(join(tmp, tag, 'src', 'index.mjs')).href);
    return judge(calls.map((c) => { try { return JSON.parse(JSON.stringify(mod[c.fn](...structuredClone(c.args)))); } catch { return undefined; } }));
  };
  const single = {};
  for (const b of FIX_BUGS) single[b.id] = await outcome(seed([b]).files, b.id);
  const fixture = await outcome(seed(FIX_BUGS).files, 'all');
  rmSync(tmp, { recursive: true, force: true });

  // A unit isolates defect X when X alone breaks it and no other defect alone does. At most one unit per call.
  const isolating = {};
  for (const b of FIX_BUGS) {
    const seen = new Set(); isolating[b.id] = [];
    units.forEach((u, k) => {
      if (isolating[b.id].length >= 8 || seen.has(u.call)) return;
      if (!single[b.id][k] && !fixture[k] && FIX_BUGS.every((o) => o.id === b.id || single[o.id][k])) { isolating[b.id].push(k); seen.add(u.call); }
    });
  }
  // Regression units already behave correctly in the seeded project and must stay that way.
  const regression = units.map((_, k) => k).filter((k) => fixture[k] && FIX_BUGS.every((o) => single[o.id][k])).filter((_, n) => n % 3 === 0);
  BUILT = { calls, units, judge, isolating, regression, ref };
  return BUILT;
}

const UNATTENDED = '무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라.';

function visibleTest(ref) {
  const q1 = [[{ sku: 'PEN-06', qty: 10 }], undefined, 'SEOUL'], q2 = [[{ sku: 'PEN-06', qty: 11 }], undefined, 'SEOUL'];
  const ev = [{ type: 'stock', date: '2026-03-02', sku: 'MUG-02', qty: 5 }, { type: 'order', date: '2026-03-02', id: 'A', customer: '가람', region: 'SEOUL', items: [{ sku: 'MUG-02', qty: 2 }] }, { type: 'pay', date: '2026-03-02', id: 'A', amount: ref.quote([{ sku: 'MUG-02', qty: 2 }], undefined, 'SEOUL').total }, { type: 'ship', date: '2026-03-03', id: 'A' }];
  return `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processEvents, quote } from '../src/index.mjs';

test('수량 10개는 5% 할인을 받는다', () => {
  assert.deepEqual(quote(${JSON.stringify(q1[0])}, undefined, 'SEOUL'), ${JSON.stringify(ref.quote(...q1))});
});

test('세금은 반올림한다', () => {
  assert.equal(quote(${JSON.stringify(q2[0])}, undefined, 'SEOUL').tax, ${ref.quote(...q2).tax});
});

test('출고하면 묶인 수량도 줄어든다', () => {
  const summary = processEvents(${JSON.stringify(ev)});
  assert.deepEqual(summary.inventory['MUG-02'], ${JSON.stringify(ref.processEvents(ev).inventory['MUG-02'])});
  assert.equal(summary.orders[0].status, 'shipped');
});

test('없는 주문에 대한 결제는 거부된다', () => {
  assert.deepEqual(processEvents([{ type: 'pay', date: '2026-03-02', id: 'none', amount: 1 }]).rejected, [{ index: 0, reason: 'NO_ORDER' }]);
});
`;
}

const refIndex = await import(pathToFileURL(join(FIX_DIR, 'src', 'index.mjs')).href);
const fixSeed = seed(FIX_BUGS);
const fixFiles = { ...fixSeed.files, 'README.md': README, 'package.json': PKG, 'test/basic.test.mjs': visibleTest(refIndex) };

const fixTask = {
  id: 'debug-5', cat: 'debug', title: '여러 파일 프로젝트 결함 수정', long: true, timeoutSec: 1200,
  files: fixFiles, refFiles: { ...fixFiles, ...SRC }, ref: '수정 완료',
  prompt: `${UNATTENDED}

현재 작업 폴더에 주문 처리 엔진 프로젝트(orderflow)가 있다. README.md가 동작의 기준이 되는 명세다. src/ 의 코드에는 명세와 다르게 동작하는 결함이 여러 개 있다. 개수는 알려 주지 않는다.

할 일: 명세와 코드를 대조해 결함을 모두 찾아 src/ 의 파일을 직접 고쳐라.

- test/ 의 테스트는 동작의 일부만 확인한다. 테스트가 통과해도 결함이 남아 있을 수 있다. 채점은 공개하지 않은 훨씬 많은 입력으로 한다.
- processEvents와 quote의 이름, 인자, 반환 형식은 바꾸지 마라. 파일을 다른 곳으로 옮기거나 이름을 바꾸지 마라.
- 명세에 맞게 동작하던 부분을 바꾸면 감점이다.
- 작업은 이 폴더 안에서만 하라. 끝나면 고친 결함을 한 줄씩 요약해 응답하라.`,
  async score(_answer, work) {
    const src = Object.fromEntries(Object.entries(work || {}).filter(([p]) => p.startsWith('src/') && p.endsWith('.mjs')));
    if (!src['src/index.mjs']) return { score: 0, detail: 'src/index.mjs 를 찾지 못함' };
    const { calls, judge, isolating, regression } = await buildFixCases();
    const res = await runProjectOutputs({ ...src, 'package.json': PKG }, 'src/index.mjs', calls, 40000);
    const pass = judge(res.outputs);
    const fixed = FIX_BUGS.map((b) => (isolating[b.id].length ? isolating[b.id].filter((i) => pass[i]).length / isolating[b.id].length : 0));
    const bugPart = fixed.reduce((a, b) => a + b, 0) / fixed.length;
    const regPart = regression.filter((i) => pass[i]).length / regression.length;
    const fully = fixed.filter((f) => f === 1).length;
    return { score: Math.round(100 * bugPart * regPart), detail: `결함 ${fully}/${FIX_BUGS.length}개 완전 수정, 기존 동작 유지 ${Math.round(regPart * 100)}%${res.fatal ? ` (${res.fatal})` : ''}${res.hung ? ' (실행이 끝나지 않아 중단)' : ''}` };
  },
};

// ---------- debug-6: review, report defect locations ----------
const reviewSeed = seed(REVIEW_BUGS);
const base = (p) => String(p || '').replace(/\\/g, '/').split('/').pop();
const reviewTask = {
  id: 'debug-6', cat: 'debug', title: '코드 검토로 결함 찾기', long: true, timeoutSec: 1200,
  files: { ...reviewSeed.files, 'README.md': README, 'package.json': PKG },
  ref: '```json\n' + JSON.stringify({ defects: REVIEW_BUGS.map((b) => ({ file: b.file, line: reviewSeed.lines[b.id], description: b.id })) }) + '\n```',
  prompt: `${UNATTENDED}

현재 작업 폴더에 주문 처리 엔진 프로젝트(orderflow)가 있다. README.md가 동작의 기준이 되는 명세다. src/ 의 코드에는 명세와 다르게 동작하는 결함이 여러 개 있다. 개수는 알려 주지 않는다. 테스트는 제공하지 않는다.

할 일: 코드를 검토해 결함의 위치를 보고하라. 코드를 고칠 필요는 없다.

- 보고 대상은 명세와 다른 결과를 실제로 만들어 내는 결함뿐이다. 코드 스타일, 성능, 명세에 없는 입력에 대한 방어 부족은 결함이 아니다.
- 결함마다 파일 경로와, 잘못된 코드가 있는 줄 번호(지금 폴더에 있는 파일 기준)를 적는다.
- 틀린 보고가 많으면 감점이다. 확인한 것만 적고, 최대 20개까지만 적어라.

답 형식: {"defects": [{"file": "src/pricing.mjs", "line": 12, "description": "무엇이 명세와 어떻게 다른지 한 문장"}]}

최종 답은 응답 본문 맨 끝에 \`\`\`json 코드블록 하나로만 제시하라.`,
  score(answer) {
    const a = extractJson(answer); const list = Array.isArray(a) ? a : a && a.defects;
    if (!Array.isArray(list) || !list.length) return { score: 0, detail: '결함 목록 JSON을 찾지 못함' };
    const reports = list.slice(0, 20).filter((d) => d && typeof d === 'object'); const used = new Set(); let tp = 0;
    for (const d of reports) {
      const hit = REVIEW_BUGS.find((b) => !used.has(b.id) && base(b.file) === base(d.file) && Math.abs(Number(d.line) - reviewSeed.lines[b.id]) <= 3);
      if (hit) { used.add(hit.id); tp++; }
    }
    const recall = tp / REVIEW_BUGS.length, precision = tp / Math.max(1, list.length);
    return { score: Math.round(100 * recall * Math.min(1, precision / 0.5)), detail: `심은 결함 ${tp}/${REVIEW_BUGS.length}개 발견, 보고 ${list.length}건 중 적중 ${tp}건` };
  },
};

export const PROJECT_TASKS = [fixTask, reviewTask];
export const PROJECT_INFO = { FIX_BUGS, REVIEW_BUGS, fixSeed, reviewSeed };
