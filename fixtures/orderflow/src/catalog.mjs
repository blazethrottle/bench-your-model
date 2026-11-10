// Product catalog. Prices are integer won, weights are grams.
export const CATALOG = {
  'TEA-01': { name: '녹차 티백', price: 4500, category: 'food', weight: 120, taxable: true },
  'MUG-02': { name: '머그컵', price: 12000, category: 'living', weight: 380, taxable: true },
  'BOOK-03': { name: '레시피 책', price: 18000, category: 'book', weight: 650, taxable: false },
  'RICE-04': { name: '쌀 10kg', price: 32000, category: 'food', weight: 10000, taxable: false },
  'PAN-05': { name: '프라이팬', price: 27500, category: 'living', weight: 1400, taxable: true },
  'PEN-06': { name: '볼펜', price: 900, category: 'office', weight: 15, taxable: true },
};

export const CATEGORIES = ['book', 'food', 'living', 'office'];

export function getProduct(sku) {
  return Object.prototype.hasOwnProperty.call(CATALOG, sku) ? CATALOG[sku] : null;
}
