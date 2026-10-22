import type { Filters } from '../lib/filters';
import { EMPTY_FILTERS, isFiltering } from '../lib/filters';
import { PRIORITIES } from '../lib/rules';
import WORKSTREAMS from '../../config/workstreams.json';
import { useUI } from '../ctx';

export function FilterBar({ f, set, shown, total }: { f: Filters; set: (f: Filters) => void; shown: number; total: number }) {
  const { board } = useUI();
  const up = (p: Partial<Filters>) => set({ ...f, ...p });
  return (
    <form className="filters" role="search" aria-label="Filter tasks" onSubmit={(e) => e.preventDefault()}>
      <label className="grow">Search
        <input type="search" value={f.q} placeholder="Title, deliverable, evidence…" onChange={(e) => up({ q: e.target.value })} />
      </label>
      <label>Owner
        <select value={f.owner} onChange={(e) => up({ owner: e.target.value })}>
          <option value="">Everyone</option>
          {board.people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.initial}{p.name && p.name !== p.initial ? ` — ${p.name}` : ''}</option>)}
        </select>
      </label>
      <label>Workstream
        <select value={f.workstream} onChange={(e) => up({ workstream: e.target.value })}>
          <option value="">All</option>
          {WORKSTREAMS.map((w) => <option key={w}>{w}</option>)}
        </select>
      </label>
      <label>Due
        <select value={f.due} onChange={(e) => up({ due: e.target.value as Filters['due'] })}>
          <option value="any">Any time</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="week">Next 7 days</option>
          <option value="later">Later</option>
        </select>
      </label>
      <label>Priority
        <select value={f.priority} onChange={(e) => up({ priority: e.target.value })}>
          <option value="">Any</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label>Blocked
        <select value={f.blocked} onChange={(e) => up({ blocked: e.target.value as Filters['blocked'] })}>
          <option value="any">Any</option>
          <option value="blocked">Blocked only</option>
          <option value="unblocked">Not blocked</option>
        </select>
      </label>
      <div className="filter-meta" aria-live="polite">
        Showing {shown} of {total}
        {isFiltering(f) && <button type="button" className="link" onClick={() => set(EMPTY_FILTERS)}>Clear filters</button>}
      </div>
    </form>
  );
}
