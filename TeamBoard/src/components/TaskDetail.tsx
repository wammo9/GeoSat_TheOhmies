import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskDraft } from '../types';
import { changedFields, threeWayMerge, toDraft } from '../lib/merge';
import { COLUMNS, colTitle, validateDraft } from '../lib/rules';
import { formatDate, formatStamp } from '../lib/dates';
import { describeChange } from '../lib/activity';
import { Badges } from './Chips';
import { Modal } from './Shell';
import { TaskFields } from './TaskForm';
import { AddEvidence, EvidenceList } from './Evidence';
import { useUI } from '../ctx';

const LABEL: Record<string, string> = {
  title: 'Title', owner_id: 'Owner', supporters: 'Supporters', workstream: 'Workstream', due_date: 'Due date',
  deliverable: 'Deliverable', priority: 'Priority', col: 'Column', blocked: 'Blocked', blocker: 'Blocker', dependencies: 'Dependencies',
};

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { board, move } = useUI();
  const live = board.tasks.find((t) => t.id === taskId);
  const [base, setBase] = useState<Task | undefined>(live);
  const [draft, setDraft] = useState<TaskDraft | undefined>(live ? toDraft(live) : undefined);
  const [message, setMessage] = useState('');
  const [comment, setComment] = useState('');
  const [conflict, setConflict] = useState<{ latest: Task; choices: Record<string, 'mine' | 'theirs'>; fields: (keyof TaskDraft)[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = base && draft ? changedFields(toDraft(base), draft).length > 0 : false;
  const incoming = !!(live && base && live.version > base.version && dirty);

  // Adopt other people's saves silently while the form has no unsaved edits.
  useEffect(() => {
    if (live && base && live.version !== base.version && !dirty) { setBase(live); setDraft(toDraft(live)); }
  }, [live?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const taskActivity = useMemo(() => board.activity.filter((a) => a.task_id === taskId && a.entity === 'task'), [board.activity, taskId]);
  const taskComments = useMemo(() => board.comments.filter((c) => c.task_id === taskId), [board.comments, taskId]);

  if (!live || !base || !draft) {
    return <Modal title="Task" onClose={onClose}><p>This task no longer exists (it may have been deleted by a teammate).</p></Modal>;
  }

  const errors = validateDraft(draft);

  async function save(from: Task, mine: TaskDraft) {
    const patch = Object.fromEntries(changedFields(toDraft(from), mine).map((f) => [f, mine[f]])) as Partial<TaskDraft>;
    if (patch.blocked === false) patch.blocker = null;
    const r = await board.saveTask(from, patch);
    if (r.ok) { setBase(r.task); setDraft(toDraft(r.task)); setConflict(null); setMessage('Saved.'); return; }
    if (r.reason === 'invalid') { setMessage(r.message); return; }
    if (r.reason === 'deleted') { setMessage('This task was deleted by someone else.'); return; }
    // Someone saved first: merge what can be merged, ask about the rest.
    const { merged, conflicts } = threeWayMerge(toDraft(from), mine, toDraft(r.latest));
    if (conflicts.length === 0) {
      setBase(r.latest);
      setMessage(`Merged with changes from ${board.actorName(r.latest.updated_by)}.`);
      await save(r.latest, merged);
    } else {
      setBase(r.latest);
      setDraft({ ...merged, ...Object.fromEntries(conflicts.map((f) => [f, mine[f]])) });
      setConflict({ latest: r.latest, fields: conflicts, choices: Object.fromEntries(conflicts.map((f) => [f, 'theirs'])) });
    }
  }

  async function resolve() {
    if (!conflict) return;
    const mine: any = { ...draft };
    for (const f of conflict.fields) if (conflict.choices[f] === 'theirs') mine[f] = conflict.latest[f];
    await save(conflict.latest, mine);
  }

  const mineDraft = draft;
  const show = (f: keyof TaskDraft, v: unknown): string => {
    if (f === 'owner_id') return board.person(v as string)?.initial ?? '?';
    if (f === 'supporters') return (v as string[]).map((i) => board.person(i)?.initial ?? '?').join(', ') || 'none';
    if (f === 'due_date') return formatDate(v as string);
    if (f === 'col') return colTitle(v as string);
    if (f === 'blocked') return v ? 'Blocked' : 'Not blocked';
    return String(v ?? '') || '(empty)';
  };

  return (
    <div className="drawer-wrap" onKeyDown={(e) => e.key === 'Escape' && !conflict && onClose()}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Task: ${live.title}`}>
        <header className="drawer-head">
          <div>
            <h2>{live.title}</h2>
            <div className="card-row"><span className="tag">{colTitle(live.col)}</span><Badges task={live} today={board.today} /></div>
          </div>
          <button onClick={onClose} aria-label="Close task panel">✕</button>
        </header>
        <p className="muted small-text">
          Last changed by {board.actorName(live.updated_by)} · {formatStamp(live.updated_at)}
        </p>

        {incoming && (
          <div className="conflict-note" role="status">
            {board.actorName(live.updated_by)} just saved changes to this task. Your edits are kept; when you save they’ll be merged, and you’ll be asked about any field you both changed.
          </div>
        )}

        <div className="row">
          <label className="grow">Move to
            <select value={live.col} onChange={(e) => move(live, e.target.value as Task['col'])}>
              {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          {live.col === 'completed' && <button onClick={() => move(live, 'in_progress')}>Reopen task</button>}
        </div>

        <TaskFields d={draft} set={(p) => { setDraft({ ...draft, ...p }); setMessage(''); }} people={board.people} errors={dirty ? errors : {}} lockBlocked={live.col === 'completed'} />

        <div className="row">
          <button className="primary" disabled={!dirty || board.saving > 0 || Object.keys(errors).length > 0} onClick={() => save(base, mineDraft)}>
            {board.saving > 0 ? 'Saving…' : 'Save changes'}
          </button>
          <button disabled={!dirty} onClick={() => { setDraft(toDraft(live)); setBase(live); setMessage(''); }}>Discard edits</button>
          {dirty && <span className="muted" role="status">Unsaved changes</span>}
          {!dirty && message && <span role="status" className="form-ok">{message}</span>}
        </div>
        {dirty && message && <p className="form-err" role="alert">{message}</p>}

        <section>
          <h3>Evidence & results</h3>
          <p className="muted small-text">Required before this task can be Completed. A link, or a written reference to test data, a schematic, code or a reviewed document.</p>
          <EvidenceList task={live} />
          <AddEvidence task={live} />
        </section>

        <section>
          <h3>Comments</h3>
          {taskComments.length === 0 && <p className="muted">No comments yet.</p>}
          <ul className="comments">
            {taskComments.map((c) => (
              <li key={c.id}><strong>{board.actorName(c.author_id)}</strong> <span className="muted">{formatStamp(c.created_at)}</span><p>{c.body}</p></li>
            ))}
          </ul>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await board.addComment(taskId, comment); setComment(''); }}>
            <label className="grow"><span className="sr-only">New comment</span>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" />
            </label>
            <button disabled={!comment.trim()}>Post</button>
          </form>
        </section>

        <section>
          <h3>Activity</h3>
          <ul className="activity">
            {taskActivity.map((a) => (
              <li key={a.id}>
                <strong>{board.actorName(a.actor_id)}</strong>{' '}
                {a.action === 'created' ? 'created this task' : a.action === 'deleted' ? 'deleted this task' : describeChange(a.detail, board.people).join('; ')}
                <span className="muted"> · {formatStamp(a.at)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="danger-zone">
          {!confirmDelete ? (
            <button className="danger" onClick={() => setConfirmDelete(true)}>Delete task…</button>
          ) : (
            <div className="row">
              <span>Delete “{live.title}” for everyone?</span>
              <button className="danger" onClick={async () => { await board.deleteTask(live.id); onClose(); }}>Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)}>Keep</button>
            </div>
          )}
        </section>
      </aside>

      {conflict && (
        <Modal title="Someone changed this task while you were editing" onClose={() => { /* must choose */ }} wide>
          <p>{board.actorName(conflict.latest.updated_by)} saved at {formatStamp(conflict.latest.updated_at)}. Changes to other fields were merged automatically. For the fields below, you both changed the same thing — choose which to keep.</p>
          <table className="conflict-table">
            <thead><tr><th>Field</th><th>Theirs (saved)</th><th>Yours</th></tr></thead>
            <tbody>
              {conflict.fields.map((f) => (
                <tr key={f}>
                  <th scope="row">{LABEL[f]}</th>
                  {(['theirs', 'mine'] as const).map((side) => (
                    <td key={side}>
                      <label className="radio-row">
                        <input type="radio" name={`c-${f}`} checked={conflict.choices[f] === side}
                          onChange={() => setConflict({ ...conflict, choices: { ...conflict.choices, [f]: side } })} />
                        {show(f, side === 'theirs' ? conflict.latest[f] : mineDraft[f])}
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row end">
            <button onClick={() => { setDraft(toDraft(conflict.latest)); setBase(conflict.latest); setConflict(null); }}>Discard my edits</button>
            <button className="primary" onClick={resolve}>Save my choices</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

