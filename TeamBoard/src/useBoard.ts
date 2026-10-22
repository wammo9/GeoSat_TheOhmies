import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errMsg, supabase as sb } from './supabase';
import type { Activity, CalEvent, SlideArchive, ColId, Comment, Evidence, Invite, Member, Person, Summary, Task, TaskDraft } from './types';
import { addDays, nextWeekday, THURSDAY, todayDenver } from './lib/dates';
import DEMO_SEED from '../seed/demo-tasks.json';
import { contentTypeFor, DECK_BUCKET, storagePath } from './lib/files';
import { colTitle, completionError, evidenceFrom, hasEvidence, noDeliverableEvidence, validateDraft } from './lib/rules';

export type Live = 'connecting' | 'live' | 'offline';

export type SaveResult =
  | { ok: true; task: Task }
  | { ok: false; reason: 'conflict'; latest: Task }
  | { ok: false; reason: 'deleted' }
  | { ok: false; reason: 'invalid'; message: string };

const TEAM_ORDER = ['J', 'A', 'W', 'M', 'T', 'B'];
const teamRank = (i: string) => { const n = TEAM_ORDER.indexOf(i.toUpperCase()); return n < 0 ? 99 : n; }; // keep the team's usual order
const TABLES = ['tasks', 'comments', 'activity', 'people', 'workspace_summary', 'members', 'invites', 'events', 'slide_archive'] as const;
type Table = (typeof TABLES)[number];

const DEMO = DEMO_SEED.tasks;

export function useBoard(workspaceId: string, userId: string) {
  const [people, setPeople] = useState<Person[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [slideArchive, setSlideArchive] = useState<SlideArchive[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<Live>('connecting');
  const [liveDetail, setLiveDetail] = useState('');
  const [reconnects, setReconnects] = useState(0);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [today, setToday] = useState(todayDenver());
  const timers = useRef<Partial<Record<Table, number>>>({});
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  // ---------------------------------------------------------------- loading
  const load = useCallback(
    async (t: Table) => {
      const q = (name: string) => sb.from(name).select('*');
      let res;
      switch (t) {
        case 'tasks': res = await q('tasks'); break;
        case 'comments': res = await q('comments').order('created_at'); break;
        case 'activity': res = await q('activity').order('at', { ascending: false }).limit(600); break;
        case 'people': res = await q('people').order('created_at'); break;
        case 'workspace_summary': res = await q('workspace_summary').eq('workspace_id', workspaceId); break;
        case 'members': res = await q('members'); break;
        case 'invites': res = await q('invites'); break;
        case 'events': res = await q('events').order('start_date'); break;
        case 'slide_archive': res = await q('slide_archive').order('submitted_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }); break;
      }
      if (res.error) throw res.error;
      const rows = res.data as any[];
      switch (t) {
        case 'tasks': setTasks(rows); break;
        case 'comments': setComments(rows); break;
        case 'activity': setActivity(rows); break;
        case 'people': setPeople([...rows].sort((a, b) => teamRank(a.initial) - teamRank(b.initial) || a.created_at?.localeCompare(b.created_at ?? '') || 0)); break;
        case 'workspace_summary': setSummary(rows[0] ?? null); break;
        case 'members': setMembers(rows); break;
        case 'invites': setInvites(rows); break;
        case 'events': setEvents(rows); break;
        case 'slide_archive': setSlideArchive(rows); break;
      }
    },
    [workspaceId],
  );

  const refresh = useCallback(
    async (...which: Table[]) => {
      try {
        await Promise.all((which.length ? which : [...TABLES]).map(load));
      } catch (e) {
        setError(`Could not load the latest data: ${errMsg(e)}`);
      }
    },
    [load],
  );

  useEffect(() => {
    let cancelled = false;
    refresh().finally(() => !cancelled && setLoading(false));

    // Realtime: any change anywhere re-reads that table (RLS keeps it private).
    const ch = sb.channel(`board-${workspaceId}`);
    for (const table of TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        window.clearTimeout(timers.current[table]);
        timers.current[table] = window.setTimeout(() => {
          refresh(table);
          if (table === 'tasks') refresh('activity');
          if (table === 'comments' || table === 'events') refresh('activity');
          if (table === 'events') refresh('tasks'); // deleting an event unlinks its tasks
        }, 120);
      });
    }
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        setLive('live');
        setLiveDetail('');
        refresh(); // catch anything missed while disconnected
      } else {
        setLive('offline');
        setLiveDetail(`${status}${err?.message ? `: ${err.message}` : ''}`);
        console.warn('[GeoSat board] live updates disconnected:', status, err);
      }
    });

    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const clock = window.setInterval(() => setToday(todayDenver()), 60_000);
    const safety = window.setInterval(() => refresh(), 60_000); // backstop if a realtime event is dropped
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(clock);
      window.clearInterval(safety);
      Object.values(timers.current).forEach((t) => window.clearTimeout(t));
      sb.removeChannel(ch);
    };
  }, [workspaceId, refresh, reconnects]);

  // ---------------------------------------------------------------- helpers
  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setSaving((n) => n + 1);
    try {
      return await fn();
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    } finally {
      setSaving((n) => n - 1);
    }
  }, []);

  const person = useCallback((id: string | null | undefined) => people.find((p) => p.id === id), [people]);
  const me = useMemo(() => people.find((p) => p.user_id === userId), [people, userId]);

  /** Human name for an auth user id (for "who changed this"). */
  const actorName = useCallback(
    (uid: string | null | undefined): string => {
      if (!uid) return 'Someone';
      const p = people.find((x) => x.user_id === uid);
      if (p) return p.name && p.name !== p.initial ? `${p.name} (${p.initial})` : p.initial;
      return members.find((m) => m.user_id === uid)?.email ?? 'A former member';
    },
    [people, members],
  );

  const fetchTask = async (id: string): Promise<Task | null> => {
    const { data, error } = await sb.from('tasks').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as Task | null;
  };

  // ---------------------------------------------------------------- tasks
  /** Versioned write: succeeds only if nobody saved since `baseVersion`. */
  const updateTask = useCallback(
    async (id: string, baseVersion: number, patch: Partial<Task>): Promise<SaveResult> => {
      const { data, error } = await sb
        .from('tasks')
        .update({ ...patch, version: baseVersion + 1 })
        .eq('id', id)
        .eq('version', baseVersion)
        .select();
      if (error && error.code !== '40001') throw error;
      if (!error && data && data.length === 1) {
        const t = data[0] as Task;
        setTasks((ts) => ts.map((x) => (x.id === id ? t : x)));
        return { ok: true, task: t };
      }
      const latest = await fetchTask(id);
      if (!latest) return { ok: false, reason: 'deleted' };
      setTasks((ts) => ts.map((x) => (x.id === id ? latest : x)));
      return { ok: false, reason: 'conflict', latest };
    },
    [],
  );

  const createTask = useCallback(
    async (d: TaskDraft, demo = false): Promise<Task | undefined> => {
      const errs = validateDraft(d);
      if (Object.keys(errs).length) throw new Error(Object.values(errs)[0]);
      if (d.col === 'completed') throw new Error('New tasks cannot start as Completed; say whether there was a deliverable first.');
      return track(async () => {
        const { data, error } = await sb
          .from('tasks')
          .insert({ ...d, title: d.title.trim(), deliverable: d.deliverable.trim(), workspace_id: workspaceId, is_demo: demo })
          .select()
          .single();
        if (error) throw error;
        setTasks((ts) => [...ts, data as Task]);
        return data as Task;
      });
    },
    [track, workspaceId],
  );

  /** Save edited fields. Returns a conflict (with the latest copy) instead of overwriting. */
  const saveTask = useCallback(
    (task: Task, patch: Partial<TaskDraft>): Promise<SaveResult> =>
      track(async (): Promise<SaveResult> => {
        const merged = { ...task, ...patch };
        const errs = validateDraft(merged);
        if (Object.keys(errs).length) return { ok: false, reason: 'invalid', message: Object.values(errs)[0]! };
        if (merged.col === 'completed' && task.col !== 'completed') {
          const msg = completionError(task);
          if (msg) return { ok: false, reason: 'invalid', message: msg };
          patch = { ...patch, blocked: false };
        }
        return updateTask(task.id, task.version, patch);
      }).then((r) => r ?? { ok: false, reason: 'invalid', message: 'Save failed.' }),
    [track, updateTask],
  );

  /** Move between columns. Returns 'needs-evidence' when the "was there a deliverable?" question still has to be answered. */
  const moveTask = useCallback(
    async (task: Task, col: ColId): Promise<'ok' | 'needs-evidence' | 'conflict' | 'error'> => {
      if (task.col === col) return 'ok';
      if (col === 'completed' && !hasEvidence(task.evidence)) return 'needs-evidence';
      const patch: Partial<Task> = { col, ...(col === 'completed' ? { blocked: false } : {}) };
      setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, ...patch } : x))); // optimistic
      const r = await track(() => updateTask(task.id, task.version, patch));
      if (!r) { refresh('tasks'); return 'error'; }
      if (!r.ok) {
        setError(
          r.reason === 'deleted'
            ? `“${task.title}” was deleted by someone else.`
            : `“${task.title}” was changed by someone else just now, so it was not moved to ${colTitle(col)}. Review the latest version and try again.`,
        );
        return 'conflict';
      }
      return 'ok';
    },
    [track, updateTask, refresh],
  );

  /** Append/remove evidence against the latest server copy so concurrent evidence is never lost. */
  const changeEvidence = useCallback(
    (taskId: string, fn: (ev: Evidence[]) => Evidence[]): Promise<Task | undefined> =>
      track(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const cur = await fetchTask(taskId);
          if (!cur) throw new Error('This task was deleted by someone else.');
          const next = fn(cur.evidence);
          if (cur.col === 'completed' && !hasEvidence(next))
            throw new Error('A completed task must keep its deliverable note. Reopen it first.');
          const r = await updateTask(taskId, cur.version, { evidence: next });
          if (r.ok) return r.task;
        }
        throw new Error('Could not save evidence because the task keeps changing. Try again.');
      }),
    [track, updateTask],
  );

  const addEvidence = useCallback(
    (taskId: string, text: string) => {
      if (!text.trim()) { setError('Enter a link or a written reference.'); return Promise.resolve(undefined); }
      const ev = evidenceFrom(text, userId);
      return changeEvidence(taskId, (list) => [...list, ev]);
    },
    [changeEvidence, userId],
  );

  const addNoDeliverable = useCallback(
    (taskId: string) => {
      const ev = noDeliverableEvidence(userId);
      return changeEvidence(taskId, (list) => (list.some((e) => e.type === 'none') ? list : [...list, ev]));
    },
    [changeEvidence, userId],
  );

  const removeEvidence = useCallback(
    (taskId: string, ev: Evidence) =>
      changeEvidence(taskId, (list) => list.filter((e) => !(e.value === ev.value && e.added_at === ev.added_at))),
    [changeEvidence],
  );

  /** Explicit carry-forward: new due date (required), back to Backlog, with a note. */
  const carryForward = useCallback(
    async (task: Task, newDue: string): Promise<boolean> => {
      if (!newDue || newDue <= task.due_date) { setError('Choose a revised due date later than the current one.'); return false; }
      const r = await track(() => updateTask(task.id, task.version, { due_date: newDue, col: 'backlog' }));
      if (!r || !r.ok) { setError('That task changed while you were reviewing it; reload its latest version and try again.'); return false; }
      await track(async () => {
        await sb.from('comments').insert({ workspace_id: workspaceId, task_id: task.id, author_id: userId, body: `Carried forward from ${task.due_date} to ${newDue}.` });
      });
      return true;
    },
    [track, updateTask, workspaceId, userId],
  );

  const deleteTask = useCallback(
    (id: string) =>
      track(async () => {
        const { error } = await sb.from('tasks').delete().eq('id', id);
        if (error) throw error;
        setTasks((ts) => ts.filter((t) => t.id !== id));
      }),
    [track],
  );

  const addComment = useCallback(
    (taskId: string, body: string) =>
      track(async () => {
        if (!body.trim()) return;
        const { error } = await sb.from('comments').insert({ workspace_id: workspaceId, task_id: taskId, author_id: userId, body: body.trim() });
        if (error) throw error;
        await refresh('comments', 'activity');
      }),
    [track, workspaceId, userId, refresh],
  );

  // ---------------------------------------------------------------- calendar events
  type EventFields = Pick<CalEvent, 'title' | 'kind' | 'start_date' | 'end_date' | 'description' | 'is_major' | 'recur' | 'recur_until' | 'recur_skip'>;

  const createEvent = useCallback(
    (d: EventFields): Promise<CalEvent | undefined> =>
      track(async () => {
        const { data, error } = await sb.from('events').insert({ ...d, title: d.title.trim(), workspace_id: workspaceId }).select().single();
        if (error) throw error;
        setEvents((es) => [...es, data as CalEvent]);
        return data as CalEvent;
      }),
    [track, workspaceId],
  );

  /** Versioned event edit: returns the latest copy on a conflict instead of overwriting. */
  const saveEvent = useCallback(
    (id: string, baseVersion: number, patch: Partial<EventFields>) =>
      track(async (): Promise<{ status: 'ok'; event: CalEvent } | { status: 'conflict'; latest: CalEvent } | { status: 'deleted' }> => {
        const { data, error } = await sb.from('events').update({ ...patch, version: baseVersion + 1 }).eq('id', id).eq('version', baseVersion).select();
        if (error && error.code !== '40001') throw error;
        if (!error && data?.length === 1) {
          setEvents((es) => es.map((e) => (e.id === id ? (data[0] as CalEvent) : e)));
          return { status: 'ok', event: data[0] as CalEvent };
        }
        const { data: latest, error: e2 } = await sb.from('events').select('*').eq('id', id).maybeSingle();
        if (e2) throw e2;
        if (!latest) return { status: 'deleted' };
        setEvents((es) => es.map((e) => (e.id === id ? (latest as CalEvent) : e)));
        return { status: 'conflict', latest: latest as CalEvent };
      }),
    [track],
  );

  const deleteEvent = useCallback(
    (id: string) =>
      track(async () => {
        const { error } = await sb.from('events').delete().eq('id', id);
        if (error) throw error;
        setEvents((es) => es.filter((e) => e.id !== id));
        await refresh('tasks', 'activity'); // linked tasks were unlinked by the database
      }),
    [track, refresh],
  );

  /** Link/unlink one task. Only touches event_id, against the latest copy, so it never reverts other edits. */
  const setTaskEvent = useCallback(
    (taskId: string, eventId: string | null): Promise<boolean> =>
      track(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const cur = await fetchTask(taskId);
          if (!cur) throw new Error('A task you were linking was deleted by someone else.');
          if (cur.event_id === eventId) return true;
          const r = await updateTask(taskId, cur.version, { event_id: eventId });
          if (r.ok) return true;
        }
        throw new Error('Could not update a task link because the task keeps changing. Try again.');
      }).then((r) => !!r),
    [track, updateTask],
  );

  // ---------------------------------------------------------------- summary
  const saveSummary = useCallback(
    (baseVersion: number, patch: Partial<Summary>): Promise<{ status: 'ok' } | { status: 'conflict'; latest: Summary } | undefined> =>
      track(async () => {
        const { data, error } = await sb
          .from('workspace_summary')
          .update({ ...patch, version: baseVersion + 1 })
          .eq('workspace_id', workspaceId)
          .eq('version', baseVersion)
          .select();
        if (error && error.code !== '40001') throw error;
        if (!error && data?.length === 1) { setSummary(data[0] as Summary); return { status: 'ok' as const }; }
        const { data: latest, error: e2 } = await sb.from('workspace_summary').select('*').eq('workspace_id', workspaceId).single();
        if (e2) throw e2;
        setSummary(latest as Summary);
        return { status: 'conflict' as const, latest: latest as Summary };
      }),
    [track, workspaceId, refresh],
  );

  // ---------------------------------------------------------------- customer slides
  /**
   * Upload a new submitted deck and, in one step, file the current one in the archive.
   * If someone else changed the slides first, nothing is replaced and the uploaded file is removed again.
   */
  const submitSlidesCopy = useCallback(
    (file: File, submittedOn: string, baseVersion: number): Promise<'ok' | 'conflict' | undefined> =>
      track(async () => {
        const path = storagePath(workspaceId, file.name, crypto.randomUUID());
        // Browsers often report an empty type for .pptx; the upload uses the file's own type, so set it explicitly.
        const typed = new File([file], file.name, { type: contentTypeFor(file.name) });
        const up = await sb.storage.from(DECK_BUCKET).upload(path, typed, { contentType: typed.type, upsert: false });
        if (up.error) throw up.error;
        const { error } = await sb.rpc('submit_slides_copy', {
          p_url: null, p_file_path: path, p_file_name: file.name, p_submitted_on: submittedOn, p_base_version: baseVersion,
        });
        if (error) {
          await sb.storage.from(DECK_BUCKET).remove([path]); // don't leave an orphan behind
          if (error.code !== '40001') throw error;
        }
        await refresh('workspace_summary', 'slide_archive');
        return error ? ('conflict' as const) : ('ok' as const);
      }),
    [track, workspaceId, refresh],
  );

  /** A short-lived link that downloads the file (the bucket is private). */
  const deckDownloadUrl = useCallback(
    (path: string, fileName: string): Promise<string | undefined> =>
      track(async () => {
        const { data, error } = await sb.storage.from(DECK_BUCKET).createSignedUrl(path, 120, { download: fileName });
        if (error) throw error;
        return data.signedUrl;
      }),
    [track],
  );

  /** Remove the submitted deck (and its uploaded file) without filing it in the archive. */
  const removeSubmittedDeck = useCallback(
    (baseVersion: number, filePath: string | null): Promise<boolean> =>
      track(async () => {
        const r = await sb
          .from('workspace_summary')
          .update({ slides_submitted_url: null, slides_submitted_file: null, slides_submitted_file_name: null, slides_submitted_on: null, version: baseVersion + 1 })
          .eq('workspace_id', workspaceId).eq('version', baseVersion).select();
        if (r.error && r.error.code !== '40001') throw r.error;
        if (r.error || !r.data?.length) { await refresh('workspace_summary'); throw new Error('Someone just changed the slides, so nothing was removed. The latest is shown.'); }
        setSummary(r.data[0] as Summary);
        if (filePath) await sb.storage.from(DECK_BUCKET).remove([filePath]);
        return true;
      }).then((x) => !!x),
    [track, workspaceId, refresh],
  );

  const removeArchivedSlides = useCallback(
    (entry: SlideArchive) =>
      track(async () => {
        const { error } = await sb.from('slide_archive').delete().eq('id', entry.id);
        if (error) throw error;
        setSlideArchive((a) => a.filter((x) => x.id !== entry.id));
        if (entry.file_path) await sb.storage.from(DECK_BUCKET).remove([entry.file_path]);
      }),
    [track],
  );

  // ---------------------------------------------------------------- team
  const savePerson = useCallback(
    (p: Person, patch: Partial<Person>) =>
      track(async () => {
        if (patch.initial !== undefined && !patch.initial.trim()) throw new Error('Initials are required.');
        const { data, error } = await sb
          .from('people')
          .update({ ...patch, version: p.version + 1 })
          .eq('id', p.id)
          .eq('version', p.version)
          .select();
        if (error) throw error.code === '23505' ? new Error('Those initials are already used by another active teammate.') : error;
        if (!data?.length) {
          await refresh('people');
          throw new Error('This profile was changed by someone else. The latest version is now shown; apply your edit again.');
        }
        setPeople((ps) => ps.map((x) => (x.id === p.id ? (data[0] as Person) : x)));
      }),
    [track, refresh],
  );

  const addPerson = useCallback(
    (p: { initial: string; name: string; color: string; role: string; focus: string }) =>
      track(async () => {
        if (!p.initial.trim()) throw new Error('Initials are required.');
        const { error } = await sb.from('people').insert({ ...p, workspace_id: workspaceId });
        if (error) throw error.code === '23505' ? new Error('Those initials are already used by another active teammate.') : error;
        await refresh('people', 'activity');
      }),
    [track, workspaceId, refresh],
  );

  const addInvite = useCallback(
    (email: string, personId: string | null) =>
      track(async () => {
        const e = email.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Enter a valid email address.');
        const { error } = await sb.from('invites').insert({ workspace_id: workspaceId, email: e, person_id: personId, invited_by: userId });
        if (error) throw error.code === '23505' ? new Error('That email is already invited.') : error;
        await refresh('invites', 'activity');
      }),
    [track, workspaceId, userId, refresh],
  );

  const removeInvite = useCallback(
    (email: string) =>
      track(async () => {
        const { error } = await sb.from('invites').delete().eq('workspace_id', workspaceId).eq('email', email);
        if (error) throw error;
        await refresh('invites', 'activity');
      }),
    [track, workspaceId, refresh],
  );

  const removeMember = useCallback(
    (uid: string) =>
      track(async () => {
        const { error } = await sb.from('members').delete().eq('workspace_id', workspaceId).eq('user_id', uid);
        if (error) throw error;
        await sb.from('people').update({ user_id: null }).eq('user_id', uid);
        await refresh('members', 'people', 'activity');
      }),
    [track, workspaceId, refresh],
  );

  // ---------------------------------------------------------------- demo data
  const loadDemo = useCallback(
    () =>
      track(async () => {
        const rows = DEMO.map((d) => {
          const owner = people.find((p) => p.active && p.initial.toLowerCase() === d.owner.toLowerCase());
          if (!owner) throw new Error(`Demo data needs an active teammate with initial “${d.owner}”.`);
          return {
            workspace_id: workspaceId, title: d.title, owner_id: owner.id, workstream: d.workstream, col: d.column, priority: d.priority,
            due_date: addDays(todayDenver(), d.dueOffsetDays), deliverable: d.deliverable,
            blocked: !!(d as any).blocker, blocker: (d as any).blocker ?? null, is_demo: true,
          };
        });
        const { error } = await sb.from('tasks').insert(rows);
        if (error) throw error;
        await refresh('tasks', 'activity');
      }),
    [track, people, workspaceId, refresh],
  );

  const removeDemo = useCallback(
    () =>
      track(async () => {
        const { error } = await sb.from('tasks').delete().eq('workspace_id', workspaceId).eq('is_demo', true);
        if (error) throw error;
        await refresh('tasks', 'activity');
      }),
    [track, workspaceId, refresh],
  );

  const reconnect = useCallback(() => { setLive('connecting'); setReconnects((n) => n + 1); }, []);

  const thursday = nextWeekday(today, THURSDAY);

  return {
    workspaceId, userId, loading, live, liveDetail, reconnect, saving, error, setError, notice, setNotice, today, thursday,
    people, tasks, comments, activity, summary, members, invites, events, slideArchive, me, person, actorName,
    submitSlidesCopy, deckDownloadUrl, removeSubmittedDeck, removeArchivedSlides,
    createEvent, saveEvent, deleteEvent, setTaskEvent,
    createTask, saveTask, moveTask, addEvidence, addNoDeliverable, removeEvidence, carryForward, deleteTask, addComment,
    saveSummary, savePerson, addPerson, addInvite, removeInvite, removeMember, loadDemo, removeDemo, refresh,
  };
}

export type Board = ReturnType<typeof useBoard>;
