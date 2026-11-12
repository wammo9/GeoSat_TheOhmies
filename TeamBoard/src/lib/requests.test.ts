import { describe, expect, it } from 'vitest';
import type { OrderRequest } from '../types';
import { isOpenRequest, requestToOrderDraft, requestTotal, summarizeRequests, validateRequest } from './requests';

const req = (o: Partial<OrderRequest>): OrderRequest => ({
  id: 'r', workspace_id: 'w', item: 'Part', reason: 'Needed for the PoC', quantity: 1, est_unit_price: null, supplier: null, product_link: null,
  needed_by: null, notes: null, status: 'pending', decision_note: null, decided_by: null, decided_at: null, order_id: null, requested_by: null,
  version: 1, updated_by: null, updated_at: '', created_at: '', ...o,
});

describe('requests', () => {
  it('estimates cost from quantity and price, or says unknown', () => {
    expect(requestTotal({ quantity: 3, est_unit_price: 0.1 })).toBe(0.3);
    expect(requestTotal({ quantity: 2, est_unit_price: null })).toBeNull();
  });
  it('treats pending and approved as open', () => {
    expect(isOpenRequest(req({ status: 'pending' }))).toBe(true);
    expect(isOpenRequest(req({ status: 'approved' }))).toBe(true);
    expect(isOpenRequest(req({ status: 'declined' }))).toBe(false);
    expect(isOpenRequest(req({ status: 'added' }))).toBe(false);
  });
  it('summarizes what is waiting and what is approved, counting unpriced ones', () => {
    const s = summarizeRequests([
      req({ id: '1', quantity: 2, est_unit_price: 10 }),
      req({ id: '2', status: 'approved', quantity: 1, est_unit_price: 49.99 }),
      req({ id: '3', status: 'pending' }), // no price
      req({ id: '4', status: 'declined', quantity: 9, est_unit_price: 100 }),
      req({ id: '5', status: 'added', quantity: 1, est_unit_price: 5 }),
    ]);
    expect(s).toEqual({ pending: 2, pendingTotal: 20, approved: 1, approvedTotal: 49.99, unpriced: 1 });
  });
  it('requires an item and a reason; checks quantity, price and link', () => {
    const ok = { item: 'x', reason: 'y', quantity: 1, est_unit_price: null, supplier: null, product_link: null, needed_by: null, notes: null };
    expect(validateRequest(ok)).toEqual({});
    expect(validateRequest({ ...ok, item: ' ' }).item).toBeTruthy();
    expect(validateRequest({ ...ok, reason: '' }).reason).toBeTruthy();
    expect(validateRequest({ ...ok, quantity: 0 }).quantity).toBeTruthy();
    expect(validateRequest({ ...ok, est_unit_price: -1 }).est_unit_price).toBeTruthy();
    expect(validateRequest({ ...ok, est_unit_price: 0 })).toEqual({});
    expect(validateRequest({ ...ok, product_link: 'javascript:alert(1)' }).product_link).toBeTruthy();
  });
  it('pre-fills the budget order form from a request', () => {
    const d = requestToOrderDraft(req({ item: 'Logic analyzer', reason: 'Debug SPI', quantity: 2, est_unit_price: 49.99, supplier: 'Amazon', needed_by: '2026-11-06', product_link: 'https://a.com/x', notes: 'blue one' }));
    expect(d).toEqual({ item: 'Logic analyzer', description: 'Debug SPI', quantity: 2, unit_price: 49.99, supplier: 'Amazon', product_link: 'https://a.com/x', date_needed: '2026-11-06', notes: 'blue one' });
    expect(requestToOrderDraft(req({ est_unit_price: null })).unit_price).toBe(0);
  });
});
