import type { OrderDraft, OrderRequest, RequestDraft, RequestStatus } from '../types';
import { parseLink } from './links';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved — ready to order',
  declined: 'Declined',
  added: 'Added to the budget',
};
export const REQUEST_ICON: Record<RequestStatus, string> = { pending: '⏳', approved: '👍', declined: '✖', added: '✔' };

/** Still needs someone to act on it. */
export const isOpenRequest = (r: Pick<OrderRequest, 'status'>) => r.status === 'pending' || r.status === 'approved';

/** Estimated cost, or null when no price was given. */
export const requestTotal = (r: Pick<OrderRequest, 'quantity' | 'est_unit_price'>): number | null =>
  r.est_unit_price === null ? null : Math.round(r.quantity * r.est_unit_price * 100) / 100;

export function summarizeRequests(list: OrderRequest[]) {
  const sum = (rs: OrderRequest[]) => Math.round(rs.reduce((s, r) => s + (requestTotal(r) ?? 0), 0) * 100) / 100;
  const pending = list.filter((r) => r.status === 'pending');
  const approved = list.filter((r) => r.status === 'approved');
  return {
    pending: pending.length, pendingTotal: sum(pending),
    approved: approved.length, approvedTotal: sum(approved),
    unpriced: [...pending, ...approved].filter((r) => r.est_unit_price === null).length,
  };
}

export type RequestErrors = Partial<Record<keyof RequestDraft, string>>;

export function validateRequest(d: RequestDraft): RequestErrors {
  const e: RequestErrors = {};
  if (!d.item.trim()) e.item = 'What do you want ordered?';
  if (!d.reason.trim()) e.reason = 'Say what it’s for, so the team can approve it.';
  if (!Number.isInteger(d.quantity) || d.quantity < 1) e.quantity = 'Quantity must be a whole number, 1 or more.';
  if (d.est_unit_price !== null && (!Number.isFinite(d.est_unit_price) || d.est_unit_price < 0)) e.est_unit_price = 'Price must be $0 or more (or leave it blank if you don’t know).';
  if (d.product_link && 'error' in parseLink(d.product_link)) e.product_link = 'That doesn’t look like a web link.';
  return e;
}

/** What the budget order form should start with when an approved request is turned into an order. */
export function requestToOrderDraft(r: OrderRequest): Partial<OrderDraft> {
  return {
    item: r.item,
    description: r.reason,
    quantity: r.quantity,
    unit_price: r.est_unit_price ?? 0,
    supplier: r.supplier,
    product_link: r.product_link,
    date_needed: r.needed_by,
    notes: r.notes,
  };
}
