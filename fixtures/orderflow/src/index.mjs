// Public entry points.
import { createState, applyEvent } from './orders.mjs';
import { buildSummary } from './report.mjs';
import { priceOrder } from './pricing.mjs';

// Runs a list of events through a fresh engine and returns the final summary.
export function processEvents(events) {
  const state = createState();
  events.forEach((event, index) => applyEvent(state, event, index));
  return buildSummary(state);
}

// Prices a basket without creating an order. The PCT10 coupon is treated as still unused.
export function quote(items, coupon, region) {
  const p = priceOrder(items, coupon, region, true);
  return { subtotal: p.subtotal, couponDiscount: p.couponDiscount, couponApplied: p.couponApplied, merchandise: p.merchandise, shipping: p.shipping, tax: p.tax, total: p.total };
}
