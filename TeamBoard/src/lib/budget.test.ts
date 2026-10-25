import { describe, expect, it } from 'vitest';
import type { Order } from '../types';
import { formatMoney, isLate, orderStatus, orderTotal, ordersFromTsv, ordersToCsv, parseDate, parseMoney, parseTsv, summarize, validateOrder } from './budget';

const order = (o: Partial<Order>): Order => ({
  id: 'o', workspace_id: 'w', item: 'Part', description: null, quantity: 1, unit_price: 0, fidelity: null, supplier: null,
  date_needed: null, date_ordered: null, wufoo_no: null, date_received: null, notes: null, product_link: null, version: 1, updated_by: null, updated_at: '', ...o,
});

describe('money, status and totals', () => {
  it('multiplies quantity by price without float noise', () => {
    expect(orderTotal({ quantity: 10, unit_price: 1.62 })).toBe(16.2);
    expect(orderTotal({ quantity: 3, unit_price: 0.1 })).toBe(0.3);
    expect(formatMoney(1234.5)).toBe('$1,234.50');
  });
  it('derives status from the dates', () => {
    expect(orderStatus({ date_ordered: null, date_received: null })).toBe('planned');
    expect(orderStatus({ date_ordered: '2026-09-22', date_received: null })).toBe('ordered');
    expect(orderStatus({ date_ordered: '2026-09-22', date_received: '2026-09-29' })).toBe('received');
  });
  it('flags only unreceived orders that are past their needed date', () => {
    expect(isLate(order({ date_needed: '2026-10-22', date_ordered: '2026-10-15' }), '2026-10-25')).toBe(true);
    expect(isLate(order({ date_needed: '2026-10-22', date_ordered: '2026-10-15', date_received: '2026-10-21' }), '2026-10-25')).toBe(false);
    expect(isLate(order({ date_needed: '2026-10-27' }), '2026-10-25')).toBe(false);
    expect(isLate(order({}), '2026-10-25')).toBe(false);
  });
  it('summarizes spend by stage', () => {
    const s = summarize([
      order({ quantity: 10, unit_price: 1.62, date_ordered: '2026-09-22', date_received: '2026-09-29' }),
      order({ quantity: 2, unit_price: 9, date_needed: '2026-10-15', date_ordered: '2026-10-13' }),
      order({ quantity: 1, unit_price: 25 }),
    ], '2026-10-25');
    expect(s).toEqual({ count: 3, all: 59.2, spent: 34.2, received: 16.2, onTheWay: 18, planned: 25, late: 1 });
  });
});

describe('parsing', () => {
  it('reads money and dates from a spreadsheet', () => {
    expect(parseMoney('$1,234.50')).toBe(1234.5);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNaN();
    expect(parseDate('9/22/2026')).toBe('2026-09-22');
    expect(parseDate('09/05/26')).toBe('2026-09-05');
    expect(parseDate('2026-10-01')).toBe('2026-10-01');
    expect(parseDate('')).toBeNull();
    expect(parseDate('2/30/2026')).toBe('invalid');
    expect(parseDate('soon')).toBe('invalid');
  });
  it('splits tab-separated text including quoted cells', () => {
    expect(parseTsv('a\tb\n"x\ty"\t"he said ""hi"""\n\n')).toEqual([['a', 'b'], ['x\ty', 'he said "hi"']]);
  });
});

const HEADER = 'Item\tDesc/Use\tQuantity\t Price ($)\tTotal ($)\tFidelity\tSupplier\tDate Needed\tDate Ordered\tWUFOO #\tDate Received\tNotes\tProduct Link';

describe('importing pasted rows', () => {
  it('imports rows using the header, tolerating short rows and a leading-space header', () => {
    const text = [
      HEADER,
      'INA219AIDR\tCurrent Sensor\t10\t1.62\t16.2\tRev 2\tMouser\t10/1/2026\t9/22/2026\t1\t9/29/2026\t\thttps://www.mouser.com/p',
      'RM3100\tMagnetometer\t1\t25\t25\tRev 2+\tPNI Sensor\t10/27/2026\t10/20/2026\t6', // ends early: no received/notes/link
    ].join('\n');
    const r = ordersFromTsv(text);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ item: 'INA219AIDR', quantity: 10, unit_price: 1.62, date_needed: '2026-10-01', date_ordered: '2026-09-22', date_received: '2026-09-29', wufoo_no: '1', product_link: 'https://www.mouser.com/p' });
    expect(r.rows[1]).toMatchObject({ item: 'RM3100', date_received: null, notes: null, product_link: null });
  });
  it("works without a header row, using the sheet's column order", () => {
    const r = ordersFromTsv('Cap\tbulk cap\t4\t$0.50\t$2.00\tRev 2\tDigikey\t\t\t');
    expect(r.rows[0]).toMatchObject({ item: 'Cap', quantity: 4, unit_price: 0.5, supplier: 'Digikey' });
  });
  it('derives the price from the total when the price is blank', () => {
    expect(ordersFromTsv(`${HEADER}\nBoard\t\t4\t\t$10.00\t\t\t\t\t`).rows[0].unit_price).toBe(2.5);
  });
  it('reports bad rows with a line number and still imports the good ones', () => {
    const r = ordersFromTsv([
      HEADER,
      'Good\t\t1\t2\t2\t\t\t\t\t\t\t\t',
      '\t\t1\t2\t2',
      'Bad qty\t\t1.5\t2',
      'Bad date\t\t1\t2\t2\t\t\t\tsoon',
      'Early\t\t1\t2\t2\t\t\t\t\t\t10/1/2026',
    ].join('\n'));
    expect(r.rows.map((x) => x.item)).toEqual(['Good']);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(r.errors[3].message).toMatch(/ordered/i); // received without an order date
  });
  it('skips rows that are already in the budget', () => {
    const text = `${HEADER}\nINA219AIDR\tCurrent Sensor\t10\t1.62\t16.2\tRev 2\tMouser\t10/1/2026\t9/22/2026\t1\t9/29/2026`;
    const r = ordersFromTsv(text, [{ item: 'ina219aidr', quantity: 10, date_ordered: '2026-09-22' }]);
    expect(r.rows).toHaveLength(0);
    expect(r.duplicates).toBe(1);
  });
});

describe('validation and export', () => {
  const base = { item: 'x', description: null, quantity: 1, unit_price: 1, fidelity: null, supplier: null, date_needed: null, date_ordered: null, wufoo_no: null, date_received: null, notes: null, product_link: null };
  it('checks the fields the database enforces', () => {
    expect(validateOrder(base)).toEqual({});
    expect(validateOrder({ ...base, item: ' ' }).item).toBeTruthy();
    expect(validateOrder({ ...base, quantity: 0 }).quantity).toBeTruthy();
    expect(validateOrder({ ...base, unit_price: -1 }).unit_price).toBeTruthy();
    expect(validateOrder({ ...base, date_received: '2026-10-01' }).date_received).toBeTruthy();
    expect(validateOrder({ ...base, date_ordered: '2026-10-02', date_received: '2026-10-01' }).date_received).toBeTruthy();
    expect(validateOrder({ ...base, product_link: 'javascript:alert(1)' }).product_link).toBeTruthy();
  });
  it('exports a CSV that quotes commas and quotes', () => {
    const csv = ordersToCsv([order({ item: 'Cap, 10uF', description: 'a "big" one', quantity: 2, unit_price: 1.5 })]);
    expect(csv.split('\n')[1]).toBe('"Cap, 10uF","a ""big"" one",2,1.5,3,,,,,,,,');
  });
});
