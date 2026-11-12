import { useState } from 'react';
import type { OrderRequest } from '../types';
import { formatMoney } from '../lib/budget';
import { formatDate, formatStamp } from '../lib/dates';
import { parseLink } from '../lib/links';
import { REQUEST_ICON, REQUEST_STATUS_LABEL, requestTotal, validateRequest, type RequestErrors } from '../lib/requests';
import { errMsg } from '../supabase';
import { Modal } from './Shell';
import { useUI } from '../ctx';

interface Draft { item: string; reason: string; quantity: string; est_unit_price: string; supplier: string; needed_by: string; product_link: string; notes: string }

const toDraft = (r: OrderRequest): Draft => ({
  item: r.item, reason: r.reason, quantity: String(r.quantity), est_unit_price: r.est_unit_price === null ? '' : String(r.est_unit_price),
  supplier: r.supplier ?? '', needed_by: r.needed_by ?? '', product_link: r.product_link ?? '', notes: r.notes ?? '',
});
const EMPTY: Draft = { item: '', reason: '', quantity: '1', est_unit_price: '', supplier: '', needed_by: '', product_link: '', notes: '' };

/** Ask for something to be ordered (new), or review / approve / decline / edit an existing request. */
export function RequestDialog({ requestId, onClose, onTurnIntoOrder }: { requestId?: string; onClose: () => void; onTurnIntoOrder: (r: OrderRequest) => void }) {
  const { board } = useUI();
  const existing = requestId ? board.orderRequests.find((r) => r.id === requestId) : undefined;
  const [base, setBase] = useState<OrderRequest | undefined>(existing);
  const [d, setD] = useState<Draft>(existing ? toDraft(existing) : EMPTY);
  const [errors, setErrors] = useState<RequestErrors>({});
  const [fail, setFail] = useState('');
  const [conflict, setConflict] = useState<OrderRequest | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (requestId && !existing && !base) {
    return <Modal title="Request" onClose={onClose}><p>This request no longer exists (it may have been withdrawn).</p></Modal>;
  }
  // always show the freshest copy of the status/decision, even while editing the details
  const live = base ? board.orderRequests.find((r) => r.id === base.id) ?? base : undefined;
  const locked = live?.status === 'added'; // already turned into an order: details are history
  const mine = !!live && live.requested_by === board.userId;
  const isAdmin = board.members.find((m) => m.user_id === board.userId)?.is_admin ?? false;
  const finance = board.people.find((p) => p.active && /financ/i.test(p.role ?? ''));
  const suppliers = [...new Set([...board.orders.map((o) => o.supplier), ...board.orderRequests.map((r) => r.supplier)].filter(Boolean))] as string[];

  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setErrors({}); };
  const draft = () => {
    const link = d.product_link.trim() ? parseLink(d.product_link) : null;
    return {
      item: d.item.trim(), reason: d.reason.trim(), quantity: Number(d.quantity),
      est_unit_price: d.est_unit_price.trim() === '' ? null : Number(d.est_unit_price),
      supplier: d.supplier.trim() || null, needed_by: d.needed_by || null, notes: d.notes.trim() || null,
      product_link: link && 'url' in link ? link.url : d.product_link.trim() || null,
    };
  };
  const x = draft();
  const total = Number.isFinite(x.quantity) && x.est_unit_price !== null && Number.isFinite(x.est_unit_price) ? requestTotal({ quantity: x.quantity, est_unit_price: x.est_unit_price }) : null;

  async function save(version?: number) {
    const errs = validateRequest(draft());
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFail('');
    try {
      if (!base) {
        const created = await board.createRequest(draft());
        if (created) { board.setNotice('Request sent. The team can now approve it.'); onClose(); }
        return;
      }
      const r = await board.saveRequest(base.id, version ?? base.version, draft());
      if (!r) return;
      if (r.status === 'ok') onClose();
      else if (r.status === 'deleted') setFail('This request was withdrawn by someone else.');
      else setConflict(r.latest);
    } catch (e) { setFail(errMsg(e)); }
  }

  /** Approve / decline / reopen. Details edits in the form are saved separately with "Save changes". */
  async function decide(status: 'approved' | 'declined' | 'pending', decisionNote: string | null) {
    if (!live) return;
    setFail('');
    try {
      const r = await board.saveRequest(live.id, live.version, { status, decision_note: decisionNote });
      if (!r) return;
      if (r.status === 'ok') {
        if (status === 'approved') board.setNotice('Approved. Use “Turn into order” when you’re ready to buy it.');
        onClose();
      } else if (r.status === 'deleted') setFail('This request was withdrawn by someone else.');
      else { setBase(r.latest); setConflict(null); setFail(`${board.actorName(r.latest.updated_by)} just changed this request, so nothing was saved. The latest version is shown; try again if you still want to.`); }
    } catch (e) { setFail(errMsg(e)); }
  }

  const err = (k: keyof RequestErrors) => errors[k] && <span className="field-err" role="alert">{errors[k]}</span>;

  return (
    <Modal title={base ? 'Order request' : 'Request an item'} onClose={onClose} wide>
      {!base && <p className="muted">Tell the team what you need ordered. Someone will approve it, then it gets added to the budget as an order.{finance && <> Your finance manager is <strong>{finance.initial}</strong>.</>}</p>}
      {live && (
        <div className="request-status">
          <span className={`status rq-${live.status}`}><span aria-hidden="true">{REQUEST_ICON[live.status]} </span>{REQUEST_STATUS_LABEL[live.status]}</span>
          <span className="muted small-text">Requested by {board.actorName(live.requested_by)} · {formatStamp(live.created_at)}</span>
          {live.decided_by && live.status !== 'pending' && (
            <span className="muted small-text">{live.status === 'declined' ? 'Declined' : live.status === 'approved' ? 'Approved' : 'Handled'} by {board.actorName(live.decided_by)}{live.decided_at ? ` · ${formatStamp(live.decided_at)}` : ''}{live.decision_note ? ` — “${live.decision_note}”` : ''}</span>
          )}
        </div>
      )}
      <form className="fields" onSubmit={(e) => { e.preventDefault(); if (!locked) save(); }} noValidate>
        <fieldset disabled={locked} className="plain-fieldset">
          <div className="grid2">
            <label>What do you want ordered? <span className="req">required</span>
              <input autoFocus value={d.item} onChange={(e) => set({ item: e.target.value })} placeholder="e.g. Logic analyzer" aria-invalid={!!errors.item} />
              {err('item')}
            </label>
            <label>What’s it for? <span className="req">required</span>
              <input value={d.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Debugging the SPI bus for the PoC" aria-invalid={!!errors.reason} />
              {err('reason')}
            </label>
          </div>
          <div className="grid3">
            <label>Quantity
              <input type="number" min={1} step={1} inputMode="numeric" value={d.quantity} onChange={(e) => set({ quantity: e.target.value })} aria-invalid={!!errors.quantity} />
              {err('quantity')}
            </label>
            <label>Estimated price each ($) <span className="muted">(optional)</span>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={d.est_unit_price} onChange={(e) => set({ est_unit_price: e.target.value })} aria-invalid={!!errors.est_unit_price} />
              {err('est_unit_price')}
            </label>
            <div className="total-box" aria-live="polite"><span className="muted small-text">Estimated total</span><strong>{total === null ? '—' : formatMoney(total)}</strong></div>
          </div>
          <div className="grid3">
            <label>Where to buy it
              <input list="req-suppliers" value={d.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="e.g. Digikey" />
              <datalist id="req-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            <label>Needed by
              <input type="date" value={d.needed_by} onChange={(e) => set({ needed_by: e.target.value })} />
            </label>
            <label>Product link <span className="muted">(optional)</span>
              <input type="url" inputMode="url" value={d.product_link} onChange={(e) => set({ product_link: e.target.value })} placeholder="https://…" aria-invalid={!!errors.product_link} />
              {err('product_link')}
            </label>
          </div>
          <label>Notes <span className="muted">(optional — part numbers, alternatives, anything else)</span>
            <textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </fieldset>

        {conflict && (
          <div className="conflict-note" role="alert">
            <strong>{board.actorName(conflict.updated_by)} changed this request while you were editing.</strong>
            <p>Their version: {conflict.quantity} × {conflict.est_unit_price === null ? 'no price' : formatMoney(conflict.est_unit_price)}, status: {REQUEST_STATUS_LABEL[conflict.status]}.</p>
            <div className="row">
              <button type="button" onClick={() => { setBase(conflict); setD(toDraft(conflict)); setConflict(null); }}>Use theirs</button>
              <button type="button" className="danger" onClick={() => { const v = conflict.version; setBase(conflict); setConflict(null); save(v); }}>Overwrite with mine</button>
            </div>
          </div>
        )}

        {live && declining && (
          <div className="decline-box">
            <label>Reason for declining <span className="muted">(optional, shown to the team)</span>
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. We already have one in the lab" />
            </label>
            <div className="row">
              <button type="button" className="danger" disabled={board.saving > 0} onClick={() => decide('declined', note.trim() || null)}>Decline request</button>
              <button type="button" onClick={() => setDeclining(false)}>Never mind</button>
            </div>
          </div>
        )}

        {fail && <p className="form-err" role="alert">{fail}</p>}

        {live && !locked && !declining && (
          <div className="row decide-row" role="group" aria-label="Decision">
            {live.status === 'pending' && (<>
              <button type="button" className="primary" disabled={board.saving > 0} onClick={() => decide('approved', null)}>👍 Approve</button>
              <button type="button" onClick={() => setDeclining(true)}>✖ Decline…</button>
            </>)}
            {live.status === 'approved' && (<>
              <button type="button" className="primary" onClick={() => onTurnIntoOrder(live)}>Turn into order →</button>
              <button type="button" onClick={() => decide('pending', null)}>Move back to waiting</button>
            </>)}
            {live.status === 'declined' && <button type="button" onClick={() => decide('pending', null)}>Reopen request</button>}
          </div>
        )}
        {locked && <p className="muted">This request has been added to the budget as an order, so it can’t be changed here.</p>}

        <div className="row between">
          <div>
            {live && (mine || isAdmin) && !confirmDelete && <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>{mine ? 'Withdraw request…' : 'Delete request…'}</button>}
            {live && confirmDelete && (
              <span className="row">
                <span>Remove “{live.item}” for everyone?</span>
                <button type="button" className="danger" onClick={async () => { await board.deleteRequest(live.id); onClose(); }}>Yes, remove</button>
                <button type="button" onClick={() => setConfirmDelete(false)}>Keep</button>
              </span>
            )}
          </div>
          <div className="row">
            <button type="button" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</button>
            {!locked && <button className="primary" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : base ? 'Save changes' : 'Send request'}</button>}
          </div>
        </div>
        {live && live.status !== 'pending' && live.needed_by && <p className="muted small-text">Needed by {formatDate(live.needed_by)}.</p>}
      </form>
    </Modal>
  );
}
