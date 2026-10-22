import { useState } from 'react';
import type { Person } from '../types';
import { formatStamp } from '../lib/dates';
import { OwnerChip } from './Chips';
import { useUI } from '../ctx';

function PersonRow({ p }: { p: Person }) {
  const { board } = useUI();
  const [d, setD] = useState({ name: p.name ?? '', initial: p.initial, color: p.color, role: p.role ?? '', focus: p.focus ?? '' });
  const dirty = d.name !== (p.name ?? '') || d.initial !== p.initial || d.color !== p.color || d.role !== (p.role ?? '') || d.focus !== (p.focus ?? '');
  const linked = board.members.find((m) => m.user_id === p.user_id);
  return (
    <li className={`person-row${p.active ? '' : ' inactive'}`}>
      <div className="person-head">
        <OwnerChip person={{ ...p, ...d }} />
        <span className="muted">{linked ? `signed in as ${linked.email}` : 'no account linked yet'}{p.active ? '' : ' · inactive'}</span>
      </div>
      <div className="grid4">
        <label>Name<input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label>Initials<input value={d.initial} maxLength={3} onChange={(e) => setD({ ...d, initial: e.target.value })} /></label>
        <label>Color<input type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} /></label>
        <label>Role<input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} /></label>
        <label className="span2">Focus<input value={d.focus} onChange={(e) => setD({ ...d, focus: e.target.value })} /></label>
      </div>
      <div className="row">
        <button className="primary small" disabled={!dirty || board.saving > 0}
          onClick={() => board.savePerson(p, { name: d.name.trim() || null, initial: d.initial.trim(), color: d.color, role: d.role.trim() || null, focus: d.focus.trim() || null })}>Save profile</button>
        <button className="small" onClick={() => board.savePerson(p, { active: !p.active })}>{p.active ? 'Mark inactive' : 'Reactivate'}</button>
      </div>
    </li>
  );
}

export function Team() {
  const { board } = useUI();
  const admin = board.members.find((m) => m.user_id === board.userId)?.is_admin ?? false;
  const [email, setEmail] = useState('');
  const [personId, setPersonId] = useState('');
  const [np, setNp] = useState({ initial: '', name: '', color: '#2BA6A0', role: '', focus: '' });
  const demoCount = board.tasks.filter((t) => t.is_demo).length;
  const log = board.activity.filter((a) => a.entity !== 'task' && a.entity !== 'comment').slice(0, 25);

  const describe = (a: (typeof log)[number]) => {
    const d = a.detail ?? {};
    switch (a.entity) {
      case 'person': return `${a.action === 'insert' ? 'added teammate' : a.action === 'delete' ? 'removed teammate' : 'updated profile of'} ${d.initial ?? ''}`;
      case 'invite': return `${a.action === 'insert' ? 'invited' : 'cancelled invite for'} ${d.email}`;
      case 'member': return a.action === 'joined' ? `${d.email} joined` : `removed ${d.email} from the workspace`;
      case 'summary': return 'updated the weekly goal / milestone / blockers';
      default: return a.action;
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Team profiles</h2>
        <p className="muted">Initials and colors identify owners everywhere on the board. Changes sync to everyone.</p>
        <ul className="person-list">{board.people.map((p) => <PersonRow key={p.id + p.version} p={p} />)}</ul>
        <form className="add-person" onSubmit={async (e) => { e.preventDefault(); await board.addPerson(np); setNp({ ...np, initial: '', name: '', role: '', focus: '' }); }}>
          <h3>Add a teammate</h3>
          <div className="grid4">
            <label>Initials<input required maxLength={3} value={np.initial} onChange={(e) => setNp({ ...np, initial: e.target.value })} /></label>
            <label>Name<input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></label>
            <label>Color<input type="color" value={np.color} onChange={(e) => setNp({ ...np, color: e.target.value })} /></label>
            <label>Role<input value={np.role} onChange={(e) => setNp({ ...np, role: e.target.value })} /></label>
            <label className="span2">Focus<input value={np.focus} onChange={(e) => setNp({ ...np, focus: e.target.value })} /></label>
          </div>
          <button className="small">Add teammate</button>
        </form>
      </section>

      <section className="panel">
        <h2>Who can sign in</h2>
        {!admin && <p className="muted">Only workspace admins can invite or remove accounts.</p>}
        <h3>Members</h3>
        <ul className="plain">
          {board.members.map((m) => (
            <li key={m.user_id} className="row between">
              <span>{m.email} {m.is_admin && <span className="tag">admin</span>} {m.user_id === board.userId && <span className="tag">you</span>}</span>
              {admin && m.user_id !== board.userId && <button className="small danger" onClick={() => confirm(`Remove ${m.email} from the workspace?`) && board.removeMember(m.user_id)}>Remove access</button>}
            </li>
          ))}
        </ul>
        <h3>Pending invites</h3>
        {board.invites.length === 0 && <p className="muted">None.</p>}
        <ul className="plain">
          {board.invites.map((i) => (
            <li key={i.email} className="row between">
              <span>{i.email} {i.person_id && <span className="tag">as {board.person(i.person_id)?.initial}</span>}</span>
              {admin && <button className="small" onClick={() => board.removeInvite(i.email)}>Cancel invite</button>}
            </li>
          ))}
        </ul>
        {admin && (
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await board.addInvite(email, personId || null); setEmail(''); }}>
            <label className="grow">Invite by email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@school.edu" /></label>
            <label>Link to teammate
              <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">(none)</option>
                {board.people.filter((p) => p.active && !p.user_id).map((p) => <option key={p.id} value={p.id}>{p.initial}</option>)}
              </select>
            </label>
            <button className="primary">Send invite</button>
          </form>
        )}
        <p className="muted small-text">Invited people create an account with this exact email, then sign in. No email is sent by this app — tell them directly.</p>
      </section>

      <section className="panel">
        <h2>Sample data</h2>
        {demoCount > 0
          ? <><p><span className="badge demo">DEMO</span> {demoCount} demo task{demoCount === 1 ? '' : 's'} are on the board, marked DEMO.</p>
              <button className="danger" onClick={() => confirm('Delete all demo tasks for everyone? Real tasks are not affected.') && board.removeDemo()}>Remove demo data</button></>
          : <><p className="muted">Load six clearly-labeled example tasks to try the board. They can be removed in one click, and never mix with real work.</p>
              <button onClick={() => board.loadDemo()}>Load demo tasks</button></>}
      </section>

      <section className="panel">
        <h2>Team change log</h2>
        <ul className="activity">
          {log.map((a) => <li key={a.id}><strong>{board.actorName(a.actor_id)}</strong> {describe(a)} <span className="muted">· {formatStamp(a.at)}</span></li>)}
          {log.length === 0 && <li className="muted">No changes yet.</li>}
        </ul>
      </section>
    </div>
  );
}
