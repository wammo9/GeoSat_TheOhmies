import { useMemo, useState } from 'react';
import type { OrderRequest, RequestStatus } from '../types';
import { formatMoney } from '../lib/budget';
import { formatDate } from '../lib/dates';
import { hostOf } from '../lib/links';
import { REQUEST_ICON, REQUEST_STATUS_LABEL, isOpenRequest, requestTotal, summarizeRequests } from '../lib/requests';
import { useUI } from '../ctx';

type Filter = 'open' | 'all' | RequestStatus;

export function RequestsPanel({ onOpen, onNew, onTurnIntoOrder }: { onOpen: (id: string) => void; onNew: () => void; onTurnIntoOrder: (r: OrderRequest) => void }) {
  const { board } = useUI();
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const sums = summarizeRequests(board.orderRequests);
  const finance = board.people.find((p) => p.active && /financ/i.test(p.role ?? ''));

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return board.orderRequests
      .filter((r) => (filter === 'all' ? true : filter === 'open' ? isOpenRequest(r) : r.status === filter))
      .filter((r) => !t || [r.item, r.reason, r.supplier, r.notes].some((v) => v?.toLowerCase().includes(t)))
      // waiting first, then approved, then by when they're needed
      .sort((a, b) => ['pending', 'approved', 'declined', 'added'].indexOf(a.status) - ['pending', 'approved', 'declined', 'added'].indexOf(b.status)
        || (a.needed_by ?? '9999').localeCompare(b.needed_by ?? '9999') || b.created_at.localeCompare(a.created_at));
  }, [board.orderRequests, filter, q]);

  async function approve(r: OrderRequest) {
    const res = await board.saveRequest(r.id, r.version, { status: 'approved', decision_note: null });
    if (res && res.status !== 'ok') board.setError(`“${r.item}” was just changed by someone else, so it wasn’t approved. Open it to review the latest.`);
  }

  return (
    <section className="panel" aria-label="Order requests">
      <div className="row between">
        <h2>Order requests</h2>
        <button className="primary" onClick={onNew}>+ Request an item</button>
      </div>
      <p className="muted">Anyone can ask for something to be ordered. The team approves it{finance && <> (your finance manager is <strong>{finance.initial}</strong>)</>}, then <strong>Turn into order</strong> adds it to the budget.</p>
      <ul className="budget-cards">
        <li><span className="muted">Waiting for approval</span><strong>{sums.pending}</strong><span className="muted small-text">{formatMoney(sums.pendingTotal)} estimated</span></li>
        <li><span className="muted">Approved, not ordered</span><strong>{sums.approved}</strong><span className="muted small-text">{formatMoney(sums.approvedTotal)} estimated</span></li>
        {sums.unpriced > 0 && <li><span className="muted">Without a price</span><strong>{sums.unpriced}</strong><span className="muted small-text">totals are higher than shown</span></li>}
      </ul>

      <form className="filters budget-filters" role="search" aria-label="Filter requests" onSubmit={(e) => e.preventDefault()}>
        <label className="grow">Search
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item, reason, supplier…" />
        </label>
        <label>Show
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="open">Needs action (waiting + approved)</option>
            <option value="pending">Waiting for approval</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="added">Added to the budget</option>
            <option value="all">Everything</option>
          </select>
        </label>
        <div className="filter-meta" aria-live="polite">Showing {list.length} of {board.orderRequests.length}</div>
      </form>

      {board.orderRequests.length === 0 ? (
        <div className="empty-board">
          <h2>No requests yet</h2>
          <p>Need a part, a tool or a supply? Request it here instead of messaging around.</p>
          <div className="row"><button className="primary" onClick={onNew}>+ Request an item</button></div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tasks orders requests">
            <thead><tr><th>Item</th><th>Qty × est. price</th><th>Est. total</th><th>Where</th><th>Needed by</th><th>Requested by</th><th>Status</th><th>Link</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((r) => {
                const total = requestTotal(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <button className="link" onClick={() => onOpen(r.id)}>{r.item}</button>
                      <div className="muted small-text">{r.reason}</div>
                    </td>
                    <td>{r.quantity} × {r.est_unit_price === null ? <span className="muted">no price</span> : formatMoney(r.est_unit_price)}</td>
                    <td>{total === null ? '—' : <strong>{formatMoney(total)}</strong>}</td>
                    <td>{r.supplier ?? '—'}</td>
                    <td>{r.needed_by ? formatDate(r.needed_by) : '—'}</td>
                    <td>{board.actorName(r.requested_by)}</td>
                    <td>
                      <span className={`status rq-${r.status}`}><span aria-hidden="true">{REQUEST_ICON[r.status]} </span>{REQUEST_STATUS_LABEL[r.status]}</span>
                      {r.decision_note && r.status === 'declined' && <div className="muted small-text">“{r.decision_note}”</div>}
                      {r.decided_by && r.status !== 'pending' && <div className="muted small-text">by {board.actorName(r.decided_by)}</div>}
                    </td>
                    <td>{r.product_link ? <a href={r.product_link} target="_blank" rel="noopener noreferrer">{hostOf(r.product_link)} ↗<span className="sr-only"> (opens in a new tab)</span></a> : '—'}</td>
                    <td className="row-actions">
                      {r.status === 'pending' && <button className="small primary" onClick={() => approve(r)} disabled={board.saving > 0}>Approve</button>}
                      {r.status === 'approved' && <button className="small primary" onClick={() => onTurnIntoOrder(r)}>Turn into order</button>}
                      <button className="small" onClick={() => onOpen(r.id)}>{r.status === 'pending' ? 'Review' : 'Open'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <p className="col-empty">Nothing here. {filter === 'open' ? 'All caught up!' : 'No requests match.'}</p>}
        </div>
      )}
    </section>
  );
}
