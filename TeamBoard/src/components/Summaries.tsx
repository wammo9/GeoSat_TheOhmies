import { useState } from 'react';
import type { Summary } from '../types';
import { formatDate, formatStamp } from '../lib/dates';
import { useUI } from '../ctx';

type Field = 'weekly_goal' | 'milestone' | 'blockers_decisions';

function Card({ field, title, hint, withDate }: { field: Field; title: string; hint: string; withDate?: boolean }) {
  const { board } = useUI();
  const s = board.summary!;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [base, setBase] = useState<{ text: string; date: string | null; version: number }>({ text: '', date: null, version: 0 });
  const [conflict, setConflict] = useState<Summary | null>(null);

  const start = () => {
    setBase({ text: s[field], date: s.milestone_date, version: s.version });
    setText(s[field]); setDate(s.milestone_date ?? ''); setConflict(null); setEditing(true);
  };

  const patch = () => ({ [field]: text.trim(), ...(withDate ? { milestone_date: date || null } : {}) }) as Partial<Summary>;

  // Always save against the version the editor started from, so a teammate's save in the meantime is detected.
  async function save(version = base.version) {
    const r = await board.saveSummary(version, patch());
    if (!r) return;
    if (r.status === 'ok') { setEditing(false); setConflict(null); return; }
    const sameAsBase = r.latest[field] === base.text && (!withDate || r.latest.milestone_date === base.date);
    if (sameAsBase) return save(r.latest.version); // someone edited a different card: nothing to resolve
    setConflict(r.latest);
  }

  return (
    <section className="sum-card" aria-label={title}>
      <header>
        <h2>{title}</h2>
        {!editing && <button className="small" onClick={start}>Edit</button>}
      </header>
      {editing ? (
        <div className="stack">
          <textarea aria-label={title} rows={3} value={text} placeholder={hint} onChange={(e) => setText(e.target.value)} />
          {withDate && <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
          {conflict && (
            <div className="conflict-note" role="alert">
              <strong>{board.actorName(conflict.updated_by)} saved a different version while you were editing:</strong>
              <p>{conflict[field] || '(empty)'}{withDate && conflict.milestone_date ? ` — ${formatDate(conflict.milestone_date)}` : ''}</p>
              <div className="row">
                <button onClick={() => { setEditing(false); setConflict(null); }}>Use theirs</button>
                <button className="danger" onClick={() => save(conflict.version)}>Overwrite with mine</button>
              </div>
            </div>
          )}
          <div className="row">
            <button className="primary small" onClick={() => save()} disabled={board.saving > 0}>Save</button>
            <button className="small" onClick={() => { setEditing(false); setConflict(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className={s[field] ? 'sum-text' : 'sum-text empty'}>{s[field] || hint}</p>
          {withDate && s.milestone_date && <p className="sum-date"><span aria-hidden="true">🎯 </span>{formatDate(s.milestone_date)}</p>}
        </>
      )}
    </section>
  );
}

export function Summaries() {
  const { board } = useUI();
  const s = board.summary;
  if (!s) return null;
  return (
    <div className="summaries">
      <Card field="weekly_goal" title="This week’s goal" hint="What must be true by Thursday?" />
      <Card field="milestone" title="Next milestone" hint="Name the next milestone and set its date." withDate />
      <Card field="blockers_decisions" title="Blockers & decisions needed" hint="What is stuck, and what do we need to decide?" />
      <p className="sum-foot">
        Last updated by {s.updated_by ? board.actorName(s.updated_by) : 'no one yet'}{s.updated_by ? ` · ${formatStamp(s.updated_at)}` : ''}
      </p>
    </div>
  );
}
