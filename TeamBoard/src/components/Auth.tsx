import { useState } from 'react';
import { supabase as sb, errMsg } from '../supabase';
import TEAM from '../../config/team.json';
import { Wave } from './Shell';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-head"><h1>GeoSat Team Board</h1><Wave /></div>
      <main className="auth-card">{children}</main>
    </div>
  );
}

export function SetupNeeded() {
  return (
    <Frame>
      <h2>Backend setup needed</h2>
      <p>This site is <strong>not collaborative yet</strong>: no database is connected.</p>
      <ol>
        <li>Create a Supabase project and run <code>db/schema.sql</code> in its SQL editor.</li>
        <li>Copy <code>.env.example</code> to <code>.env</code> and fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>Restart the dev server (or rebuild and redeploy).</li>
      </ol>
      <p>See <code>README.md</code> for the full checklist.</p>
    </Frame>
  );
}

export function Splash({ text, children }: { text: string; children?: React.ReactNode }) {
  return <Frame>{text && <div className="center-note" role="status"><div className="spinner" aria-hidden="true" />{text}</div>}{children}</Frame>;
}

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) setMsg({ kind: 'ok', text: 'Check your email to confirm your address, then sign in.' });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      <h2>{mode === 'in' ? 'Sign in' : 'Create your account'}</h2>
      <p className="muted">Team members only. Use the email address your team lead invited.</p>
      <form onSubmit={submit} className="stack">
        <label>Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p className={msg.kind === 'err' ? 'form-err' : 'form-ok'} role="alert">{msg.text}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="muted">
        {mode === 'in' ? 'First time here? ' : 'Already have an account? '}
        <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
          {mode === 'in' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </Frame>
  );
}

export function NotOnTeam({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <Frame>
      <h2>You’re not on this team yet</h2>
      <p>The signed-in account <strong>{email}</strong> hasn’t been invited. Ask a team admin to add this email address on the Team page, then sign in again.</p>
      <button onClick={onSignOut}>Sign out</button>
    </Frame>
  );
}

export function Bootstrap({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
  const [name, setName] = useState('GeoSat Capstone Team');
  const [mine, setMine] = useState(TEAM[0].initial);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const people = TEAM.map((t) => ({ initial: t.initial, name: t.initial, color: t.hex, role: t.role, focus: t.focus }));
    const invites = TEAM.filter((t) => t.initial !== mine && emails[t.initial]?.trim()).map((t) => ({ initial: t.initial, email: emails[t.initial] }));
    const { error } = await sb.rpc('bootstrap_workspace', { p_name: name, p_my_initial: mine, p_people: people, p_invites: invites });
    setBusy(false);
    if (error) setErr(error.message === 'workspace_exists' ? 'A workspace already exists. Ask its admin to invite you.' : error.message);
    else onDone();
  }

  return (
    <Frame>
      <h2>Set up your team workspace</h2>
      <p>You’re the first person here, so you’ll become the workspace admin. This can only be done once.</p>
      <form onSubmit={create} className="stack">
        <label>Team name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <fieldset>
          <legend>Which teammate are you? (<span className="muted">{email}</span>)</legend>
          {TEAM.map((t) => (
            <label key={t.initial} className="radio-row">
              <input type="radio" name="me" checked={mine === t.initial} onChange={() => setMine(t.initial)} />
              <strong>{t.initial}</strong> — {t.role}; {t.focus}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Invite teammates by email (optional — you can do this later)</legend>
          {TEAM.filter((t) => t.initial !== mine).map((t) => (
            <label key={t.initial}>{t.initial} — {t.role}
              <input type="email" placeholder="teammate@school.edu" value={emails[t.initial] ?? ''}
                onChange={(e) => setEmails({ ...emails, [t.initial]: e.target.value })} />
            </label>
          ))}
        </fieldset>
        {err && <p className="form-err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
      </form>
      <p><button className="link" onClick={onSignOut}>Sign out</button></p>
    </Frame>
  );
}
