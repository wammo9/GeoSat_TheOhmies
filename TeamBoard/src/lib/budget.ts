import type { Order, OrderDraft } from '../types';
import { parseLink } from './links';

// ------------------------------------------------------------------ money & status

export const orderTotal = (o: Pick<Order, 'quantity' | 'unit_price'>) => Math.round(o.quantity * o.unit_price * 100) / 100;

export const formatMoney = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export type OrderStatus = 'planned' | 'ordered' | 'received';

/** Not ordered yet -> ordered (on its way) -> received. */
export const orderStatus = (o: Pick<Order, 'date_ordered' | 'date_received'>): OrderStatus =>
  o.date_received ? 'received' : o.date_ordered ? 'ordered' : 'planned';

export const STATUS_LABEL: Record<OrderStatus, string> = { planned: 'Not ordered yet', ordered: 'Ordered — on its way', received: 'Received' };

/** Needed by a date that has passed, but it hasn't arrived. */
export const isLate = (o: Pick<Order, 'date_needed' | 'date_ordered' | 'date_received'>, today: string) =>
  orderStatus(o) !== 'received' && !!o.date_needed && o.date_needed < today;

export function summarize(orders: Order[], today: string) {
  const sum = (list: Order[]) => Math.round(list.reduce((s, o) => s + orderTotal(o), 0) * 100) / 100;
  const by = (s: OrderStatus) => orders.filter((o) => orderStatus(o) === s);
  return {
    count: orders.length,
    all: sum(orders),
    spent: sum(orders.filter((o) => orderStatus(o) !== 'planned')), // ordered or received
    received: sum(by('received')),
    onTheWay: sum(by('ordered')),
    planned: sum(by('planned')),
    late: orders.filter((o) => isLate(o, today)).length,
  };
}

// ------------------------------------------------------------------ validation

export type OrderErrors = Partial<Record<keyof OrderDraft, string>>;

export function validateOrder(d: OrderDraft): OrderErrors {
  const e: OrderErrors = {};
  if (!d.item.trim()) e.item = 'The item name is required.';
  if (!Number.isInteger(d.quantity) || d.quantity < 1) e.quantity = 'Quantity must be a whole number, 1 or more.';
  if (!(d.unit_price >= 0) || !Number.isFinite(d.unit_price)) e.unit_price = 'Price must be $0 or more.';
  if (d.date_received && !d.date_ordered) e.date_received = 'Add the date it was ordered first.';
  if (d.date_received && d.date_ordered && d.date_received < d.date_ordered) e.date_received = 'It can’t arrive before it was ordered.';
  if (d.product_link && 'error' in parseLink(d.product_link)) e.product_link = 'That doesn’t look like a web link.';
  return e;
}

// ------------------------------------------------------------------ parsing pasted spreadsheet rows

/** $1,234.50 or 12 -> number; null when empty; NaN when it isn't a number. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '');
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** 9/22/2026, 09/22/26 or 2026-09-22 -> 2026-09-22; null when empty; 'invalid' otherwise. */
export function parseDate(s: string): string | null | 'invalid' {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t))) { m = +x[1]; d = +x[2]; y = x[3].length === 2 ? 2000 + +x[3] : +x[3]; }
  else return 'invalid';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalid';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Tab-separated text (what Google Sheets / Excel copy) -> rows of cells. Handles "quoted" cells. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const t = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

type Field = keyof OrderDraft | 'total';
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HEADERS: Record<string, Field> = {
  item: 'item', 'desc use': 'description', description: 'description', desc: 'description', use: 'description',
  quantity: 'quantity', qty: 'quantity', price: 'unit_price', 'unit price': 'unit_price', total: 'total',
  fidelity: 'fidelity', supplier: 'supplier', 'date needed': 'date_needed', 'date ordered': 'date_ordered',
  wufoo: 'wufoo_no', 'wufoo no': 'wufoo_no', 'date received': 'date_received', notes: 'notes', 'product link': 'product_link', link: 'product_link',
};
// column order of the team's budget sheet, used when the pasted text has no header row
const DEFAULT_ORDER: Field[] = ['item', 'description', 'quantity', 'unit_price', 'total', 'fidelity', 'supplier', 'date_needed', 'date_ordered', 'wufoo_no', 'date_received', 'notes', 'product_link'];

export interface ImportResult {
  rows: OrderDraft[];
  errors: { line: number; message: string }[];
  duplicates: number;
}

const dupKey = (o: Pick<OrderDraft, 'item' | 'date_ordered' | 'quantity'>) => `${o.item.trim().toLowerCase()}|${o.date_ordered ?? ''}|${o.quantity}`;

export function ordersFromTsv(text: string, existing: Pick<Order, 'item' | 'date_ordered' | 'quantity'>[] = []): ImportResult {
  const cells = parseTsv(text);
  const out: ImportResult = { rows: [], errors: [], duplicates: 0 };
  if (cells.length === 0) return out;
  const first = cells[0].map((c) => HEADERS[norm(c)]);
  const hasHeader = first.filter(Boolean).length >= 3 && first.includes('item');
  const cols: (Field | undefined)[] = hasHeader ? first : DEFAULT_ORDER;
  const seen = new Set(existing.map(dupKey));
  cells.slice(hasHeader ? 1 : 0).forEach((r, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    const get = (f: Field) => { const i = cols.indexOf(f); return i >= 0 ? (r[i] ?? '').trim() : ''; };
    const fail = (message: string) => { out.errors.push({ line, message }); };
    const item = get('item');
    if (!item) return fail('No item name.');
    const qtyRaw = get('quantity');
    const quantity = qtyRaw ? Number(qtyRaw.replace(/,/g, '')) : 1;
    if (!Number.isInteger(quantity) || quantity < 1) return fail(`“${item}”: quantity “${qtyRaw}” isn’t a whole number.`);
    let price = parseMoney(get('unit_price'));
    if (price !== null && Number.isNaN(price)) return fail(`“${item}”: price “${get('unit_price')}” isn’t a number.`);
    if (price === null) {
      const total = parseMoney(get('total'));
      price = total !== null && !Number.isNaN(total) ? Math.round((total / quantity) * 100) / 100 : 0;
    }
    const dates: Partial<Record<'date_needed' | 'date_ordered' | 'date_received', string | null>> = {};
    for (const f of ['date_needed', 'date_ordered', 'date_received'] as const) {
      const d = parseDate(get(f));
      if (d === 'invalid') return fail(`“${item}”: “${get(f)}” isn’t a date I understand (use M/D/YYYY).`);
      dates[f] = d;
    }
    let link: string | null = null;
    if (get('product_link')) {
      const p = parseLink(get('product_link'));
      if ('error' in p) return fail(`“${item}”: the product link isn’t a valid web address.`);
      link = p.url;
    }
    const draft: OrderDraft = {
      item, description: get('description') || null, quantity, unit_price: price, fidelity: get('fidelity') || null,
      supplier: get('supplier') || null, date_needed: dates.date_needed ?? null, date_ordered: dates.date_ordered ?? null,
      wufoo_no: get('wufoo_no') || null, date_received: dates.date_received ?? null, notes: get('notes') || null, product_link: link,
    };
    const problem = Object.values(validateOrder(draft))[0];
    if (problem) return fail(`“${item}”: ${problem}`);
    if (seen.has(dupKey(draft))) { out.duplicates++; return; }
    seen.add(dupKey(draft));
    out.rows.push(draft);
  });
  return out;
}

// ------------------------------------------------------------------ CSV export

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function ordersToCsv(orders: Order[]): string {
  const head = ['Item', 'Desc/Use', 'Quantity', 'Price ($)', 'Total ($)', 'Fidelity', 'Supplier', 'Date Needed', 'Date Ordered', 'WUFOO #', 'Date Received', 'Notes', 'Product Link'];
  const lines = orders.map((o) => [o.item, o.description, o.quantity, o.unit_price, orderTotal(o), o.fidelity, o.supplier, o.date_needed, o.date_ordered, o.wufoo_no, o.date_received, o.notes, o.product_link].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}
