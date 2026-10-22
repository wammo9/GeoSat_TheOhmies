// Runs db/schema.sql in an in-process Postgres (PGlite) with a stub of Supabase's `auth` schema,
// and exercises row-level security, the evidence rule, optimistic concurrency and the activity log.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const A = '00000000-0000-0000-0000-00000000000a'; // admin
const B = '00000000-0000-0000-0000-00000000000b'; // invited member
const C = '00000000-0000-0000-0000-00000000000c'; // outsider
const email: Record<string, string> = { [A]: 'a@team.edu', [B]: 'b@team.edu', [C]: 'c@evil.com' };

let db: PGlite;
async function as<T = any>(uid: string, sql: string, params: any[] = []): Promise<T[]> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false), set_config('request.jwt.claim.email','${email[uid]}',false);`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const fails = async (uid: string, sql: string, params: any[] = []) => {
  try { await as(uid, sql, params); return null; } catch (e: any) { return e as { message: string; code?: string }; }
};

const people = ['J', 'A', 'W', 'M', 'T', 'B'].map((i) => ({ initial: i, name: i, color: '#7C4DBE', role: 'r', focus: 'f' }));
let ws = '', owner = '', taskId = '';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    insert into auth.users values ('${A}','a@team.edu'),('${B}','b@team.edu'),('${C}','c@evil.com');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
    create role anon; create role authenticated; create publication supabase_realtime;
  `);
  await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.exec(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;`);
});

describe('workspace setup and privacy', () => {
  it('first user bootstraps; a second bootstrap is refused', async () => {
    expect((await as(A, 'select has_workspace() as h'))[0].h).toBe(false);
    ws = (await as(A, 'select bootstrap_workspace($1,$2,$3::jsonb,$4::jsonb) as id', ['Team', 'J', JSON.stringify(people), JSON.stringify([{ initial: 'A', email: 'B@team.edu ' }])]))[0].id;
    expect(ws).toBeTruthy();
    expect((await as(A, 'select count(*)::int n from people'))[0].n).toBe(6);
    expect((await as(A, 'select is_admin from members'))[0].is_admin).toBe(true);
    expect((await fails(C, 'select bootstrap_workspace($1,$2,$3::jsonb)', ['x', 'J', JSON.stringify(people)]))?.message).toMatch(/workspace_exists/);
    owner = (await as(A, `select id from people where initial='J'`))[0].id;
  });
  it('invited email joins and is linked to the teammate; others are locked out', async () => {
    expect((await as(B, 'select claim_invite() as w'))[0].w).toBe(ws);
    expect((await as(B, `select initial from people where user_id='${B}'`))[0].initial).toBe('A');
    expect((await as(C, 'select claim_invite() as w'))[0].w).toBeNull();
    expect((await as(C, 'select count(*)::int n from people'))[0].n).toBe(0);
    expect((await as(C, 'select count(*)::int n from workspaces'))[0].n).toBe(0);
  });
  it('only admins can invite', async () => {
    expect(await fails(B, `insert into invites(workspace_id,email) values ('${ws}','z@x.com')`)).toBeTruthy();
    expect(await fails(A, `insert into invites(workspace_id,email) values ('${ws}','z@x.com')`)).toBeNull();
  });
});

describe('tasks', () => {
  it('members create tasks; outsiders cannot see or write them', async () => {
    taskId = (await as(B, `insert into tasks(workspace_id,title,owner_id,workstream,due_date,deliverable) values ('${ws}','Define enclosure',$1,'Mechanical / Enclosure','2026-10-22','CAD') returning id`, [owner]))[0].id;
    expect((await as(A, 'select count(*)::int n from tasks'))[0].n).toBe(1);
    expect((await as(C, 'select count(*)::int n from tasks'))[0].n).toBe(0);
    expect(await fails(C, `insert into tasks(workspace_id,title,owner_id,workstream,due_date,deliverable) values ('${ws}','x',$1,'w','2026-10-22','d')`, [owner])).toBeTruthy();
    expect((await as(C, `update tasks set title='hacked' where id='${taskId}' returning id`)).length).toBe(0);
  });
  it('requires title, deliverable and a described blocker', async () => {
    const base = `insert into tasks(workspace_id,title,owner_id,workstream,due_date,deliverable,blocked,blocker) values ('${ws}'`;
    expect(await fails(A, `${base},' ',$1,'w','2026-10-22','d',false,null)`, [owner])).toBeTruthy();
    expect(await fails(A, `${base},'t',$1,'w','2026-10-22','  ',false,null)`, [owner])).toBeTruthy();
    expect(await fails(A, `${base},'t',$1,'w','2026-10-22','d',true,null)`, [owner])).toBeTruthy();
  });
  it('refuses Completed without evidence, allows it with evidence, allows reopening', async () => {
    expect((await fails(A, `update tasks set col='completed', version=version+1 where id='${taskId}'`))?.message).toMatch(/evidence_required/);
    const ok = await as(A, `update tasks set col='completed', version=version+1, evidence='[{"type":"link","value":"https://x.dev/r","added_at":"2026-10-21T00:00:00Z"}]'::jsonb where id='${taskId}' returning col, version`);
    expect(ok[0]).toEqual({ col: 'completed', version: 2 });
    const reopened = await as(A, `update tasks set col='in_progress', version=version+1 where id='${taskId}' returning col`);
    expect(reopened[0].col).toBe('in_progress');
  });
  it('rejects stale writes instead of overwriting', async () => {
    // version is now 3. Two editors both loaded version 3.
    const first = await as(A, `update tasks set title='A edit', version=4 where id='${taskId}' and version=3 returning title`);
    expect(first.length).toBe(1);
    const second = await as(B, `update tasks set title='B edit', version=4 where id='${taskId}' and version=3 returning title`);
    expect(second.length).toBe(0); // zero rows: the client reports a conflict
    expect((await fails(B, `update tasks set title='B edit' where id='${taskId}'`))?.code).toBe('40001'); // forgot to bump version
    expect((await as(A, `select title from tasks where id='${taskId}'`))[0].title).toBe('A edit');
  });
  it('logs who changed what', async () => {
    const rows = await as<any>(A, `select actor_id, action, detail from activity where task_id='${taskId}' and entity='task' order by id`);
    expect(rows[0].action).toBe('created');
    expect(rows[0].actor_id).toBe(B);
    const move = rows.find((r) => r.action === 'moved');
    expect(move.actor_id).toBe(A);
    expect(move.detail.col).toEqual({ from: 'backlog', to: 'completed' });
    expect(rows.at(-1).detail.title).toEqual({ from: 'Define enclosure', to: 'A edit' });
  });
  it('stores comments and logs them; users cannot post as someone else', async () => {
    await as(B, `insert into comments(workspace_id,task_id,author_id,body) values ('${ws}','${taskId}','${B}','looks good')`);
    expect(await fails(B, `insert into comments(workspace_id,task_id,author_id,body) values ('${ws}','${taskId}','${A}','forged')`)).toBeTruthy();
    expect((await as(A, `select count(*)::int n from activity where action='commented'`))[0].n).toBe(1);
  });
});

describe('summary', () => {
  it('uses versioned writes', async () => {
    expect((await as(A, `update workspace_summary set weekly_goal='Ship Rev 2', version=2 where version=1 returning weekly_goal`)).length).toBe(1);
    expect((await as(B, `update workspace_summary set weekly_goal='other', version=2 where version=1 returning weekly_goal`)).length).toBe(0);
  });
});

describe('calendar events', () => {
  let ev = '';
  it('members create events; outsiders cannot see or write them', async () => {
    ev = (await as(B, `insert into events(workspace_id,title,kind,start_date,end_date,is_major) values ('${ws}','Design review','review','2026-11-12','2026-11-13',true) returning id`))[0].id;
    expect((await as(A, 'select count(*)::int n from events'))[0].n).toBe(1);
    expect((await as(C, 'select count(*)::int n from events'))[0].n).toBe(0);
    expect(await fails(C, `insert into events(workspace_id,title,start_date) values ('${ws}','x','2026-11-01')`)).toBeTruthy();
  });
  it('validates event dates and titles', async () => {
    expect(await fails(A, `insert into events(workspace_id,title,start_date,end_date) values ('${ws}','x','2026-11-05','2026-11-01')`)).toBeTruthy();
    expect(await fails(A, `insert into events(workspace_id,title,start_date) values ('${ws}',' ','2026-11-05')`)).toBeTruthy();
  });
  it('rejects stale event edits', async () => {
    expect((await as(A, `update events set title='Design review v2', version=2 where id='${ev}' and version=1 returning id`)).length).toBe(1);
    expect((await as(B, `update events set title='other', version=2 where id='${ev}' and version=1 returning id`)).length).toBe(0);
    expect((await fails(B, `update events set title='other' where id='${ev}'`))?.code).toBe('40001');
  });
  it('tasks can have a start date and link to an event; start must not be after due', async () => {
    expect(await fails(A, `update tasks set start_date='2026-12-01', version=version+1 where id='${taskId}'`)).toBeTruthy();
    const cur = (await as(A, `select version v from tasks where id='${taskId}'`))[0].v;
    const r = await as(A, `update tasks set start_date='2026-10-15', event_id='${ev}', version=${cur + 1} where id='${taskId}' and version=${cur} returning event_id`);
    expect(r[0].event_id).toBe(ev);
  });
  it('deleting an event unlinks its tasks (and bumps their version) instead of failing', async () => {
    const before = (await as(A, `select version v from tasks where id='${taskId}'`))[0].v;
    await as(A, `delete from events where id='${ev}'`);
    const after = (await as(A, `select version v, event_id from tasks where id='${taskId}'`))[0];
    expect(after.event_id).toBeNull();
    expect(after.v).toBe(before + 1);
  });
  it('logs event changes with who did them', async () => {
    const rows = await as<any>(A, `select action, actor_id, detail from activity where entity='event' order by id`);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete']);
    expect(rows[0].actor_id).toBe(B);
    expect(rows[0].detail.title).toBe('Design review');
  });
});

describe('recurring events', () => {
  it('stores a repeat rule with an end date and skipped dates', async () => {
    const r = await as(A, `insert into events(workspace_id,title,start_date,recur,recur_until,recur_skip) values ('${ws}','Weekly sync','2026-11-03','weekly','2026-12-15','{2026-11-10}') returning recur, recur_until::text, recur_skip::text[]`);
    expect(r[0]).toEqual({ recur: 'weekly', recur_until: '2026-12-15', recur_skip: ['2026-11-10'] });
  });
  it('defaults to not repeating and rejects bad rules', async () => {
    const r = await as(A, `insert into events(workspace_id,title,start_date) values ('${ws}','One-off','2026-11-03') returning recur`);
    expect(r[0].recur).toBe('none');
    expect(await fails(A, `insert into events(workspace_id,title,start_date,recur) values ('${ws}','x','2026-11-03','yearly')`)).toBeTruthy();
    expect(await fails(A, `insert into events(workspace_id,title,start_date,recur,recur_until) values ('${ws}','x','2026-11-03','weekly','2026-11-01')`)).toBeTruthy();
  });
});
