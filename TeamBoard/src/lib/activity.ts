import type { Person } from '../types';
import { colTitle } from './rules';
import { formatDate } from './dates';

const LABEL: Record<string, string> = {
  title: 'title', owner_id: 'owner', supporters: 'supporting teammates', workstream: 'workstream',
  due_date: 'due date', deliverable: 'deliverable', priority: 'priority', col: 'column',
  blocked: 'blocked flag', blocker: 'blocker description', dependencies: 'integration dependencies',
  evidence: 'evidence', is_demo: 'demo flag', start_date: 'start date', event_id: 'linked event',
};

const short = (s: unknown) => {
  const t = String(s ?? '').trim();
  return t ? (t.length > 60 ? `“${t.slice(0, 57)}…”` : `“${t}”`) : 'empty';
};

/** One readable sentence fragment per changed field. */
export function describeChange(detail: Record<string, any> | null, people: Person[]): string[] {
  if (!detail) return [];
  const who = (id: string) => people.find((p) => p.id === id)?.initial ?? '?';
  const out: string[] = [];
  for (const [k, v] of Object.entries(detail)) {
    const from = v?.from, to = v?.to;
    switch (k) {
      case 'col': out.push(`moved from ${colTitle(from)} to ${colTitle(to)}`); break;
      case 'owner_id': out.push(`changed owner from ${who(from)} to ${who(to)}`); break;
      case 'supporters': out.push(`set supporters to ${(to as string[]).map(who).join(', ') || 'none'}`); break;
      case 'due_date': out.push(`changed due date from ${formatDate(from)} to ${formatDate(to)}`); break;
      case 'start_date': out.push(`changed start date from ${from ? formatDate(from) : 'none'} to ${to ? formatDate(to) : 'none'}`); break;
      case 'event_id': out.push(to ? 'linked to a calendar event' : 'unlinked from a calendar event'); break;
      case 'blocked': out.push(to ? 'flagged as blocked' : 'cleared the blocked flag'); break;
      case 'evidence': {
        const a = (from ?? []).length, b = (to ?? []).length;
        out.push(b > a ? 'added evidence' : b < a ? 'removed evidence' : 'edited evidence');
        break;
      }
      default: out.push(`changed ${LABEL[k] ?? k} from ${short(from)} to ${short(to)}`);
    }
  }
  return out;
}
