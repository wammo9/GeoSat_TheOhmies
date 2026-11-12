// Runs db/schema.sql in an in-process Postgres (PGlite) with a stub of Supabase's `auth` schema,
// and exercises row-level security, the evidence rule, optimistic concurrency and the activity log.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compareOccurrences, occurrences, occurrencesOnDay, upcomingMajor } from '../src/lib/calendar';
import { weekday } from '../src/lib/dates';

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
    -- minimal stand-in for Supabase Storage so the bucket and its access rules can be tested
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  `);
  await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await db.exec(`grant usage on schema public, auth, storage to authenticated; grant all on all tables in schema public to authenticated; grant all on all tables in schema storage to authenticated; grant usage on all sequences in schema public to authenticated;`);
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

describe('customer slides (working deck, submitted deck, past decks)', () => {
  const ver = async () => (await as(A, `select version v from workspace_summary`))[0].v as number;
  it('stores http(s) links and rejects anything else (e.g. javascript:)', async () => {
    const cur = await ver();
    const r = await as(A, `update workspace_summary set slides_working_url='https://www.canva.com/design/abc/edit', version=${cur + 1} where version=${cur} returning slides_working_url`);
    expect(r[0].slides_working_url).toBe('https://www.canva.com/design/abc/edit');
    expect(await fails(A, `update workspace_summary set slides_submitted_url='javascript:alert(1)', version=${cur + 2}`)).toBeTruthy();
    expect(await fails(A, `update workspace_summary set slides_working_url='not a link', version=${cur + 2}`)).toBeTruthy();
  });
  it('is private to members and versioned like the other summary fields', async () => {
    expect((await as(C, `select slides_working_url from workspace_summary`)).length).toBe(0);
    expect((await as(B, `update workspace_summary set slides_working_url='https://x.com', version=1 where version=1 returning 1`)).length).toBe(0);
  });
  const FILE = (n: string) => `${ws}/${n}`;
  it('submitting a first copy (an uploaded file) sets the submitted deck without archiving anything', async () => {
    await as(A, `select submit_slides_copy(null, '${FILE('w1-deck.pptx')}', 'Week 1.pptx', '2026-10-23', ${await ver()})`);
    const r = (await as(A, `select slides_submitted_file f, slides_submitted_file_name n, slides_submitted_url u, slides_submitted_on::text d from workspace_summary`))[0];
    expect(r).toEqual({ f: FILE('w1-deck.pptx'), n: 'Week 1.pptx', u: null, d: '2026-10-23' });
    expect((await as(A, `select count(*)::int n from slide_archive`))[0].n).toBe(0);
  });
  it('submitting a new copy files the previous file in the archive, atomically', async () => {
    await as(B, `select submit_slides_copy(null, '${FILE('w2-deck.pptx')}', 'Week 2.pptx', '2026-10-30', ${await ver()})`);
    const arch = await as(A, `select url, file_path, file_name, submitted_on::text d, created_by from slide_archive`);
    expect(arch).toEqual([{ url: null, file_path: FILE('w1-deck.pptx'), file_name: 'Week 1.pptx', d: '2026-10-23', created_by: B }]);
    expect((await as(A, `select slides_submitted_file f from workspace_summary`))[0].f).toBe(FILE('w2-deck.pptx'));
  });
  it('still accepts a link copy, and archives an older link copy too', async () => {
    await as(A, `select submit_slides_copy('https://canva.com/design/old/view', null, null, '2026-11-06', ${await ver()})`);
    await as(A, `select submit_slides_copy(null, '${FILE('w4-deck.pptx')}', 'Week 4.pptx', '2026-11-13', ${await ver()})`);
    const arch = await as(A, `select url, file_path from slide_archive order by submitted_on`);
    expect(arch.map((r: any) => r.url ?? r.file_path)).toEqual([FILE('w1-deck.pptx'), FILE('w2-deck.pptx'), 'https://canva.com/design/old/view']);
  });
  it('refuses a stale submit, bad input, a foreign folder and outsiders, leaving the archive unchanged', async () => {
    const v = await ver();
    const n0 = (await as(A, `select count(*)::int n from slide_archive`))[0].n;
    expect((await fails(A, `select submit_slides_copy(null, '${FILE('x.pptx')}', 'x.pptx', '2026-11-20', ${v - 1})`))?.code).toBe('40001');
    expect(await fails(A, `select submit_slides_copy('javascript:alert(1)', null, null, '2026-11-20', ${v})`)).toBeTruthy();
    expect(await fails(A, `select submit_slides_copy('https://x.com', '${FILE('x.pptx')}', 'x', '2026-11-20', ${v})`)).toBeTruthy(); // both
    expect(await fails(A, `select submit_slides_copy(null, null, null, '2026-11-20', ${v})`)).toBeTruthy(); // neither
    expect(await fails(A, `select submit_slides_copy(null, '99999999-0000-0000-0000-000000000000/x.pptx', 'x', '2026-11-20', ${v})`)).toBeTruthy();
    expect(await fails(C, `select submit_slides_copy(null, '${FILE('x.pptx')}', 'x', '2026-11-20', ${v})`)).toBeTruthy();
    expect((await as(A, `select count(*)::int n from slide_archive`))[0].n).toBe(n0);
    expect((await as(C, `select count(*)::int n from slide_archive`))[0].n).toBe(0);
  });
  it('keeps slide decks in a private bucket that only workspace members can use', async () => {
    const bucket = (await as(A, `select public, file_size_limit::text l, allowed_mime_types from storage.buckets where id='slide-decks'`))[0];
    expect(bucket.public).toBe(false);
    expect(bucket.l).toBe('52428800');
    expect(bucket.allowed_mime_types).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    await as(B, `insert into storage.objects(bucket_id, name) values ('slide-decks', '${FILE('w1-deck.pptx')}')`);
    expect((await as(A, `select count(*)::int n from storage.objects`))[0].n).toBe(1); // another member can read it
    expect((await as(C, `select count(*)::int n from storage.objects`))[0].n).toBe(0); // an outsider cannot
    expect(await fails(C, `insert into storage.objects(bucket_id, name) values ('slide-decks', '${FILE('evil.pptx')}')`)).toBeTruthy();
    expect(await fails(A, `insert into storage.objects(bucket_id, name) values ('slide-decks', 'not-a-workspace/evil.pptx')`)).toBeTruthy();
    expect((await as(C, `delete from storage.objects returning id`)).length).toBe(0);
    expect((await as(A, `delete from storage.objects returning id`)).length).toBe(1); // members can delete (used when removing a deck)
  });
  it('lets members remove a mistaken archive entry', async () => {
    expect((await as(B, `delete from slide_archive where id = (select id from slide_archive limit 1) returning id`)).length).toBe(1);
    expect((await as(A, `select count(*)::int n from slide_archive`))[0].n).toBe(2);
  });
});

describe('budget orders', () => {
  let order = '';
  it('members add orders; outsiders cannot see or write them', async () => {
    order = (await as(B, `insert into orders(workspace_id,item,description,quantity,unit_price,supplier,date_needed,date_ordered,wufoo_no,product_link) values ('${ws}','INA219AIDR','Current Sensor',10,1.62,'Mouser','2026-10-01','2026-09-22','1','https://www.mouser.com/x') returning id`))[0].id;
    expect((await as(A, `select count(*)::int n from orders`))[0].n).toBe(1);
    expect((await as(C, `select count(*)::int n from orders`))[0].n).toBe(0);
    expect(await fails(C, `insert into orders(workspace_id,item) values ('${ws}','x')`)).toBeTruthy();
  });
  it('validates quantity, price, links and the received date', async () => {
    const ins = (cols: string, vals: string) => `insert into orders(workspace_id,item,${cols}) values ('${ws}','x',${vals})`;
    expect(await fails(A, ins('quantity', '0'))).toBeTruthy();
    expect(await fails(A, ins('unit_price', '-1'))).toBeTruthy();
    expect(await fails(A, ins('product_link', `'javascript:alert(1)'`))).toBeTruthy();
    expect(await fails(A, `insert into orders(workspace_id,item) values ('${ws}','  ')`)).toBeTruthy();
    expect(await fails(A, ins('date_received', `'2026-10-05'`))).toBeTruthy(); // received but never ordered
    expect(await fails(A, ins('date_ordered, date_received', `'2026-10-01','2026-10-05'`))).toBeNull();
  });
  it('rejects stale edits instead of overwriting', async () => {
    expect((await as(A, `update orders set quantity=12, version=2 where id='${order}' and version=1 returning id`)).length).toBe(1);
    expect((await as(B, `update orders set quantity=20, version=2 where id='${order}' and version=1 returning id`)).length).toBe(0);
    expect((await fails(B, `update orders set quantity=20 where id='${order}'`))?.code).toBe('40001');
  });
  it('logs order changes with who did them', async () => {
    const rows = await as<any>(A, `select action, actor_id, detail from activity where entity='order' order by id`);
    expect(rows[0]).toMatchObject({ action: 'insert', actor_id: B });
    expect(rows[0].detail.item).toBe('INA219AIDR');
    expect(rows.some((r) => r.action === 'update' && r.actor_id === A)).toBe(true);
  });
});

describe('fall 2026 timeline script', () => {
  const sql = readFileSync(new URL('./fall-2026-timeline.sql', import.meta.url), 'utf8');
  // The Supabase SQL Editor runs with nobody "signed in" (auth.uid() is null); mimic that for the script.
  const asSqlEditor = () => db.exec(`select set_config('request.jwt.claim.sub','',false)`);
  beforeAll(asSqlEditor);
  const load = async () =>
    (await db.query<any>(`select title, kind, start_date::text, end_date::text, is_major, recur, recur_until::text, recur_skip::text[] from events where title not like 'Design review%' order by start_date, title`)).rows;

  it('loads the timeline once, and running it again adds nothing', async () => {
    const before = (await db.query<any>(`select count(*)::int n from events`)).rows[0].n;
    await db.exec(sql);
    const once = (await db.query<any>(`select count(*)::int n from events`)).rows[0].n;
    expect(once - before).toBe(23);
    await db.exec(sql);
    expect((await db.query<any>(`select count(*)::int n from events`)).rows[0].n).toBe(once);
  });

  it('puts the Canvas deadlines on the right days', async () => {
    const rows = await load();
    const on = (title: string) => rows.find((r) => r.title === title)!;
    expect(on('PoC Demo due').start_date).toBe('2026-11-19');
    expect(on('Functional PCB due').start_date).toBe('2026-11-20');
    expect(on('TA Check-In 4 due').start_date).toBe('2026-11-02');
    expect(on('TA Check-In 5 due').start_date).toBe('2026-11-30');
    expect(on('Badge quizzes due (10 badges)').start_date).toBe('2026-11-06');
    expect(on('Mini Expo presentation').start_date).toBe('2026-12-03');
    expect(on('Phase 1 Final Report due').start_date).toBe('2026-12-07');
    expect(on('Portfolio and Career Path due').start_date).toBe('2026-11-30');
    expect(on('Personal Reflection due').start_date).toBe('2026-12-04');
    expect(on('Project Metrics due').start_date).toBe('2026-12-04');
    expect(on('Peer Evaluation 2 (opens Nov 8, due Nov 13)')).toMatchObject({ start_date: '2026-11-08', end_date: '2026-11-13' });
    expect(on('Mini Expo poster due (Morning and Afternoon sections)').start_date).toBe('2026-11-13');
    expect(on('Week 10: PDR week')).toMatchObject({ start_date: '2026-10-19', end_date: '2026-10-23', is_major: false });
    expect(on('Rev 3 sprint (Weeks 11-13): final PoC iteration')).toMatchObject({ start_date: '2026-10-26', end_date: '2026-11-15' });
    expect(on('Fall break (no class, nothing due)')).toMatchObject({ start_date: '2026-11-23', end_date: '2026-11-29' });
  });

  it('expands the weekly items into exactly the Canvas dates', async () => {
    const rows = await load();
    const ev = (t: string) => ({ ...rows.find((r) => r.title === t)!, id: 'x', workspace_id: 'w', end_date: null, description: null, version: 1, updated_by: null, updated_at: '', recur_skip: [] }) as any;
    const days = (t: string) => occurrences(ev(t), '2026-10-01', '2026-12-31').map((o) => o.start);
    expect(days('Sponsor meeting slides due (Fri 11:59 PM)')).toEqual(['2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20']);
    expect(days('Weekly sponsor meeting (Wednesday)')).toEqual(['2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18']);
    for (const d of days('Sponsor meeting slides due (Fri 11:59 PM)')) expect(weekday(d)).toBe(5); // Fridays
    for (const d of days('Weekly sponsor meeting (Wednesday)')) expect(weekday(d)).toBe(3); // Wednesdays
  });

  it('highlights the four upcoming big events in date order (PDR is already over)', async () => {
    const rows = (await load()).map((r) => ({ ...r, id: r.title, workspace_id: 'w', description: null, version: 1, updated_by: null, updated_at: '', recur_skip: r.recur_skip ?? [] })) as any[];
    expect(upcomingMajor(rows, '2026-10-25', 10).map((o) => o.event.title)).toEqual([
      'PoC Demo due', 'Functional PCB due', 'Mini Expo presentation', 'Phase 1 Final Report due',
    ]);
  });

  it('gives our own suggestions their own "Plan" type, separate from deadlines, with plain titles', async () => {
    const all = await load();
    const plan = all.filter((r) => r.kind === 'plan');
    expect(plan.map((r) => r.title).sort()).toEqual([
      'Draft the Phase 1 final report', 'LAST realistic PCB run for the Nov 20 deadline', 'Mini Expo rehearsal (poster, pitch, demo)',
      'Pick the 2 risks/tests for the PoC demo', 'PoC dry run + PCB function check', 'Submit PCB Gerbers (Tuesday run)',
    ]);
    expect(all.some((r) => r.title.startsWith('Plan:'))).toBe(false); // the type carries the label now
    expect((await db.query<any>(`select count(*)::int n from events where kind = 'plan' and description not like 'SUGGESTED%'`)).rows[0].n).toBe(0);
    expect(all.find((r) => r.title === 'LAST realistic PCB run for the Nov 20 deadline')!.kind).toBe('plan'); // not a deadline any more
  });

  it('shows each real day in the order: Rev 3 first, then milestones, deadlines, plans', async () => {
    const rows = (await load()).map((r) => ({ ...r, id: r.title, workspace_id: 'w', description: null, version: 1, updated_by: null, updated_at: '', recur_skip: r.recur_skip ?? [] })) as any[];
    const titles = (day: string) => occurrencesOnDay(rows, day).sort(compareOccurrences).map((o) => o.event.title);
    const rev3 = 'Rev 3 sprint (Weeks 11-13): final PoC iteration';
    expect(titles('2026-11-06')).toEqual([rev3, 'Badge quizzes due (10 badges)', 'Sponsor meeting slides due (Fri 11:59 PM)', 'Pick the 2 risks/tests for the PoC demo']);
    expect(titles('2026-10-27')).toEqual([rev3, 'Submit PCB Gerbers (Tuesday run)']);
    expect(titles('2026-10-28')).toEqual([rev3, 'Weekly sponsor meeting (Wednesday)']);
    expect(titles('2026-11-13')[0]).toBe(rev3);
    expect(titles('2026-11-20')).toEqual(['Functional PCB due', 'Sponsor meeting slides due (Fri 11:59 PM)']); // big deadline before ordinary one; Rev 3 is over
    expect(titles('2026-11-19')).toEqual(['PoC Demo due']);
  });

  it('accepts the Plan type and still rejects unknown types', async () => {
    expect((await as(A, `insert into events(workspace_id,title,kind,start_date) values ('${ws}','Try plan','plan','2026-11-05') returning kind`))[0].kind).toBe('plan');
    expect(await fails(A, `insert into events(workspace_id,title,kind,start_date) values ('${ws}','Bad','banana','2026-11-05')`)).toBeTruthy();
  });

  it('upgrades cleanly from the first version of the file, leaving edited and personal events alone', async () => {
    // what the first version created for the two events that moved, plus one a teammate edited in the app, plus one of ours
    await asSqlEditor();
    await db.exec(`insert into events(workspace_id,title,kind,start_date,end_date,is_major,description) select id,'Week 10: PDR week + start Rev 3','review','2026-10-26','2026-10-30',true,'old' from workspaces`);
    await db.exec(`insert into events(workspace_id,title,kind,start_date,end_date,description) select id,'Rev 3 sprint (Weeks 11-13): final PoC iteration','other','2026-11-02','2026-11-22','old' from workspaces`);
    await as(A, `update events set description='We changed this on purpose', version=version+1 where title='TA Check-In 4 due'`);
    await asSqlEditor();
    // the earlier version titled our suggestions "Plan: ..." and filed them under Milestone/Deadline
    await db.exec(`insert into events(workspace_id,title,kind,start_date,description) select id,'Plan: submit PCB Gerbers (Tuesday run)','milestone','2026-10-27','old' from workspaces`);
    await db.exec(`insert into events(workspace_id,title,start_date) select id,'Our own team dinner','2026-11-05' from workspaces`);
    await db.exec(sql);
    const titles = (await db.query<any>(`select title, start_date::text d, description from events`)).rows;
    expect(titles.some((r) => r.title === 'Week 10: PDR week + start Rev 3')).toBe(false);
    expect(titles.some((r) => r.title.startsWith('Rev 3 sprint') && r.d === '2026-11-02')).toBe(false);
    expect(titles.filter((r) => r.title.startsWith('Rev 3 sprint') && r.d === '2026-10-26')).toHaveLength(1);
    expect(titles.find((r) => r.title === 'TA Check-In 4 due')!.description).toBe('We changed this on purpose'); // human edit survives
    expect(titles.some((r) => r.title === 'Our own team dinner')).toBe(true);
    expect(titles.some((r) => r.title === 'Plan: submit PCB Gerbers (Tuesday run)')).toBe(false); // old-titled row replaced...
    expect(titles.filter((r) => r.title === 'Submit PCB Gerbers (Tuesday run)')).toHaveLength(1); // ...by exactly one new one
    // and the refreshed wording reached events nobody had touched
    expect(titles.find((r) => r.title === 'TA Check-In 5 due')!.description).toMatch(/^Week 16/);
    const total = (await db.query<any>(`select count(*)::int n from events where title not like 'Design review%'`)).rows[0].n;
    await db.exec(sql);
    expect((await db.query<any>(`select count(*)::int n from events where title not like 'Design review%'`)).rows[0].n).toBe(total);
  });
});

describe('purchase requests', () => {
  let req = '';
  it('any member can request; outsiders see and write nothing', async () => {
    req = (await as(B, `insert into order_requests(workspace_id,item,reason,quantity,est_unit_price,supplier,needed_by) values ('${ws}','Logic analyzer','Debug the SPI bus',1,49.99,'Amazon','2026-11-06') returning id`))[0].id;
    expect((await as(A, `select count(*)::int n from order_requests`))[0].n).toBe(1);
    expect((await as(C, `select count(*)::int n from order_requests`))[0].n).toBe(0);
    expect(await fails(C, `insert into order_requests(workspace_id,item,reason) values ('${ws}','x','y')`)).toBeTruthy();
  });
  it('requires an item and a reason, and sane numbers and links', async () => {
    const ins = (cols: string, vals: string) => `insert into order_requests(workspace_id,${cols}) values ('${ws}',${vals})`;
    expect(await fails(A, ins('item,reason', `' ','why'`))).toBeTruthy();
    expect(await fails(A, ins('item,reason', `'x',' '`))).toBeTruthy();
    expect(await fails(A, ins('item,reason,quantity', `'x','y',0`))).toBeTruthy();
    expect(await fails(A, ins('item,reason,est_unit_price', `'x','y',-5`))).toBeTruthy();
    expect(await fails(A, ins('item,reason,product_link', `'x','y','javascript:alert(1)'`))).toBeTruthy();
    expect(await fails(A, ins('item,reason', `'Resistor kit','Bench stock'`))).toBeNull();
  });
  it('the server records who requested and forces new requests to start as pending', async () => {
    const r = (await as(A, `insert into order_requests(workspace_id,item,reason,status,requested_by,decided_by) values ('${ws}','Sneaky','test','approved','${B}','${B}') returning status, requested_by, decided_by`))[0];
    expect(r).toEqual({ status: 'pending', requested_by: A, decided_by: null });
  });
  it('records who decided and when, and clears it when reopened', async () => {
    const ok = (await as(A, `update order_requests set status='approved', version=2, decided_by='${B}' where id='${req}' and version=1 returning status, decided_by, decided_at is not null as has_time`))[0];
    expect(ok).toEqual({ status: 'approved', decided_by: A, has_time: true }); // A, not the B that was sent
    const declined = (await as(B, `update order_requests set status='declined', decision_note='Too pricey', version=3 where id='${req}' and version=2 returning decided_by, decision_note`))[0];
    expect(declined).toEqual({ decided_by: B, decision_note: 'Too pricey' });
    const reopened = (await as(A, `update order_requests set status='pending', version=4 where id='${req}' and version=3 returning decided_by, decision_note`))[0];
    expect(reopened).toEqual({ decided_by: null, decision_note: null });
    expect((await as(A, `select requested_by from order_requests where id='${req}'`))[0].requested_by).toBe(B); // never changes
  });
  it('rejects stale edits instead of overwriting', async () => {
    expect((await as(B, `update order_requests set quantity=2, version=5 where id='${req}' and version=4 returning id`)).length).toBe(1);
    expect((await as(A, `update order_requests set quantity=3, version=5 where id='${req}' and version=4 returning id`)).length).toBe(0);
    expect((await fails(A, `update order_requests set quantity=3 where id='${req}'`))?.code).toBe('40001');
  });
  it('can become a budget order, and keeps the link if the order is later deleted', async () => {
    const order = (await as(A, `insert into orders(workspace_id,item,quantity,unit_price) values ('${ws}','Logic analyzer',2,49.99) returning id`))[0].id;
    const r = (await as(A, `update order_requests set status='added', order_id='${order}', version=6 where id='${req}' and version=5 returning status, order_id`))[0];
    expect(r).toEqual({ status: 'added', order_id: order });
    await as(A, `delete from orders where id='${order}'`);
    expect((await as(A, `select status, order_id from order_requests where id='${req}'`))[0]).toEqual({ status: 'added', order_id: null });
  });
  it('only the requester (or an admin) can delete a request', async () => {
    const mine = (await as(B, `insert into order_requests(workspace_id,item,reason) values ('${ws}','Mine','x') returning id`))[0].id;
    // B is a plain member here; A is the admin (set up in the first test group)
    expect((await as(C, `delete from order_requests where id='${mine}' returning id`)).length).toBe(0);
    expect((await as(B, `delete from order_requests where id='${mine}' returning id`)).length).toBe(1);
    const other = (await as(B, `insert into order_requests(workspace_id,item,reason) values ('${ws}','Other','x') returning id`))[0].id;
    expect((await as(A, `delete from order_requests where id='${other}' returning id`)).length).toBe(1); // admin may
  });
  it('logs requests with who did what', async () => {
    const rows = await as<any>(A, `select action, actor_id, detail from activity where entity='request' order by id`);
    expect(rows[0]).toMatchObject({ action: 'insert', actor_id: B });
    expect(rows[0].detail.item).toBe('Logic analyzer');
    expect(rows.some((r) => r.action === 'update' && r.detail.status === 'approved' && r.actor_id === A)).toBe(true);
  });
});
