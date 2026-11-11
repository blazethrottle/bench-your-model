// Deterministic data generators for the open-ended tasks: server logs (compression), retail sales (forecasting)
// and free-form order memos (normalization). Everything is derived from a seed, so hidden sets never live on disk.
import { mulberry32 } from './util.mjs';

const pad = (n, w = 2) => String(n).padStart(w, '0');
const rng = (seed) => {
  const r = mulberry32(seed);
  const int = (n) => Math.floor(r() * n);
  const pick = (a) => a[int(a.length)];
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / 0.70710678; };
  const weighted = (pairs) => { let t = 0; for (const p of pairs) t += p[1]; let x = r() * t; for (const p of pairs) { x -= p[1]; if (x < 0) return p[0]; } return pairs[pairs.length - 1][0]; };
  return { r, int, pick, gauss, weighted };
};

// ---------- 1. server log ----------
const ENDPOINTS = [
  { m: 'GET', p: '/api/v2/products', w: 26, pool: 'web', dur: [3.3, 0.45], bytes: [9200, 3800], st: [[200, 96], [304, 3], [500, 1]] },
  { m: 'GET', p: '/api/v2/products/{pid}', w: 38, pool: 'web', dur: [2.9, 0.4], bytes: [2400, 700], st: [[200, 93], [304, 4], [404, 3]] },
  { m: 'GET', p: '/api/v2/search?q={term}', w: 10, pool: 'web', dur: [4.4, 0.6], bytes: [15000, 7000], st: [[200, 98], [500, 2]] },
  { m: 'GET', p: '/api/v2/cart', w: 13, pool: 'web', dur: [2.6, 0.35], bytes: [1200, 500], st: [[200, 99], [401, 1]] },
  { m: 'POST', p: '/api/v2/cart/items', w: 9, pool: 'web', dur: [3.6, 0.4], bytes: [310, 40], st: [[201, 90], [400, 6], [409, 4]] },
  { m: 'POST', p: '/api/v2/orders', w: 4, pool: 'web', dur: [5.4, 0.5], bytes: [640, 60], st: [[201, 91], [402, 7], [500, 2]] },
  { m: 'GET', p: '/api/v2/orders/{oid}', w: 7, pool: 'web', dur: [3.1, 0.4], bytes: [1900, 300], st: [[200, 95], [404, 5]] },
  { m: 'POST', p: '/api/v2/login', w: 5, pool: 'web', dur: [4.6, 0.3], bytes: [420, 20], st: [[200, 89], [401, 11]] },
  { m: 'POST', p: '/internal/payments/charge', w: 3, pool: 'api', dur: [6.0, 0.55], bytes: [280, 30], st: [[200, 93], [402, 5], [504, 2]] },
  { m: 'GET', p: '/healthz', w: 3, pool: 'any', dur: [0.7, 0.3], bytes: [17, 0], st: [[200, 100]] },
];
const TERMS = ['mug', 'pen', 'notebook', 'lamp', 'desk', 'chair', 'bag', 'cable', 'stand', 'bottle', 'mouse', 'keyboard', 'monitor', 'shelf', 'clock', 'frame'];
const POOLS = { web: ['web-01', 'web-02', 'web-03', 'web-04', 'web-05'], api: ['api-01', 'api-02', 'api-03'] };
const QUEUES = ['email', 'thumbnail', 'export', 'webhook'];

export function genLog(seed, lines) {
  const { r, int, pick, gauss, weighted } = rng(seed);
  const hex = () => pad(int(65536).toString(16), 4) + pad(int(65536).toString(16), 4);
  const skew = (n, p) => Math.min(n - 1, Math.floor(n * Math.pow(r(), p)));
  const users = 2500, userNo = (i) => 100000 + ((i * 7919) % 900000), userIp = (i) => `10.${4 + (i % 6)}.${(i * 31) % 250}.${1 + ((i * 17) % 250)}`;
  const out = []; let seq = 0;
  const iso = (ms) => new Date(ms).toISOString();
  const push = (t, s) => out.push([t, seq++, s]);
  const all = [...POOLS.web, ...POOLS.api];
  let t = Date.UTC(2026, 2, 10 + (seed % 15), seed % 24, (seed * 7) % 60, 0);
  const t0 = t; let orderId = 770000 + (seed % 1000) * 13;
  const requests = Math.ceil(lines / 2.05);
  for (let i = 0; i < requests; i++) {
    t += 1 + Math.floor(-Math.log(1 - r()) * 42);
    const ep = weighted(ENDPOINTS.map((e) => [e, e.w]));
    const host = ep.pool === 'any' ? pick(all) : pick(POOLS[ep.pool]);
    const u = skew(users, 2.4);
    let path = ep.p;
    if (path.includes('{pid}')) path = path.replace('{pid}', String(1000 + skew(800, 2.0)));
    if (path.includes('{term}')) path = path.replace('{term}', pick(TERMS));
    if (path.includes('{oid}')) path = path.replace('{oid}', String(orderId - skew(400, 1.5)));
    const st = weighted(ep.st);
    if (ep.p === '/api/v2/orders' && st === 201) orderId++;
    const dur = Math.max(1, Math.round(Math.exp(ep.dur[0] + ep.dur[1] * gauss())));
    const bytes = ep.bytes[1] ? Math.max(20, Math.round(ep.bytes[0] + ep.bytes[1] * gauss())) : ep.bytes[0];
    const id = hex();
    const who = ep.p === '/healthz' ? 'user=- ip=10.0.0.1' : `user=u${userNo(u)} ip=${r() < 0.03 ? `10.9.${int(250)}.${1 + int(250)}` : userIp(u)}`;
    push(t, `${iso(t)} ${host} INFO  req=${id} start ${ep.m} ${path} ${who}`);
    const lvl = st >= 500 ? 'ERROR' : st >= 400 ? 'WARN ' : 'INFO ';
    push(t + dur, `${iso(t + dur)} ${host} ${lvl} req=${id} end status=${st} dur_ms=${dur} bytes=${st >= 400 ? 96 : bytes}`);
    if (st >= 500) push(t + dur, `${iso(t + dur)} ${host} ERROR req=${id} upstream timeout svc=${pick(['payments', 'catalog', 'search'])} attempt=${1 + int(3)}`);
    if (r() < 0.012) { const w = `worker-0${1 + int(3)}`; push(t, `${iso(t)} ${w} WARN  queue=${pick(QUEUES)} depth=${50 + int(900)} lag_ms=${int(20000)}`); }
  }
  // Heartbeats: every 5 s per host, values follow a slow random walk.
  for (const h of all) {
    let cpu = 20 + int(40), mem = 4000 + int(4000), conns = 100 + int(200);
    for (let ht = t0 + int(5000); ht < t; ht += 5000) {
      cpu = Math.min(99, Math.max(1, cpu + int(7) - 3)); mem = Math.max(1000, mem + int(41) - 20); conns = Math.max(0, conns + int(11) - 5);
      push(ht, `${iso(ht)} ${h} DEBUG heartbeat cpu=${cpu} mem=${mem} conns=${conns}`);
    }
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, lines).map((x) => x[2]).join('\n') + '\n';
}

// ---------- 2. retail sales ----------
const CATS = ['음료', '간편식', '아이스크림', '생활용품'];
const HOLIDAYS = new Set(['2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06', '2025-06-03', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25', '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-25', '2026-06-03', '2026-06-06', '2026-07-17']);
export const SALES_COLUMNS = ['date', 'store', 'store_type', 'item', 'category', 'price', 'promo_pct', 'holiday', 'temp_c', 'rain_mm'];
const TRAIN_DAYS = 546, FUTURE_DAYS = 42;

export function genSales(seed = 4177) {
  const { r, int, pick, gauss } = rng(seed);
  const day0 = Date.UTC(2025, 0, 1);
  const dateOf = (d) => new Date(day0 + d * 86400000).toISOString().slice(0, 10);
  const stores = ['A', 'B', 'C', 'A', 'B', 'B', 'C', 'A'].map((type, i) => ({ id: `S${pad(i + 1)}`, type, base: Math.exp(0.35 * gauss()), growth: -0.1 + 0.35 * r() }));
  const items = Array.from({ length: 18 }, (_, i) => {
    const cat = CATS[i % 4];
    return { id: `I${pad(i + 1, 3)}`, cat, pop: Math.exp(0.5 * gauss()), price: 100 * (8 + int(40)), launch: i === 9 ? 205 : i === 14 ? 338 : 0, raise: r() < 0.4 ? 150 + int(300) : -1 };
  });
  const DOW = { A: [0.55, 1.15, 1.2, 1.2, 1.18, 1.1, 0.62], B: [1.3, 0.9, 0.88, 0.9, 0.92, 1.05, 1.28], C: [0.85, 0.95, 0.95, 0.97, 1.02, 1.3, 1.22] }; // Sun..Sat
  const HOL = { A: 0.5, B: 1.25, C: 0.9 }, RAIN = { A: 0.01, B: 0.02, C: 0.004 };
  const PROMO = { 음료: 0.035, 간편식: 0.025, 아이스크림: 0.05, 생활용품: 0.06 }, ELAST = { 음료: 1.2, 간편식: 0.8, 아이스크림: 1.5, 생활용품: 2.0 };
  const SHIFT = { S03: [396, 0.78], S06: [396, 0.78], S05: [450, 1.2] };
  const total = TRAIN_DAYS + FUTURE_DAYS;
  // Weather: one city, shared by every store.
  const temp = [], rain = []; let ar = 0;
  for (let d = 0; d < total; d++) {
    ar = 0.7 * ar + 2.2 * gauss();
    temp.push(Math.round((13.5 + 12.5 * Math.sin((2 * Math.PI * ((d % 365) - 110)) / 365) + ar) * 10) / 10);
    rain.push(r() < 0.28 ? Math.round(-Math.log(1 - r()) * 80) / 10 : 0);
  }
  // Promotions run per item and week, in every store.
  const promo = items.map(() => Array.from({ length: Math.ceil(total / 7) + 1 }, () => (r() < 0.12 ? pick([10, 20, 30, 50]) : 0)));
  const train = [], held = [], future = [];
  for (let d = 0; d < total; d++) {
    const date = dateOf(d), dow = new Date(day0 + d * 86400000).getUTCDay(), dom = Number(date.slice(8)), hol = HOLIDAYS.has(date) ? 1 : 0, wk = Math.floor(d / 7);
    for (const s of stores) {
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        if (d < it.launch) continue;
        const pct = promo[k][wk], prev = wk > 0 ? promo[k][wk - 1] : 0;
        const basePrice = it.raise >= 0 && d >= it.raise ? Math.round((it.price * 1.08) / 10) * 10 : it.price;
        const price = Math.round((basePrice * (1 - pct / 100)) / 10) * 10;
        const T = temp[d] - 15;
        let mu = 22 * s.base * it.pop * DOW[s.type][dow];
        if (it.cat === '음료') mu *= Math.exp(0.025 * T) * (temp[d] > 30 ? 1.25 : 1);
        if (it.cat === '아이스크림') mu *= Math.exp(0.07 * Math.max(-12, T));
        if (it.cat === '간편식') mu *= Math.exp(-0.012 * T) * (1 + 0.08 * Math.cos((2 * Math.PI * (d % 365)) / 365));
        mu *= Math.exp(-RAIN[s.type] * rain[d]);
        mu *= 1 + PROMO[it.cat] * pct;
        if (it.cat === '생활용품' && pct === 0 && prev > 0) mu *= 0.8; // stock-up pulls demand forward
        mu *= Math.pow(basePrice / it.price, -ELAST[it.cat]);
        if (hol) mu *= HOL[s.type];
        if (s.type === 'B' && dom >= 25 && dom <= 27) mu *= 1.12;
        mu *= Math.pow(1 + s.growth, d / 365);
        if (SHIFT[s.id] && d >= SHIFT[s.id][0]) mu *= SHIFT[s.id][1];
        if (it.launch) mu *= Math.min(1, 0.3 + (0.7 * (d - it.launch)) / 60);
        const units = Math.max(0, Math.round(mu * Math.exp(0.22 * gauss())));
        const row = { date, store: s.id, store_type: s.type, item: it.id, category: it.cat, price, promo_pct: pct, holiday: hol, temp_c: temp[d], rain_mm: rain[d] };
        const u = r(), e = r();
        if (d >= TRAIN_DAYS) future.push({ row, units, mu });
        else if (u < 0.1) held.push({ row, units, mu });
        else train.push({ ...row, units: e < 0.004 ? units * 10 : e < 0.01 ? 0 : units }); // a few recording errors
      }
    }
  }
  return { train, held, future };
}
export const salesCsv = (rows) => [...SALES_COLUMNS, 'units'].join(',') + '\n' + rows.map((x) => [...SALES_COLUMNS, 'units'].map((c) => x[c]).join(',')).join('\n') + '\n';
// Mean absolute log error; the metric of the forecasting task.
export const male = (pred, actual) => { let s = 0; for (let i = 0; i < actual.length; i++) s += Math.abs(Math.log1p(pred[i]) - Math.log1p(actual[i])); return actual.length ? s / actual.length : 0; };

// ---------- 3. order memos ----------
const HD = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const hangul4 = (n) => { let s = ''; [Math.floor(n / 1000), Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10].forEach((x, i) => { if (x) s += (x === 1 && i < 3 ? '' : HD[x]) + ['천', '백', '십', ''][i]; }); return s; };
const hangulWon = (T) => { const man = Math.floor(T / 10000), rest = T % 10000; return (man ? (man === 1 ? '' : hangul4(man)) + '만' : '') + (rest ? hangul4(rest) : '') + '원'; };
const manForm = (T) => { const man = Math.floor(T / 10000), ch = Math.floor((T % 10000) / 1000), b = Math.floor((T % 1000) / 100); return (man ? man + '만' : '') + (ch ? ch + '천' : '') + (b ? b + '백' : '') + '원'; };
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const QTY_WORD = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const NAMES = ['김가람', '이서준', '박하늘', '최다온', '정유나', '한지호', '윤소라', '오태양', '강민서', '신라온'];
const NOTES = ['재주문', '문 앞에 놔주세요', '101동 1203호', '3층 사무실', '오후 2시 이후 연락', '지난번과 동일', '세금계산서 발행', '부재 시 경비실', '포장 꼼꼼히', '2차 주문', '신규 거래처', '7월 행사용', '박스 훼손 주의', '영수증 동봉'];

export function genMemos(seed, count) {
  const { r, int, pick, weighted } = rng(seed);
  const out = [];
  const dateText = (mo, d) => {
    const mm = pad(mo), dd = pad(d);
    return weighted([[`2026-${mm}-${dd}`, 22], [`2026.${mo}.${d}`, 14], [`26/${mm}/${dd}`, 8], [`${mo}월 ${d}일`, 20], [`${mo}/${d}`, 16], [`2026${mm}${dd}`, 6], [`${mo}월${d}일(${WEEK[new Date(Date.UTC(2026, mo - 1, d)).getUTCDay()]})`, 8], [`${mm}.${dd}`, 3], [`'26.${mo}.${d}`, 3]]);
  };
  const phoneText = (a, b) => weighted([[`010-${a}-${b}`, 40], [`010${a}${b}`, 18], [`010 ${a} ${b}`, 10], [`010.${a}.${b}`, 10], [`+82 10-${a}-${b}`, 8], [`+8210${a}${b}`, 3], [`010-${a}${b}`, 3]]);
  const amountText = (T) => {
    const forms = [[`${comma(T)}원`, 34], [`${T}원`, 12], [manForm(T), 16], [`₩${comma(T)}`, 7], [hangulWon(T), 4], [`KRW ${T}`, 3]];
    if (T % 1000 === 0 && T >= 10000) forms.push([`${T / 10000}만원`, 8]);
    if (T % 1000 === 0 && T < 1000000) forms.push([`${T / 1000}천원`, 3]);
    return weighted(forms);
  };
  for (let n = 0; n < count; n++) {
    const mo = 1 + int(6), d = 1 + int(28);
    const pa = pad(int(10000), 4), pb = pad(int(10000), 4);
    const letter = 'ABCDEFGH'[int(8)], code = pad(int(10000), 4);
    const unit = 500 * (2 + int(95)); // 1,000 .. 48,000
    const qStyle = weighted([['plain', 58], ['box', 12], ['bundle', 7], ['word', 12], ['mixed', 5], ['composite', 12]]);
    let qty = 1 + int(40), qtyText = null;
    if (qStyle === 'box') { const b = 1 + int(5); qty = b * 12; qtyText = pick([`${b}박스`, `${b} 박스`, `${b}BOX`]); }
    else if (qStyle === 'bundle') { const b = 1 + int(6); qty = b * 6; qtyText = `${b}묶음`; }
    else if (qStyle === 'word') { qty = 1 + int(10); qtyText = pick([`${QTY_WORD[qty]} 개`, `${QTY_WORD[qty]}개`]); }
    else if (qStyle === 'mixed') { const b = 1 + int(3), l = 1 + int(11); qty = b * 12 + l; qtyText = `${b}박스 ${l}개`; }
    else if (qStyle === 'plain') qtyText = weighted([[`${qty}개`, 40], [`${qty}EA`, 10], [`${qty} ea`, 6], [`x${qty}`, 10], [`수량 ${qty}`, 14], [`수량:${qty}`, 8], [`${qty} pcs`, 3]]);
    const total = unit * qty;
    let amount = total, amtText;
    if (qStyle === 'composite') amtText = pick([`단가 ${comma(unit)}원 x ${qty}`, `${comma(unit)}원 × ${qty}개`, `@${comma(unit)} x${qty}`, `개당 ${manForm(unit)} ${qty}개`]);
    else {
      const label = pick(['', '', '', '총 ', '합계 ', '금액: ', '금액 ']);
      const mod = weighted([['none', 78], ['minus', 6], ['pct', 4], ['vat', 7], ['vatin', 5]]);
      amtText = label + amountText(total);
      if (mod === 'minus') { const D = pick([1000, 2000, 3000, 5000].filter((x) => x < total)) ?? 500; amount = total - D; amtText += pick([`에서 ${comma(D)}원 할인`, ` (쿠폰 -${comma(D)}원)`, ` - 할인 ${comma(D)}원`]); }
      else if (mod === 'pct') { const p = pick([10, 20]); amount = Math.round((total * (100 - p)) / 100); amtText += pick([` ${p}% 할인`, ` (${p}% DC)`]); }
      else if (mod === 'vat') { amount = Math.round(total * 1.1); amtText += pick(['(VAT별도)', ' 부가세 별도', ' +VAT']); }
      else if (mod === 'vatin') amtText += pick(['(VAT포함)', ' 부가세 포함']);
    }
    const pay = pick(['card', 'cash', 'transfer']);
    const payText = pick(['', '', '결제 ', '결제: ']) + pick({ card: ['카드', '신용카드', '법카', '카드결제', '체크카드'], cash: ['현금', '현금결제', '현찰'], transfer: ['계좌이체', '이체', '무통장', '무통장입금', '송금'] }[pay]);
    const rushRoll = r(); const rush = rushRoll < 0.18;
    const rushText = rush ? pick(['[급]', '★긴급', '당일출고 요망', '퀵으로 보내주세요', '급함', '긴급건']) : rushRoll > 0.97 ? pick(['급하지 않음', '긴급 아님']) : null;
    const other = r() < 0.35;
    const parts = [];
    parts.push((other ? pick(['주문일 ', '주문 ', '접수 ', '접수일: ', '']) : pick(['', '', '주문일 ', '접수 '])) + dateText(mo, d));
    if (other) { const dv = new Date(Date.UTC(2026, mo - 1, d + 1 + int(6))); parts.push(pick(['배송 ', '납기 ', '희망일 ', '배송일: ', '도착희망 ']) + dateText(dv.getUTCMonth() + 1, dv.getUTCDate())); }
    parts.push(pick(['', '', '연락처 ', '연락처: ', 'H.P ', '☎ ', 'tel. ']) + phoneText(pa, pb));
    if (r() < 0.2) parts.push(pick([`기사 010-${pad(int(10000), 4)}-${pad(int(10000), 4)}`, `담당 박주임 010-${pad(int(10000), 4)}-${pad(int(10000), 4)}`, `배송기사: 010${pad(int(10000), 4)}${pad(int(10000), 4)}`, `매장 02-${pad(int(1000), 3)}-${pad(int(10000), 4)}`]));
    parts.push(weighted([[`${letter}-${code}`, 34], [`${letter.toLowerCase()}-${code}`, 8], [`${letter}${code}`, 20], [`${letter} ${code}`, 6], [`품번 ${letter}${code}`, 14], [`[${letter}-${code}]`, 10], [`${letter.toLowerCase()}${code}`, 8]]));
    if (qtyText) parts.push(qtyText);
    parts.push(amtText);
    parts.push(payText);
    if (rushText) parts.push(rushText);
    if (r() < 0.55) parts.push(`${pick(NAMES)} ${pick(['고객', '님', '사장님'])}`);
    const notes = int(3); for (let i = 0; i < notes; i++) parts.push(pick(NOTES));
    if (r() < 0.03) parts.push(pick(['사은품 1개 동봉', '샘플 2개 포함', '사은품 3개']));
    // Order: the order date leads most of the time; everything else is shuffled.
    const head = r() < 0.6 ? parts.shift() : null;
    for (let i = parts.length - 1; i > 0; i--) { const j = int(i + 1); [parts[i], parts[j]] = [parts[j], parts[i]]; }
    if (head) parts.unshift(head);
    const sep = weighted([[' / ', 30], [', ', 22], [' | ', 14], ['  ', 14], ['\n', 14], [' · ', 6]]);
    out.push({ text: parts.join(sep), expected: { date: `2026-${pad(mo)}-${pad(d)}`, phone: `010-${pa}-${pb}`, item: `${letter}-${code}`, qty, amount, pay, rush } });
  }
  return out;
}
export const MEMO_FIELDS = ['date', 'phone', 'item', 'qty', 'amount', 'pay', 'rush'];
