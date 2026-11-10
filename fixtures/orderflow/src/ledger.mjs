// Running account balances.
export function createLedger() {
  return { cash: 0, revenue: 0, shipping: 0, tax: 0, refunds: 0 };
}

export function postPayment(ledger, order) {
  ledger.cash += order.total;
  ledger.revenue += order.merchandise;
  ledger.shipping += order.shipping;
  ledger.tax += order.tax;
}

// Full refund of a paid order that never shipped: everything is reversed, shipping included.
export function postFullRefund(ledger, order) {
  ledger.cash -= order.total;
  ledger.revenue -= order.merchandise;
  ledger.shipping -= order.shipping;
  ledger.tax -= order.tax;
  ledger.refunds += order.total;
}

// Refund for returned goods: merchandise and its tax only. Shipping is never refunded on a return.
export function postReturnRefund(ledger, netAmount, taxAmount) {
  ledger.cash -= netAmount + taxAmount;
  ledger.revenue -= netAmount;
  ledger.tax -= taxAmount;
  ledger.refunds += netAmount + taxAmount;
}
