import {createHash} from 'node:crypto';
export class AppError extends Error {constructor(status, message) {super(message); this.status = status;}}
export function check(condition, message, status = 400) {if (!condition) throw new AppError(status, message);}
export function text(value, name, max = 100, required = false) {
  check(typeof value === 'string', `${name} must be text`);
  const result = value.trim();
  check(result.length <= max && (!required || result.length > 0), `${name} is required or too long`);
  return result;
}
export function int(value, name, min = 0, max = 1000000) {
  check(Number.isSafeInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function cents(value, name) {
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000000, `${name} is invalid`);
  check(Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, `${name} supports two decimal places`);
  return Math.round(value * 100);
}
export function key(value) {check(typeof value === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(value), 'Invalid request key'); return value;}
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function cartInput(body) {
  check(body && Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 100, 'Add 1 to 100 items');
  const merged = new Map();
  for (const row of body.items) {
    check(row && typeof row.productId === 'string' && /^[a-f0-9]{24}$/i.test(row.productId), 'Invalid product ID');
    const id = row.productId.toLowerCase();
    merged.set(id, int((merged.get(id) || 0) + int(row.qty, 'Quantity', 1, 9999), 'Combined quantity', 1, 9999));
  }
  const payment = text(body.payment || 'Cash', 'Payment');
  check(['Cash', 'UPI', 'Card', 'Other'].includes(payment), 'Invalid payment method');
  return {
    items: [...merged].sort(([a],[b]) => a.localeCompare(b)).map(([productId,qty]) => ({productId,qty})),
    customer: text(body.customer ?? '', 'Customer', 100), mobile: text(body.mobile ?? '', 'Mobile', 20),
    payment, discountCents: cents(body.discount ?? 0, 'Discount'), receivedCents: cents(body.received ?? 0, 'Received')
  };
}
// All money is stored in integer paise. Prices are GST-inclusive when a product has a GST rate.
export function totals(lines, discountCents, receivedCents) {
  const grossCents = lines.reduce((sum, row) => sum + row.priceCents * row.qty, 0);
  check(discountCents <= grossCents, 'Discount cannot exceed subtotal');
  const shares = lines.map((row, index) => {
    const exact = grossCents ? discountCents * row.priceCents * row.qty / grossCents : 0;
    return {index, floor: Math.floor(exact), fraction: exact - Math.floor(exact)};
  });
  let remainder = discountCents - shares.reduce((s,x) => s+x.floor,0);
  for (const x of [...shares].sort((a,b)=>b.fraction-a.fraction)) if (remainder-- > 0) x.floor++;
  const items = lines.map((row, i) => {
    const amountCents = row.priceCents * row.qty, totalCents = amountCents - shares[i].floor;
    const taxCents = Math.round(totalCents * (row.gstBps || 0) / (10000 + (row.gstBps || 0)));
    return {...row, amountCents, discountCents: shares[i].floor, totalCents, taxCents, taxableCents: totalCents-taxCents};
  });
  const totalCents = grossCents - discountCents;
  return {items, grossCents, discountCents, totalCents, taxCents: items.reduce((s,x)=>s+x.taxCents,0), receivedCents,
    dueCents: Math.max(0,totalCents-receivedCents), changeCents: Math.max(0,receivedCents-totalCents), qty: lines.reduce((s,x)=>s+x.qty,0)};
}
export function productInput(body, creating = false) {
  check(body && typeof body === 'object', 'Product required');
  const sku = text(body.sku, 'SKU', 48, true).toUpperCase();
  check(/^[A-Z0-9][A-Z0-9_-]*$/.test(sku), 'SKU allows letters, numbers, hyphen and underscore');
  const p = {sku, name: text(body.name, 'Name', 100, true), size: text(body.size ?? '', 'Size', 30),
    color: text(body.color ?? '', 'Colour', 40), category: text(body.category ?? '', 'Category', 50),
    priceCents: cents(body.price, 'Price'), gstBps: cents(body.gst ?? 0, 'GST'), lowStock: int(body.lowStock ?? 5, 'Low stock threshold')};
  check(p.gstBps <= 10000, 'GST cannot exceed 100%');
  if (creating) p.stock = int(body.stock ?? 0, 'Opening stock');
  return p;
}
