// Prices one order. All amounts are integer won.
import { getProduct } from './catalog.mjs';

export const PCT10_CAP = 20000;
export const FIX5000_MIN = 30000;
export const FREE_SHIPPING_MIN = 50000;
export const JEJU_SURCHARGE = 3000;

// Same SKU listed twice counts as one line with the quantities added, kept at its first position.
export function mergeItems(items) {
  const merged = [];
  const index = new Map();
  for (const item of items) {
    if (index.has(item.sku)) merged[index.get(item.sku)].qty += item.qty;
    else { index.set(item.sku, merged.length); merged.push({ sku: item.sku, qty: item.qty }); }
  }
  return merged;
}

function tierRate(qty) {
  if (qty >= 50) return 10;
  if (qty >= 10) return 5;
  return 0;
}

function shippingBase(weight) {
  if (weight <= 2000) return 3000;
  if (weight <= 10000) return 5000;
  return 5000 + 1000 * Math.ceil((weight - 10000) / 5000);
}

export function priceOrder(items, coupon, region, pct10Usable) {
  const lines = mergeItems(items).map((item) => {
    const product = getProduct(item.sku);
    const gross = product.price * item.qty;
    const tierDiscount = Math.floor((gross * tierRate(item.qty)) / 100);
    return { sku: item.sku, qty: item.qty, category: product.category, taxable: product.taxable, gross, tierDiscount, couponShare: 0, net: gross - tierDiscount, weight: product.weight * item.qty };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.net, 0);

  let couponDiscount = 0;
  let couponApplied = null;
  if (coupon === 'PCT10' && pct10Usable) {
    couponDiscount = Math.min(Math.floor((subtotal * 10) / 100), PCT10_CAP);
    couponApplied = 'PCT10';
  } else if (coupon === 'FIX5000' && subtotal >= FIX5000_MIN) {
    couponDiscount = 5000;
    couponApplied = 'FIX5000';
  } else if (coupon === 'FREESHIP') {
    couponApplied = 'FREESHIP';
  }

  // Spread the coupon discount over the lines in proportion to their amounts; the last line takes the remainder.
  let allocated = 0;
  lines.forEach((line, i) => {
    const share = i === lines.length - 1 ? couponDiscount - allocated : Math.floor((couponDiscount * line.net) / subtotal);
    allocated += share;
    line.couponShare = share;
    line.net -= share;
  });

  const merchandise = subtotal - couponDiscount;
  const weight = lines.reduce((sum, line) => sum + line.weight, 0);
  const freeShipping = merchandise >= FREE_SHIPPING_MIN || couponApplied === 'FREESHIP';
  const shipping = (freeShipping ? 0 : shippingBase(weight)) + (region === 'JEJU' ? JEJU_SURCHARGE : 0);

  const taxableBase = lines.reduce((sum, line) => sum + (line.taxable ? line.net : 0), 0);
  const tax = Math.floor((taxableBase * 10 + 50) / 100);

  return { lines, subtotal, couponDiscount, couponApplied, merchandise, weight, shipping, tax, total: merchandise + shipping + tax };
}
