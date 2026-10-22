import { useState } from 'react';
import type { Evidence, Task } from '../types';
import { formatStamp } from '../lib/dates';
import { Modal } from './Shell';
import { useUI } from '../ctx';

export function EvidenceList({ task, canRemove = true }: { task: Task; canRemove?: boolean }) {
  const { board } = useUI();
  if (!task.evidence.length) return <p className="muted">Nothing recorded yet.</p>;
  return (
    <ul className="evidence">
      {task.evidence.map((e: Evidence) => (
        <li key={e.added_at + e.value}>
          {e.type === 'none' ? <em>{e.value}</em> : e.type === 'link' ? <a href={e.value} target="_blank" rel="noopener noreferrer">{e.value}</a> : <span>{e.value}</span>}
          <span className="muted"> — {board.actorName(e.added_by)}, {formatStamp(e.added_at)}</span>
          {canRemove && <button className="link" onClick={() => board.removeEvidence(task.id, e)} aria-label="Remove this note">Remove</button>}
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
      <label className="grow"><span className="sr-only">Deliverable note or link</span>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Link, or one sentence on what it is and where it is" />
      </label>
      <button disabled={!v.trim() || board.saving > 0}>Add note</button>
    </form>
  );
}

/** Shown when a task is moved to Completed and nothing about its deliverable is recorded yet. */
export function EvidencePrompt({ task, onClose }: { task: Task; onClose: () => void }) {
  const { board } = useUI();
  const [had, setHad] = useState<'' | 'yes' | 'no'>('');
  const [v, setV] = useState('');
  const ready = had === 'no' || (had === 'yes' && v.trim().length > 0);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const updated = had === 'no' ? await board.addNoDeliverable(task.id) : await board.addEvidence(task.id, v);
    if (!updated) return;
    const r = await board.moveTask(updated, 'completed');
    if (r === 'ok') onClose();
  }
  return (
    <Modal title="Complete this task" onClose={onClose}>
      <p><strong>{task.title}</strong></p>
      <p className="muted">Planned deliverable: {task.deliverable}</p>
      <form onSubmit={go} className="stack">
        <fieldset>
          <legend>Was there a deliverable?</legend>
          <label className="radio-row"><input type="radio" name="had" checked={had === 'yes'} onChange={() => setHad('yes')} autoFocus /> Yes</label>
          <label className="radio-row"><input type="radio" name="had" checked={had === 'no'} onChange={() => setHad('no')} /> No</label>
        </fieldset>
        {had === 'yes' && (
          <label>In one sentence: what was it, and where is it?
            <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. “Power schematic v3 PDF, in the Drive folder Hardware/Power” or a link" />
          </label>
        )}
        {had === 'no' && <p className="muted">The task will be completed with a note that there was no deliverable.</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Cancel — leave it where it is</button>
          <button className="primary" disabled={!ready || board.saving > 0}>Complete task</button>
        </div>
      </form>
    </Modal>
  );
}
