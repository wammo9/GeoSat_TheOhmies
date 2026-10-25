import { useState } from 'react';
import type { Order } from '../types';
import { formatMoney, orderTotal, validateOrder, type OrderErrors } from '../lib/budget';
import { formatDate, formatStamp } from '../lib/dates';
import { parseLink } from '../lib/links';
import { errMsg } from '../supabase';
import { Modal } from './Shell';
import { useUI } from '../ctx';

interface Draft {
  item: string; description: string; quantity: string; unit_price: string; fidelity: string; supplier: string;
  date_needed: string; date_ordered: string; wufoo_no: string; date_received: string; notes: string; product_link: string;
}

const toDraft = (o: Order): Draft => ({
  item: o.item, description: o.description ?? '', quantity: String(o.quantity), unit_price: String(o.unit_price), fidelity: o.fidelity ?? '',
  supplier: o.supplier ?? '', date_needed: o.date_needed ?? '', date_ordered: o.date_ordered ?? '', wufoo_no: o.wufoo_no ?? '',
  date_received: o.date_received ?? '', notes: o.notes ?? '', product_link: o.product_link ?? '',
});
const EMPTY: Draft = { item: '', description: '', quantity: '1', unit_price: '', fidelity: '', supplier: '', date_needed: '', date_ordered: '', wufoo_no: '', date_received: '', notes: '', product_link: '' };

export function OrderDialog({ orderId, onClose }: { orderId?: string; onClose: () => void }) {
  const { board } = useUI();
  const existing = orderId ? board.orders.find((o) => o.id === orderId) : undefined;
  const [base, setBase] = useState<Order | undefined>(existing);
  const [d, setD] = useState<Draft>(existing ? toDraft(existing) : EMPTY);
  const [errors, setErrors] = useState<OrderErrors>({});
  const [fail, setFail] = useState('');
  const [conflict, setConflict] = useState<Order | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (orderId && !existing && !base) {
    return <Modal title="Order" onClose={onClose}><p>This order no longer exists (a teammate may have deleted it).</p></Modal>;
  }

  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setErrors({}); };
  const suppliers = [...new Set(board.orders.map((o) => o.supplier).filter(Boolean))] as string[];
  const fidelities = [...new Set(board.orders.map((o) => o.fidelity).filter(Boolean))] as string[];

  const draft = () => {
    const link = d.product_link.trim() ? parseLink(d.product_link) : null;
    return {
      item: d.item.trim(), description: d.description.trim() || null, quantity: Number(d.quantity), unit_price: d.unit_price.trim() === '' ? 0 : Number(d.unit_price),
      fidelity: d.fidelity.trim() || null, supplier: d.supplier.trim() || null, date_needed: d.date_needed || null, date_ordered: d.date_ordered || null,
      wufoo_no: d.wufoo_no.trim() || null, date_received: d.date_received || null, notes: d.notes.trim() || null,
      product_link: link && 'url' in link ? link.url : d.product_link.trim() || null,
    };
  };
  const total = (() => { const x = draft(); return Number.isFinite(x.quantity) && Number.isFinite(x.unit_price) ? orderTotal(x) : 0; })();

  async function save(version?: number) {
    const x = draft();
    const errs = validateOrder(x);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFail('');
    try {
      if (!base) {
        const created = await board.createOrder(x);
        if (created) onClose();
        return;
      }
      const r = await board.saveOrder(base.id, version ?? base.version, x);
      if (!r) return;
      if (r.status === 'ok') onClose();
      else if (r.status === 'deleted') setFail('This order was deleted by someone else.');
      else setConflict(r.latest);
    } catch (err) {
      setFail(errMsg(err));
    }
  }

  const err = (k: keyof OrderErrors) => errors[k] && <span className="field-err" role="alert">{errors[k]}</span>;

  return (
    <Modal title={base ? 'Edit order' : 'New order'} onClose={onClose} wide>
      {base && <p className="muted small-text">Last changed by {board.actorName(base.updated_by)} · {formatStamp(base.updated_at)}</p>}
      <form className="fields" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <div className="grid2">
          <label>Item <span className="req">required</span>
            <input autoFocus value={d.item} onChange={(e) => set({ item: e.target.value })} placeholder="e.g. INA219AIDR" aria-invalid={!!errors.item} />
            {err('item')}
          </label>
          <label>What it’s for
            <input value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Current sensor" />
          </label>
        </div>
        <div className="grid3">
          <label>Quantity
            <input type="number" min={1} step={1} inputMode="numeric" value={d.quantity} onChange={(e) => set({ quantity: e.target.value })} aria-invalid={!!errors.quantity} />
            {err('quantity')}
          </label>
          <label>Price each ($)
            <input type="number" min={0} step="0.01" inputMode="decimal" value={d.unit_price} onChange={(e) => set({ unit_price: e.target.value })} aria-invalid={!!errors.unit_price} />
            {err('unit_price')}
          </label>
          <div className="total-box" aria-live="polite"><span className="muted small-text">Total</span><strong>{formatMoney(total)}</strong></div>
        </div>
        <div className="grid3">
          <label>Supplier
            <input list="suppliers" value={d.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="e.g. Mouser" />
            <datalist id="suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label>Fidelity
            <input list="fidelities" value={d.fidelity} onChange={(e) => set({ fidelity: e.target.value })} placeholder="e.g. Rev 2" />
            <datalist id="fidelities">{fidelities.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label>WUFOO #
            <input value={d.wufoo_no} onChange={(e) => set({ wufoo_no: e.target.value })} />
          </label>
        </div>
        <div className="grid3">
          <label>Date needed
            <input type="date" value={d.date_needed} onChange={(e) => set({ date_needed: e.target.value })} />
          </label>
          <label>Date ordered
            <input type="date" value={d.date_ordered} onChange={(e) => set({ date_ordered: e.target.value })} />
            {!d.date_ordered && <button type="button" className="link" onClick={() => set({ date_ordered: board.today })}>Ordered today</button>}
          </label>
          <label>Date received
            <input type="date" value={d.date_received} onChange={(e) => set({ date_received: e.target.value })} aria-invalid={!!errors.date_received} />
            {err('date_received')}
            {!d.date_received && d.date_ordered && <button type="button" className="link" onClick={() => set({ date_received: board.today })}>Received today</button>}
          </label>
        </div>
        <label>Product link <span className="muted">(optional)</span>
          <input type="url" inputMode="url" value={d.product_link} onChange={(e) => set({ product_link: e.target.value })} placeholder="https://www.mouser.com/…" aria-invalid={!!errors.product_link} />
          {err('product_link')}
        </label>
        <label>Notes
          <textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>

        {conflict && (
          <div className="conflict-note" role="alert">
            <strong>{board.actorName(conflict.updated_by)} changed this order while you were editing.</strong>
            <p>Their version: {conflict.quantity} × {formatMoney(conflict.unit_price)}, ordered {conflict.date_ordered ? formatDate(conflict.date_ordered) : '—'}, received {conflict.date_received ? formatDate(conflict.date_received) : '—'}.</p>
            <div className="row">
              <button type="button" onClick={() => { setBase(conflict); setD(toDraft(conflict)); setConflict(null); }}>Use theirs</button>
              <button type="button" className="danger" onClick={() => { const v = conflict.version; setBase(conflict); setConflict(null); save(v); }}>Overwrite with mine</button>
            </div>
          </div>
        )}
        {fail && <p className="form-err" role="alert">{fail}</p>}
        <div className="row between">
          <div>
            {base && !confirmDelete && <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete order…</button>}
            {base && confirmDelete && (
              <span className="row">
                <span>Delete “{base.item}” for everyone?</span>
                <button type="button" className="danger" onClick={async () => { await board.deleteOrder(base.id); onClose(); }}>Yes, delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)}>Keep</button>
              </span>
            )}
          </div>
          <div className="row">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : base ? 'Save order' : 'Add order'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
