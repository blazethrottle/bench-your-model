// Builds the summary that processEvents returns.
import { CATEGORIES } from './catalog.mjs';

export const TOP_CUSTOMERS = 3;

export function buildSummary(state) {
  const orders = state.sequence.map((id) => {
    const o = state.orders.get(id);
    return { id: o.id, customer: o.customer, status: o.status, total: o.total, refunded: o.refunded, eta: o.eta, couponApplied: o.couponApplied };
  });

  const inventory = {};
  for (const sku of Object.keys(state.inventory).sort()) inventory[sku] = { onHand: state.inventory[sku].onHand, reserved: state.inventory[sku].reserved };

  const revenueByCategory = {};
  for (const category of CATEGORIES) revenueByCategory[category] = state.categoryRevenue[category] || 0;

  // Net spend per customer: what they paid minus what they got back.
  const spend = new Map();
  for (const id of state.sequence) {
    const o = state.orders.get(id);
    spend.set(o.customer, (spend.get(o.customer) || 0) + o.paid - o.refunded);
  }
  const topCustomers = [...spend.entries()]
    .filter(([, net]) => net > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, TOP_CUSTOMERS)
    .map(([customer, net]) => ({ customer, net }));

  return { orders, inventory, ledger: { ...state.ledger }, revenueByCategory, topCustomers, rejected: state.rejected.map((r) => ({ ...r })) };
}
