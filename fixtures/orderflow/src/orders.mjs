// Order life cycle: applies one event at a time to the engine state.
import { getProduct } from './catalog.mjs';
import { toDay, fromDay, addBusinessDays } from './dates.mjs';
import { priceOrder, mergeItems } from './pricing.mjs';
import { createInventory, reserve, release, commit, addStock } from './inventory.mjs';
import { createLedger, postPayment, postFullRefund, postReturnRefund } from './ledger.mjs';

export const RETURN_WINDOW_DAYS = 14;
const ETA_DAYS = { SEOUL: 1, JEJU: 4 };
const DEFAULT_ETA_DAYS = 2;
const KNOWN_TYPES = ['stock', 'order', 'pay', 'ship', 'deliver', 'cancel', 'return'];

export function createState() {
  return { orders: new Map(), sequence: [], inventory: createInventory(), ledger: createLedger(), pct10Used: new Set(), categoryRevenue: {}, rejected: [] };
}

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

// Returns a reason code, or null when the item list is acceptable.
function checkItems(items, knownSku) {
  if (!Array.isArray(items) || items.length === 0) return 'EMPTY_ORDER';
  if (items.some((item) => !item || !isPositiveInt(item.qty))) return 'BAD_QTY';
  if (items.some((item) => !knownSku(item.sku))) return 'UNKNOWN_SKU';
  return null;
}

function addCategoryRevenue(state, category, amount) {
  state.categoryRevenue[category] = (state.categoryRevenue[category] || 0) + amount;
}

// Waiting orders get another chance, oldest first. One that still cannot be filled does not block later ones.
function retryBackorders(state) {
  for (const id of state.sequence) {
    const order = state.orders.get(id);
    if (order.status !== 'backorder') continue;
    if (reserve(state.inventory, order.lines)) order.status = 'reserved';
  }
}

function handleStock(state, event) {
  if (!getProduct(event.sku)) return 'UNKNOWN_SKU';
  if (!isPositiveInt(event.qty)) return 'BAD_QTY';
  addStock(state.inventory, event.sku, event.qty);
  retryBackorders(state);
  return null;
}

function handleOrder(state, event) {
  if (state.orders.has(event.id)) return 'DUP_ORDER';
  const problem = checkItems(event.items, (sku) => !!getProduct(sku));
  if (problem) return problem;
  const usable = !state.pct10Used.has(event.customer);
  const priced = priceOrder(event.items, event.coupon, event.region, usable);
  if (priced.couponApplied === 'PCT10') state.pct10Used.add(event.customer);
  const order = {
    id: event.id, customer: event.customer, region: event.region, status: 'backorder',
    lines: priced.lines.map((line) => ({ ...line, returned: 0 })),
    couponApplied: priced.couponApplied, merchandise: priced.merchandise, shipping: priced.shipping, tax: priced.tax, total: priced.total,
    paid: 0, refunded: 0, refundedNet: 0, refundedTax: 0, eta: null, deliveredDay: null,
  };
  if (reserve(state.inventory, order.lines)) order.status = 'reserved';
  state.orders.set(order.id, order);
  state.sequence.push(order.id);
  return null;
}

function handlePay(state, event, order) {
  if (order.status !== 'reserved') return 'BAD_STATE';
  if (event.amount !== order.total) return 'BAD_AMOUNT';
  order.status = 'paid';
  order.paid = order.total;
  postPayment(state.ledger, order);
  for (const line of order.lines) addCategoryRevenue(state, line.category, line.net);
  return null;
}

function handleShip(state, event, order, day) {
  if (order.status !== 'paid') return 'BAD_STATE';
  order.status = 'shipped';
  commit(state.inventory, order.lines);
  const days = Object.prototype.hasOwnProperty.call(ETA_DAYS, order.region) ? ETA_DAYS[order.region] : DEFAULT_ETA_DAYS;
  order.eta = fromDay(addBusinessDays(day, days));
  return null;
}

function handleDeliver(state, event, order, day) {
  if (order.status !== 'shipped') return 'BAD_STATE';
  order.status = 'delivered';
  order.deliveredDay = day;
  return null;
}

function handleCancel(state, event, order) {
  if (order.status === 'backorder') { order.status = 'cancelled'; return null; }
  if (order.status === 'reserved') { release(state.inventory, order.lines); order.status = 'cancelled'; retryBackorders(state); return null; }
  if (order.status === 'paid') {
    release(state.inventory, order.lines);
    postFullRefund(state.ledger, order);
    for (const line of order.lines) addCategoryRevenue(state, line.category, -line.net);
    order.refunded = order.total;
    order.status = 'cancelled';
    retryBackorders(state);
    return null;
  }
  return 'BAD_STATE';
}

function handleReturn(state, event, order, day) {
  if (order.status !== 'delivered') return 'BAD_STATE';
  if (day - order.deliveredDay > RETURN_WINDOW_DAYS) return 'RETURN_WINDOW';
  const problem = checkItems(event.items, (sku) => order.lines.some((line) => line.sku === sku));
  if (problem) return problem;
  const wanted = mergeItems(event.items);
  for (const item of wanted) {
    const line = order.lines.find((l) => l.sku === item.sku);
    if (line.returned + item.qty > line.qty) return 'RETURN_QTY';
  }
  // Amounts are worked out on running totals so that returning a line in pieces refunds exactly the same as returning it at once.
  let netNow = 0;
  for (const item of wanted) {
    const line = order.lines.find((l) => l.sku === item.sku);
    const before = Math.floor((line.net * line.returned) / line.qty);
    line.returned += item.qty;
    const after = Math.floor((line.net * line.returned) / line.qty);
    netNow += after - before;
    addCategoryRevenue(state, line.category, -(after - before));
    addStock(state.inventory, line.sku, item.qty);
  }
  const taxableReturned = order.lines.reduce((sum, line) => sum + (line.taxable ? Math.floor((line.net * line.returned) / line.qty) : 0), 0);
  const taxTotal = Math.min(order.tax, Math.floor((taxableReturned * 10 + 50) / 100));
  const taxNow = taxTotal - order.refundedTax;
  order.refundedTax = taxTotal;
  order.refundedNet += netNow;
  order.refunded += netNow + taxNow;
  postReturnRefund(state.ledger, netNow, taxNow);
  if (order.lines.every((line) => line.returned === line.qty)) order.status = 'returned';
  retryBackorders(state);
  return null;
}

// Applies one event. A rejected event changes nothing and is recorded with its position and reason.
export function applyEvent(state, event, index) {
  const reject = (reason) => { state.rejected.push({ index, reason }); };
  if (!event || !KNOWN_TYPES.includes(event.type)) return reject('UNKNOWN_EVENT');
  const day = toDay(event.date);
  if (day === null) return reject('BAD_DATE');
  let reason;
  if (event.type === 'stock') reason = handleStock(state, event);
  else if (event.type === 'order') reason = handleOrder(state, event);
  else {
    const order = state.orders.get(event.id);
    if (!order) return reject('NO_ORDER');
    if (event.type === 'pay') reason = handlePay(state, event, order);
    else if (event.type === 'ship') reason = handleShip(state, event, order, day);
    else if (event.type === 'deliver') reason = handleDeliver(state, event, order, day);
    else if (event.type === 'cancel') reason = handleCancel(state, event, order);
    else reason = handleReturn(state, event, order, day);
  }
  if (reason) reject(reason);
}
