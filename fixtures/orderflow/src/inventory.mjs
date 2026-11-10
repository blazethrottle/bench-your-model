// Stock per SKU: onHand is what is physically there, reserved is the part promised to open orders.
import { CATALOG } from './catalog.mjs';

export function createInventory() {
  const inv = {};
  for (const sku of Object.keys(CATALOG).sort()) inv[sku] = { onHand: 0, reserved: 0 };
  return inv;
}

export function available(inv, sku) {
  return inv[sku].onHand - inv[sku].reserved;
}

// Reserves every line or nothing at all.
export function reserve(inv, lines) {
  for (const line of lines) if (available(inv, line.sku) < line.qty) return false;
  for (const line of lines) inv[line.sku].reserved += line.qty;
  return true;
}

export function release(inv, lines) {
  for (const line of lines) inv[line.sku].reserved -= line.qty;
}

// Goods leave the warehouse: they stop being on hand and stop being reserved.
export function commit(inv, lines) {
  for (const line of lines) {
    inv[line.sku].onHand -= line.qty;
    inv[line.sku].reserved -= line.qty;
  }
}

export function addStock(inv, sku, qty) {
  inv[sku].onHand += qty;
}
