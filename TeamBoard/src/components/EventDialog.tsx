import { useMemo, useState } from 'react';
import type { CalEvent, EventKind, Recur } from '../types';
import { KINDS, RECURS, eventEnd, recurLabel } from '../lib/calendar';
import { formatDate, formatStamp } from '../lib/dates';
import { isOpen } from '../lib/rules';
import { Modal } from './Shell';
import { OwnerChip } from './Chips';
import { useUI } from '../ctx';
import { errMsg } from '../supabase';

interface Draft {
  title: string; kind: EventKind; start_date: string; end_date: string; description: string; is_major: boolean;
  recur: Recur; recur_until: string;
}

const toDraft = (e: CalEvent): Draft => ({
  title: e.title, kind: e.kind, start_date: e.start_date, end_date: e.end_date ?? '', description: e.description ?? '', is_major: e.is_major,
  recur: e.recur, recur_until: e.recur_until ?? '',
});

export function EventDialog({ eventId, date, occurrence, onClose }: { eventId?: string; date?: string; occurrence?: string; onClose: () => void }) {
  const { board, openTask } = useUI();
  const existing = eventId ? board.events.find((e) => e.id === eventId) : undefined;
  const [base, setBase] = useState<CalEvent | undefined>(existing);
  const [d, setD] = useState<Draft>(
    existing ? toDraft(existing)
      : { title: '', kind: 'meeting', start_date: date ?? board.today, end_date: '', description: '', is_major: false, recur: 'none', recur_until: '' },
  );
  const initialLinked = useMemo(() => new Set(board.tasks.filter((t) => t.event_id === eventId).map((t) => t.id)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [linked, setLinked] = useState<Set<string>>(initialLinked);
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [fail, setFail] = useState('');
  const [conflict, setConflict] = useState<CalEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (eventId && !existing && !base) {
    return <Modal title="Event" onClose={onClose}><p>This event no longer exists (a teammate may have deleted it).</p></Modal>;
  }

  const candidates = board.tasks
    .filter((t) => (isOpen(t) || linked.has(t.id)) && (!q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  function validate() {
    const e: typeof errors = {};
    if (!d.title.trim()) e.title = 'A title is required.';
    if (!d.start_date) e.start_date = 'A start date is required.';
    if (d.end_date && d.start_date && d.end_date < d.start_date) e.end_date = 'The end date cannot be before the start date.';
    if (d.recur !== 'none' && d.recur_until && d.recur_until < d.start_date) e.recur_until = 'The repeat end date cannot be before the start date.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function syncLinks(id: string) {
    const toAdd = [...linked].filter((t) => !initialLinked.has(t));
    const toRemove = [...initialLinked].filter((t) => !linked.has(t));
    const results = await Promise.all([
      ...toAdd.map((t) => board.setTaskEvent(t, id)),
      ...toRemove.map((t) => board.setTaskEvent(t, null)),
    ]);
    return results.every(Boolean);
  }

  async function save(version?: number) {
    if (!validate()) return;
    setFail('');
    const fields = {
      title: d.title.trim(), kind: d.kind, start_date: d.start_date, end_date: d.end_date || null,
      description: d.description.trim() || null, is_major: d.is_major,
      recur: d.recur, recur_until: d.recur !== 'none' && d.recur_until ? d.recur_until : null,
      recur_skip: base?.recur_skip ?? [],
    };
    try {
      let id: string;
      if (!base) {
        const created = await board.createEvent(fields);
        if (!created) return;
        id = created.id;
      } else {
        const r = await board.saveEvent(base.id, version ?? base.version, fields);
        if (!r) return;
        if (r.status === 'deleted') { setFail('This event was deleted by someone else.'); return; }
        if (r.status === 'conflict') { setConflict(r.latest); return; }
        id = r.event.id;
      }
      if (await syncLinks(id)) onClose();
    } catch (err) {
      setFail(errMsg(err));
    }
  }

  async function changeSkips(next: string[]) {
    if (!base) return;
    setFail('');
    try {
      const r = await board.saveEvent(base.id, base.version, { recur_skip: next });
      if (!r) return;
      if (r.status === 'ok') { setBase(r.event); return; }
      if (r.status === 'conflict') setConflict(r.latest); else setFail('This event was deleted by someone else.');
    } catch (err) { setFail(errMsg(err)); }
  }

  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setErrors({}); };
  const err = (k: keyof Draft) => errors[k] && <span className="field-err" role="alert">{errors[k]}</span>;

  return (
    <Modal title={base ? 'Edit event' : 'New event'} onClose={onClose} wide>
      {base && <p className="muted small-text">Last changed by {board.actorName(base.updated_by)} · {formatStamp(base.updated_at)}</p>}
      <form className="fields" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <label>Title <span className="req">required</span>
          <input autoFocus value={d.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!errors.title} />
          {err('title')}
        </label>
        <div className="grid3">
          <label>Type
            <select value={d.kind} onChange={(e) => set({ kind: e.target.value as EventKind })}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
            </select>
          </label>
          <label>Start date <span className="req">required</span>
            <input type="date" value={d.start_date} onChange={(e) => set({ start_date: e.target.value })} aria-invalid={!!errors.start_date} />
            {err('start_date')}
          </label>
          <label>End date <span className="muted">(optional, for multi-day)</span>
            <input type="date" value={d.end_date} min={d.start_date || undefined} onChange={(e) => set({ end_date: e.target.value })} aria-invalid={!!errors.end_date} />
            {err('end_date')}
          </label>
        </div>
        <div className="grid3">
          <label>Repeats
            <select value={d.recur} onChange={(e) => set({ recur: e.target.value as Recur })}>
              {RECURS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          {d.recur !== 'none' && (
            <label>Repeat until <span className="muted">(optional)</span>
              <input type="date" value={d.recur_until} min={d.start_date || undefined} onChange={(e) => set({ recur_until: e.target.value })} aria-invalid={!!errors.recur_until} />
              {err('recur_until')}
            </label>
          )}
          {d.recur !== 'none' && d.start_date && (
            <p className="muted small-text recur-hint">{recurLabel({ start_date: d.start_date, recur: d.recur, recur_until: d.recur_until || null })}. Edits apply to every repeat. Monthly repeats on the 29th–31st land on the month’s last day when needed.</p>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={d.is_major} onChange={(e) => set({ is_major: e.target.checked })} />
          <span><strong>Big event</strong> — highlight it at the top of the Calendar until it’s over</span>
        </label>
        <label>Notes <span className="muted">(optional)</span>
          <textarea rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="Location, what to bring, who’s presenting…" />
        </label>

        <fieldset>
          <legend>Tasks that support this event ({linked.size} linked)</legend>
          <input type="search" aria-label="Search tasks to link" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="link-list">
            {candidates.map((t) => (
              <li key={t.id}>
                <label className="check">
                  <input type="checkbox" checked={linked.has(t.id)}
                    onChange={(e) => { const n = new Set(linked); e.target.checked ? n.add(t.id) : n.delete(t.id); setLinked(n); }} />
                  <span className="link-row">
                    <span>{t.title}</span>
                    <OwnerChip person={board.person(t.owner_id)} name={false} />
                    <span className="muted">due {formatDate(t.due_date)}</span>
                    {t.event_id && t.event_id !== eventId && <span className="tag">linked to “{board.events.find((x) => x.id === t.event_id)?.title}” — will move here</span>}
                  </span>
                </label>
                {base && t.event_id === base.id && <button type="button" className="link" onClick={() => openTask(t.id)}>open</button>}
              </li>
            ))}
            {candidates.length === 0 && <li className="muted">No matching tasks.</li>}
          </ul>
        </fieldset>

        {base && base.recur !== 'none' && (
          <div className="recur-box">
            {occurrence && !base.recur_skip.includes(occurrence) && (
              <div className="row">
                <span>This repeat is on <strong>{formatDate(occurrence)}</strong>.</span>
                <button type="button" onClick={() => changeSkips([...base.recur_skip, occurrence])}>Skip just this date</button>
              </div>
            )}
            {base.recur_skip.length > 0 && (
              <p className="small-text">Skipped dates:{' '}
                {[...base.recur_skip].sort().map((s) => (
                  <span key={s} className="tag">{formatDate(s)} <button type="button" className="link" onClick={() => changeSkips(base.recur_skip.filter((x) => x !== s))}>restore</button></span>
                ))}
              </p>
            )}
          </div>
        )}

        {conflict && (
          <div className="conflict-note" role="alert">
            <strong>{board.actorName(conflict.updated_by)} changed this event while you were editing.</strong>
            <p>Their version: “{conflict.title}”, {formatDate(conflict.start_date)}{conflict.end_date ? ` – ${formatDate(eventEnd(conflict))}` : ''}.</p>
            <div className="row">
              <button type="button" onClick={() => { setBase(conflict); setD(toDraft(conflict)); setConflict(null); }}>Use theirs</button>
              <button type="button" className="danger" onClick={() => { const v = conflict.version; setBase(conflict); setConflict(null); save(v); }}>Overwrite with mine</button>
            </div>
          </div>
        )}
        {fail && <p className="form-err" role="alert">{fail}</p>}
        <div className="row between">
          <div>
            {base && !confirmDelete && <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete event…</button>}
            {base && confirmDelete && (
              <span className="row">
                <span>Delete for everyone? Linked tasks are kept, just unlinked.</span>
                <button type="button" className="danger" onClick={async () => { await board.deleteEvent(base.id); onClose(); }}>Yes, delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)}>Keep</button>
              </span>
            )}
          </div>
          <div className="row">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : base ? 'Save event' : 'Add event'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
