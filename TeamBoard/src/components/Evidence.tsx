import { useState } from 'react';
import type { Evidence, Task } from '../types';
import { formatStamp } from '../lib/dates';
import { Modal } from './Shell';
import { useUI } from '../ctx';

export function EvidenceList({ task, canRemove = true }: { task: Task; canRemove?: boolean }) {
  const { board } = useUI();
  if (!task.evidence.length) return <p className="muted">No evidence recorded yet.</p>;
  return (
    <ul className="evidence">
      {task.evidence.map((e: Evidence) => (
        <li key={e.added_at + e.value}>
          {e.type === 'link' ? <a href={e.value} target="_blank" rel="noopener noreferrer">{e.value}</a> : <span>{e.value}</span>}
          <span className="muted"> — {board.actorName(e.added_by)}, {formatStamp(e.added_at)}</span>
          {canRemove && <button className="link" onClick={() => board.removeEvidence(task.id, e)} aria-label="Remove this evidence">Remove</button>}
        </li>
      ))}
    </ul>
  );
}

export function AddEvidence({ task, onAdded }: { task: Task; onAdded?: (t: Task) => void }) {
  const { board } = useUI();
  const [v, setV] = useState('');
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = await board.addEvidence(task.id, v);
    if (t) { setV(''); onAdded?.(t); }
  }
  return (
    <form onSubmit={add} className="row">
      <label className="grow"><span className="sr-only">Evidence</span>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Link, or a written reference (e.g. “Bench test log run 4, Drive/Tests”)" />
      </label>
      <button disabled={!v.trim() || board.saving > 0}>Add evidence</button>
    </form>
  );
}

/** Shown when a move to Completed is attempted without evidence. */
export function EvidencePrompt({ task, onClose }: { task: Task; onClose: () => void }) {
  const { board } = useUI();
  const [v, setV] = useState('');
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const withEv = await board.addEvidence(task.id, v);
    if (!withEv) return;
    const r = await board.moveTask(withEv, 'completed');
    if (r === 'ok') onClose();
  }
  return (
    <Modal title="Evidence needed to complete" onClose={onClose}>
      <p><strong>{task.title}</strong> needs evidence before it can move to Completed. Add a link or a written reference to the result — test data, a schematic, code, or a reviewed document.</p>
      <p className="muted">Deliverable: {task.deliverable}</p>
      <form onSubmit={go} className="stack">
        <textarea autoFocus rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder="https://… or “Reviewed by M on Thursday, schematic v3 in /hardware/power”" aria-label="Evidence" />
        <div className="row end">
          <button type="button" onClick={onClose}>Cancel — leave it where it is</button>
          <button className="primary" disabled={!v.trim() || board.saving > 0}>Add evidence & complete</button>
        </div>
      </form>
    </Modal>
  );
}
