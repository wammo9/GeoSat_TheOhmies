import { useState } from 'react';
import type { Task } from '../types';
import { byDueThenPriority } from '../lib/filters';
import { colTitle, hasEvidence, isOpen, isOverdue } from '../lib/rules';
import { addDays, formatDate, nextWeekday, TUESDAY, THURSDAY } from '../lib/dates';
import { Badges, DueDate, OwnerChip } from './Chips';
import { AddEvidence, EvidenceList } from './Evidence';
import { useUI } from '../ctx';

export function TuesdayPlanning() {
  const { board, openTask, move } = useUI();
  const open = board.tasks.filter(isOpen);
  const committed = open.filter((t) => t.col === 'tuesday').sort(byDueThenPriority);
  const review = open.filter((t) => t.col !== 'tuesday')
    .sort((a, b) => Number(isOverdue(b, board.today)) - Number(isOverdue(a, board.today)) || byDueThenPriority(a, b));
  const tue = nextWeekday(board.today, TUESDAY);

  const Row = ({ t, commit }: { t: Task; commit: boolean }) => (
    <li className="plan-row">
      <div className="plan-main">
        <button className="card-title" onClick={() => openTask(t.id)}>{t.title}</button>
        <div className="card-row"><OwnerChip person={board.person(t.owner_id)} /><DueDate task={t} today={board.today} /><span className="tag">{t.workstream}</span><span className="tag">{colTitle(t.col)}</span><Badges task={t} today={board.today} /></div>
        <p className="muted small-text">Deliverable: {t.deliverable}</p>
        {t.blocked && <p className="card-blocker">Blocked: {t.blocker}</p>}
      </div>
      {commit
        ? <button className="primary small" onClick={() => move(t, 'tuesday')}>Commit for Thursday</button>
        : <button className="small" onClick={() => move(t, 'backlog')}>Remove commitment</button>}
    </li>
  );

  const perPerson = board.people.filter((p) => p.active).map((p) => ({ p, n: committed.filter((t) => t.owner_id === p.id).length }));

  return (
    <div className="view-grid">
      <section className="panel">
        <h2>Unfinished work to review</h2>
        <p className="muted">Everything not finished, oldest due dates first. Pick what each person commits to deliver by Thursday, {formatDate(board.thursday)}. Nothing here changes automatically.</p>
        <ul className="plan-list">{review.map((t) => <Row key={t.id} t={t} commit />)}</ul>
        {review.length === 0 && <p className="col-empty">Nothing unfinished — nice.</p>}
      </section>
      <section className="panel">
        <h2>Committed for Thursday <span className="count">{committed.length}</span></h2>
        <p className="muted">Tuesday meeting: {formatDate(tue)} · Thursday review: {formatDate(board.thursday)}</p>
        <p className="commit-counts">{perPerson.map(({ p, n }) => <span key={p.id} className="tag">{p.initial}: {n}</span>)}</p>
        <ul className="plan-list">{committed.map((t) => <Row key={t.id} t={t} commit={false} />)}</ul>
        {committed.length === 0 && <p className="col-empty">No commitments yet. Choose tasks from the left.</p>}
      </section>
    </div>
  );
}

function ReviewRow({ t }: { t: Task }) {
  const { board, openTask, move } = useUI();
  const [dep, setDep] = useState(t.dependencies ?? '');
  const [carry, setCarry] = useState(false);
  const [due, setDue] = useState(addDays(t.due_date < board.today ? board.today : t.due_date, 7));
  const depDirty = dep.trim() !== (t.dependencies ?? '').trim();

  return (
    <li className="review-row">
      <div className="card-row">
        <button className="card-title" onClick={() => openTask(t.id)}>{t.title}</button>
        <OwnerChip person={board.person(t.owner_id)} /><DueDate task={t} today={board.today} /><span className="tag">{colTitle(t.col)}</span><Badges task={t} today={board.today} />
      </div>
      <p><strong>Deliverable:</strong> {t.deliverable}</p>
      {t.blocked && <p className="card-blocker">Blocked: {t.blocker}</p>}
      <div className="review-cols">
        <div>
          <h4>Deliverable &amp; where it is</h4>
          <EvidenceList task={t} />
          <AddEvidence task={t} />
        </div>
        <div>
          <h4>Integration dependencies</h4>
          <textarea rows={3} aria-label={`Integration dependencies for ${t.title}`} value={dep} onChange={(e) => setDep(e.target.value)} placeholder="What does this need from, or hand to, other workstreams?" />
          <button className="small" disabled={!depDirty || board.saving > 0}
            onClick={async () => {
              const r = await board.saveTask(t, { dependencies: dep.trim() || null });
              if (!r.ok) board.setError(r.reason === 'conflict' ? 'Someone else just changed this task. Your dependency note is still in the box; review the latest and save again.' : r.reason === 'deleted' ? 'Task was deleted.' : r.message);
            }}>Save dependencies</button>
        </div>
      </div>
      <div className="row">
        {t.col !== 'thursday' && <button className="small" onClick={() => move(t, 'thursday')}>Move to Thursday Review</button>}
        <button className="primary small" onClick={() => move(t, 'completed')} title={hasEvidence(t.evidence) ? '' : 'You’ll be asked whether there was a deliverable'}>
          Mark complete
        </button>
        <button className="small" onClick={() => setCarry(!carry)} aria-expanded={carry}>Carry forward…</button>
      </div>
      {carry && (
        <form className="row carry" onSubmit={async (e) => { e.preventDefault(); if (await board.carryForward(t, due)) setCarry(false); }}>
          <label>Revised due date (required)<input type="date" value={due} min={addDays(t.due_date, 1)} onChange={(e) => setDue(e.target.value)} /></label>
          <button className="primary small">Carry forward to {due ? formatDate(due) : '…'}</button>
          <span className="muted small-text">Moves to Backlog with the new date; a comment records it.</span>
        </form>
      )}
    </li>
  );
}

export function ThursdayReview() {
  const { board } = useUI();
  const list = board.tasks.filter((t) => ['tuesday', 'in_progress', 'thursday'].includes(t.col))
    .sort((a, b) => Number(b.col === 'thursday') - Number(a.col === 'thursday') || byDueThenPriority(a, b));
  const withDeps = board.tasks.filter((t) => isOpen(t) && t.dependencies?.trim());
  return (
    <div className="stack">
      <section className="panel">
        <h2>Thursday review — {formatDate(nextWeekday(board.today, THURSDAY))}</h2>
        <p className="muted">Inspect each deliverable, record where each deliverable is, note integration dependencies, then complete the task or explicitly carry it forward with a revised due date. Due dates and columns never change on their own.</p>
        {withDeps.length > 0 && (
          <details className="deps">
            <summary>Integration dependencies across the board ({withDeps.length})</summary>
            <ul>{withDeps.map((t) => <li key={t.id}><strong>{t.title}</strong> ({board.person(t.owner_id)?.initial}): {t.dependencies}</li>)}</ul>
          </details>
        )}
        <ul className="review-list">{list.map((t) => <ReviewRow key={t.id} t={t} />)}</ul>
        {list.length === 0 && <p className="col-empty">Nothing is committed, in progress, or awaiting review.</p>}
      </section>
    </div>
  );
}
