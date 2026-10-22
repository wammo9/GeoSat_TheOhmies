import type { Person, TaskDraft } from '../types';
import { PRIORITIES, COLUMNS, type DraftErrors } from '../lib/rules';
import WORKSTREAMS from '../../config/workstreams.json';

/** Shared field set for creating and editing a task. */
export function TaskFields({ d, set, people, errors, lockBlocked, showColumn }: {
  d: TaskDraft; set: (p: Partial<TaskDraft>) => void; people: Person[]; errors: DraftErrors; lockBlocked?: boolean; showColumn?: boolean;
}) {
  const active = people.filter((p) => p.active || p.id === d.owner_id || d.supporters.includes(p.id));
  const err = (k: keyof TaskDraft) => errors[k] && <span className="field-err" role="alert">{errors[k]}</span>;
  return (
    <div className="fields">
      <label>Title <span className="req">required</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!errors.title} />
        {err('title')}
      </label>
      <div className="grid2">
        <label>Accountable owner <span className="req">required</span>
          <select value={d.owner_id} onChange={(e) => set({ owner_id: e.target.value, supporters: d.supporters.filter((s) => s !== e.target.value) })} aria-invalid={!!errors.owner_id}>
            <option value="">Choose one…</option>
            {active.map((p) => <option key={p.id} value={p.id}>{p.initial}{p.name && p.name !== p.initial ? ` — ${p.name}` : ''}{p.active ? '' : ' (inactive)'}</option>)}
          </select>
          {err('owner_id')}
        </label>
        <label>Due date <span className="req">required</span>
          <input type="date" value={d.due_date} onChange={(e) => set({ due_date: e.target.value })} aria-invalid={!!errors.due_date} />
          {err('due_date')}
        </label>
      </div>
      <label>Concrete deliverable <span className="req">required</span>
        <textarea rows={2} value={d.deliverable} placeholder="What will exist when this is done? e.g. “Reviewed schematic PDF”" onChange={(e) => set({ deliverable: e.target.value })} aria-invalid={!!errors.deliverable} />
        {err('deliverable')}
      </label>
      <div className="grid2">
        <label>Workstream
          <select value={d.workstream} onChange={(e) => set({ workstream: e.target.value })}>
            {WORKSTREAMS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={d.priority} onChange={(e) => set({ priority: e.target.value as TaskDraft['priority'] })}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      </div>
      {showColumn && (
        <label>Column
          <select value={d.col} onChange={(e) => set({ col: e.target.value as TaskDraft['col'] })}>
            {COLUMNS.filter((c) => c.id !== 'completed').map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      )}
      <fieldset>
        <legend>Supporting teammates <span className="muted">(optional)</span></legend>
        <div className="checks">
          {active.filter((p) => p.id !== d.owner_id).map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={d.supporters.includes(p.id)}
                onChange={(e) => set({ supporters: e.target.checked ? [...d.supporters, p.id] : d.supporters.filter((s) => s !== p.id) })} />
              {p.initial}
            </label>
          ))}
        </div>
        {err('supporters')}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={d.blocked} disabled={lockBlocked} onChange={(e) => set({ blocked: e.target.checked })} />
        Blocked {lockBlocked && <span className="muted">(cleared when a task is completed)</span>}
      </label>
      {d.blocked && (
        <label>What is blocking this? <span className="req">required</span>
          <textarea rows={2} value={d.blocker ?? ''} onChange={(e) => set({ blocker: e.target.value })} aria-invalid={!!errors.blocker} />
          {err('blocker')}
        </label>
      )}
      <label>Integration dependencies <span className="muted">(optional)</span>
        <textarea rows={2} value={d.dependencies ?? ''} placeholder="What other work or hardware must this line up with?" onChange={(e) => set({ dependencies: e.target.value })} />
      </label>
    </div>
  );
}
