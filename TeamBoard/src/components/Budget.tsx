import { useMemo, useState } from 'react';
import type { Order, OrderRequest } from '../types';
import { STATUS_LABEL, formatMoney, isLate, orderStatus, orderTotal, ordersToCsv, summarize, type OrderStatus } from '../lib/budget';
import { formatDate } from '../lib/dates';
import { hostOf } from '../lib/links';
import { OrderDialog } from './OrderDialog';
import { ImportOrders } from './ImportOrders';
import { RequestDialog } from './RequestDialog';
import { RequestsPanel } from './RequestsPanel';
import { requestToOrderDraft } from '../lib/requests';
import { useUI } from '../ctx';

type StatusFilter = 'all' | OrderStatus | 'late';
type Sort = 'needed' | 'ordered' | 'item' | 'total';

const ICON: Record<OrderStatus, string> = { planned: '○', ordered: '🚚', received: '✔' };

export function Budget() {
  const { board } = useUI();
  const [dialog, setDialog] = useState<{ id?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<'orders' | 'requests'>('orders');
  const [reqDialog, setReqDialog] = useState<{ id?: string } | null>(null);
  const [fromRequest, setFromRequest] = useState<OrderRequest | null>(null);
  const waiting = board.orderRequests.filter((r) => r.status === 'pending').length;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [supplier, setSupplier] = useState('');
  const [sort, setSort] = useState<Sort>('needed');

  const sums = summarize(board.orders, board.today);
  const suppliers = [...new Set(board.orders.map((o) => o.supplier).filter(Boolean))].sort() as string[];

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const cmp: Record<Sort, (a: Order, b: Order) => number> = {
      needed: (a, b) => (a.date_needed ?? '9999').localeCompare(b.date_needed ?? '9999') || a.item.localeCompare(b.item),
      ordered: (a, b) => (b.date_ordered ?? '').localeCompare(a.date_ordered ?? '') || a.item.localeCompare(b.item),
      item: (a, b) => a.item.localeCompare(b.item),
      total: (a, b) => orderTotal(b) - orderTotal(a),
    };
    return board.orders
      .filter((o) => (status === 'all' ? true : status === 'late' ? isLate(o, board.today) : orderStatus(o) === status))
      .filter((o) => !supplier || o.supplier === supplier)
      .filter((o) => !t || [o.item, o.description, o.supplier, o.fidelity, o.wufoo_no, o.notes].some((v) => v?.toLowerCase().includes(t)))
      .sort(cmp[sort]);
  }, [board.orders, board.today, q, status, supplier, sort]);

  const shownTotal = Math.round(list.reduce((s, o) => s + orderTotal(o), 0) * 100) / 100;

  function exportCsv() {
    const blob = new Blob([ordersToCsv(board.orders)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `geosat-budget-${board.today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="stack">
      <section className="panel" aria-label="Budget summary">
        <div className="row between">
          <h2>Budget</h2>
          <div className="row">
            <button onClick={() => setReqDialog({})}>Request an item</button>
            <button onClick={() => setImporting(true)}>Import from spreadsheet</button>
            <button onClick={exportCsv} disabled={board.orders.length === 0}>Export CSV</button>
            <button className="primary" onClick={() => setDialog({})}>+ New order</button>
          </div>
        </div>
        <ul className="budget-cards">
          <li><span className="muted">Spent so far</span><strong>{formatMoney(sums.spent)}</strong><span className="muted small-text">ordered or received</span></li>
          <li><span className="muted">Received</span><strong>{formatMoney(sums.received)}</strong><span className="muted small-text">in hand</span></li>
          <li><span className="muted">On its way</span><strong>{formatMoney(sums.onTheWay)}</strong><span className="muted small-text">ordered, not here yet</span></li>
          <li><span className="muted">Not ordered yet</span><strong>{formatMoney(sums.planned)}</strong><span className="muted small-text">planned</span></li>
          <li className={sums.late ? 'late' : ''}><span className="muted">Late</span><strong>{sums.late}</strong><span className="muted small-text">{sums.late ? <><span aria-hidden="true">⚠ </span>past the date needed</> : 'nothing overdue'}</span></li>
        </ul>
      </section>

      <div className="seg" role="tablist" aria-label="Budget sections">
        <button role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders ({board.orders.length})</button>
        <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>
          Requests{waiting > 0 && <span className="seg-badge" aria-label={`${waiting} waiting for approval`}>{waiting}</span>}
        </button>
      </div>

      {tab === 'requests' && (
        <RequestsPanel onOpen={(id) => setReqDialog({ id })} onNew={() => setReqDialog({})} onTurnIntoOrder={(r) => { setTab('orders'); setFromRequest(r); }} />
      )}

      {tab === 'orders' && <section className="panel">
        <form className="filters budget-filters" role="search" aria-label="Filter orders" onSubmit={(e) => e.preventDefault()}>
          <label className="grow">Search
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item, supplier, WUFOO #, notes…" />
          </label>
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="planned">Not ordered yet</option>
              <option value="ordered">Ordered — on its way</option>
              <option value="received">Received</option>
              <option value="late">Late</option>
            </select>
          </label>
          <label>Supplier
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">All</option>
              {suppliers.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="needed">Date needed (soonest)</option>
              <option value="ordered">Date ordered (newest)</option>
              <option value="item">Item (A–Z)</option>
              <option value="total">Total (highest)</option>
            </select>
          </label>
          <div className="filter-meta" aria-live="polite">Showing {list.length} of {board.orders.length} · {formatMoney(shownTotal)}</div>
        </form>

        {board.orders.length === 0 ? (
          <div className="empty-board">
            <h2>No orders yet</h2>
            <p>Add an order, or paste the rows from your budget spreadsheet to bring them all in at once.</p>
            <div className="row"><button className="primary" onClick={() => setDialog({})}>+ New order</button><button onClick={() => setImporting(true)}>Import from spreadsheet</button></div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tasks orders">
              <thead>
                <tr><th>Item</th><th>Qty × price</th><th>Total</th><th>Supplier</th><th>Fidelity</th><th>Needed</th><th>Ordered</th><th>Received</th><th>Status</th><th>WUFOO #</th><th>Link</th><th><span className="sr-only">Edit</span></th></tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const st = orderStatus(o);
                  const late = isLate(o, board.today);
                  return (
                    <tr key={o.id} className={late ? 'late-row' : ''}>
                      <td>
                        <button className="link" onClick={() => setDialog({ id: o.id })}>{o.item}</button>
                        {o.description && <div className="muted small-text">{o.description}</div>}
                        {o.notes && <div className="muted small-text">📝 {o.notes}</div>}
                      </td>
                      <td>{o.quantity} × {formatMoney(o.unit_price)}</td>
                      <td><strong>{formatMoney(orderTotal(o))}</strong></td>
                      <td>{o.supplier ?? '—'}</td>
                      <td>{o.fidelity ?? '—'}</td>
                      <td>{o.date_needed ? formatDate(o.date_needed) : '—'}</td>
                      <td>{o.date_ordered ? formatDate(o.date_ordered) : '—'}</td>
                      <td>{o.date_received ? formatDate(o.date_received) : '—'}</td>
                      <td>
                        <span className={`status st-${st}`}><span aria-hidden="true">{ICON[st]} </span>{STATUS_LABEL[st]}</span>
                        {late && <div><span className="badge overdue"><span aria-hidden="true">⚠ </span>Late</span></div>}
                      </td>
                      <td>{o.wufoo_no ?? '—'}</td>
                      <td>{o.product_link ? <a href={o.product_link} target="_blank" rel="noopener noreferrer">{hostOf(o.product_link)} ↗<span className="sr-only"> (opens in a new tab)</span></a> : '—'}</td>
                      <td><button className="small" onClick={() => setDialog({ id: o.id })}>Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><th colSpan={2}>{status === 'all' && !supplier && !q.trim() ? 'All orders' : 'Shown'}</th><th>{formatMoney(shownTotal)}</th><td colSpan={9} /></tr></tfoot>
            </table>
            {list.length === 0 && <p className="col-empty">No orders match.</p>}
          </div>
        )}
      </section>}
      {dialog && <OrderDialog key={dialog.id ?? 'new'} orderId={dialog.id} onClose={() => setDialog(null)} />}
      {fromRequest && <OrderDialog key={`rq-${fromRequest.id}`} prefill={requestToOrderDraft(fromRequest)} fromRequest={fromRequest} onClose={() => setFromRequest(null)} />}
      {reqDialog && <RequestDialog key={reqDialog.id ?? 'new-request'} requestId={reqDialog.id} onClose={() => setReqDialog(null)} onTurnIntoOrder={(r) => { setReqDialog(null); setTab('orders'); setFromRequest(r); }} />}
      {importing && <ImportOrders onClose={() => setImporting(false)} />}
    </div>
  );
}
