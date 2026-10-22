import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, errMsg, supabase as sb } from './supabase';
import { useBoard } from './useBoard';
import { UICtx } from './ctx';
import type { ColId, Task } from './types';
import { EMPTY_FILTERS, matches, type Filters } from './lib/filters';
import { AuthScreen, Bootstrap, NotOnTeam, SetupNeeded, Splash } from './components/Auth';
import { Header, Toasts, type View } from './components/Shell';
import { Spinner } from './components/Chips';
import { Summaries } from './components/Summaries';
import { FilterBar } from './components/Filters';
import { Roster } from './components/Roster';
import { KanbanBoard } from './components/Board';
import { TaskDetail } from './components/TaskDetail';
import { NewTask } from './components/NewTask';
import { EvidencePrompt } from './components/Evidence';
import { TuesdayPlanning, ThursdayReview } from './components/Planning';
import { AllTasks } from './components/AllTasks';
import { CalendarView } from './components/Calendar';
import { Team } from './components/Team';

export default function App() {
  return configured ? <Authed /> : <SetupNeeded />;
}

function Authed() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <Splash text="Loading…" />;
  if (!session) return <AuthScreen />;
  return <Gate key={session.user.id} session={session} />;
}

type GateState = { kind: 'checking' } | { kind: 'bootstrap' } | { kind: 'denied' } | { kind: 'error'; msg: string } | { kind: 'ready'; ws: string };

function Gate({ session }: { session: Session }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const signOut = () => sb.auth.signOut();

  const check = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const own = await sb.from('members').select('workspace_id').eq('user_id', session.user.id).maybeSingle();
      if (own.error) throw own.error;
      if (own.data) return setState({ kind: 'ready', ws: own.data.workspace_id });
      const claimed = await sb.rpc('claim_invite');
      if (claimed.error) throw claimed.error;
      if (claimed.data) return setState({ kind: 'ready', ws: claimed.data as string });
      const has = await sb.rpc('has_workspace');
      if (has.error) throw has.error;
      setState({ kind: has.data ? 'denied' : 'bootstrap' });
    } catch (e) {
      setState({ kind: 'error', msg: errMsg(e) });
    }
  }, [session.user.id]);
  useEffect(() => { check(); }, [check]);

  const email = session.user.email ?? '';
  switch (state.kind) {
    case 'checking': return <Splash text="Checking your team access…" />;
    case 'bootstrap': return <Bootstrap email={email} onDone={check} onSignOut={signOut} />;
    case 'denied': return <NotOnTeam email={email} onSignOut={signOut} />;
    case 'error':
      return (
        <Splash text="">
          <p className="form-err" role="alert">Could not reach the database: {state.msg}</p>
          <button onClick={check}>Try again</button> <button onClick={signOut}>Sign out</button>
        </Splash>
      );
    case 'ready': return <Workspace ws={state.ws} session={session} />;
  }
}

function Workspace({ ws, session }: { ws: string; session: Session }) {
  const board = useBoard(ws, session.user.id);
  const [view, setView] = useState<View>('board');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<Task | null>(null);

  const move = useCallback(async (task: Task, col: ColId) => {
    const r = await board.moveTask(task, col);
    if (r === 'needs-evidence') setEvidenceFor(task);
  }, [board]);

  const ui = useMemo(() => ({ board, openTask: setOpenId, move }), [board, move]);
  const filtered = useMemo(
    () => board.tasks.filter((t) => matches(t, filters, board.today, board.people)),
    [board.tasks, filters, board.today, board.people],
  );
  const demoCount = board.tasks.filter((t) => t.is_demo).length;
  const evidenceTask = evidenceFor ? board.tasks.find((t) => t.id === evidenceFor.id) ?? evidenceFor : null;

  return (
    <UICtx.Provider value={ui}>
      <Header view={view} setView={setView} board={board} email={session.user.email ?? ''} onSignOut={() => sb.auth.signOut()} onNew={() => setCreating(true)} />
      <Toasts board={board} />
      <main className="page">
        {board.loading || !board.summary ? (
          <Spinner label="Loading the team board…" />
        ) : (
          <>
            {demoCount > 0 && (
              <div className="demo-banner" role="note">
                <strong>DEMO DATA</strong> — {demoCount} example task{demoCount === 1 ? ' is' : 's are'} on the board, marked DEMO. They are not real team work.
                <button className="small" onClick={() => setView('team')}>Manage demo data</button>
              </div>
            )}
            {view !== 'team' && view !== 'calendar' && <Summaries />}

            {view === 'board' && (
              <>
                <Roster picked={filters.owner} onPick={(id) => setFilters({ ...filters, owner: filters.owner === id ? '' : id })} />
                <FilterBar f={filters} set={setFilters} shown={filtered.length} total={board.tasks.length} />
                {board.tasks.length === 0 ? (
                  <div className="empty-board">
                    <h2>The board is empty</h2>
                    <p>Add your first task, or load clearly-labeled demo tasks to try things out.</p>
                    <div className="row"><button className="primary" onClick={() => setCreating(true)}>+ New task</button><button onClick={() => board.loadDemo()}>Load demo tasks</button></div>
                  </div>
                ) : (
                  <KanbanBoard tasks={filtered} allTasks={board.tasks} />
                )}
              </>
            )}
            {view === 'tuesday' && <TuesdayPlanning />}
            {view === 'thursday' && <ThursdayReview />}
            {view === 'calendar' && (
              <>
                <FilterBar f={filters} set={setFilters} shown={filtered.length} total={board.tasks.length} />
                <CalendarView tasks={filtered} />
              </>
            )}
            {view === 'all' && (
              <>
                <FilterBar f={filters} set={setFilters} shown={filtered.length} total={board.tasks.length} />
                <AllTasks tasks={filtered} />
              </>
            )}
            {view === 'team' && <Team />}
          </>
        )}
      </main>
      {openId && <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />}
      {creating && <NewTask onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
      {evidenceTask && <EvidencePrompt task={evidenceTask} onClose={() => setEvidenceFor(null)} />}
    </UICtx.Provider>
  );
}
