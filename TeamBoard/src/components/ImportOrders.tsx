import { useMemo, useState } from 'react';
import { formatMoney, orderTotal, ordersFromTsv } from '../lib/budget';
import { errMsg } from '../supabase';
import { Modal } from './Shell';
import { useUI } from '../ctx';

/** Paste rows copied from the team's spreadsheet; check them; add them all in one go. */
export function ImportOrders({ onClose }: { onClose: () => void }) {
  const { board } = useUI();
  const [text, setText] = useState('');
  const [fail, setFail] = useState('');
  const result = useMemo(() => ordersFromTsv(text, board.orders), [text, board.orders]);
  const total = result.rows.reduce((s, r) => s + orderTotal(r), 0);

  async function add() {
    setFail('');
    try {
      const n = await board.importOrders(result.rows);
      if (n !== undefined) { board.setNotice(`Added ${n} order${n === 1 ? '' : 's'} to the budget.`); onClose(); }
    } catch (e) { setFail(errMsg(e)); }
  }

  return (
    <Modal title="Import orders from your spreadsheet" onClose={onClose} wide>
      <p>In your budget spreadsheet, select the rows (include the header row if you can), copy them, and paste below. Columns are matched by their headings: Item, Desc/Use, Quantity, Price, Fidelity, Supplier, Date Needed, Date Ordered, WUFOO #, Date Received, Notes, Product Link. Orders already in the budget are skipped, so it’s safe to paste the same rows twice.</p>
      <textarea className="paste-box" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste copied spreadsheet rows here…" aria-label="Pasted spreadsheet rows" autoFocus />
      {text.trim() && (
        <div className="import-summary" role="status">
          <p>
            <strong>{result.rows.length}</strong> new order{result.rows.length === 1 ? '' : 's'} ready{result.rows.length > 0 && <> ({formatMoney(total)})</>}
            {result.duplicates > 0 && <> · {result.duplicates} already in the budget (skipped)</>}
            {result.errors.length > 0 && <> · <strong>{result.errors.length}</strong> row{result.errors.length === 1 ? '' : 's'} need attention</>}
          </p>
          {result.errors.length > 0 && (
            <ul className="import-errors">{result.errors.map((e) => <li key={e.line}>Row {e.line}: {e.message}</li>)}</ul>
          )}
          {result.rows.length > 0 && (
            <ul className="import-preview">
              {result.rows.slice(0, 8).map((r, i) => <li key={i}>{r.quantity} × <strong>{r.item}</strong>{r.supplier ? ` — ${r.supplier}` : ''} · {formatMoney(orderTotal(r))}</li>)}
              {result.rows.length > 8 && <li className="muted">…and {result.rows.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}
      {fail && <p className="form-err" role="alert">{fail}</p>}
      <div className="row end">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={result.rows.length === 0 || board.saving > 0} onClick={add}>
          {board.saving > 0 ? 'Adding…' : `Add ${result.rows.length || ''} order${result.rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
