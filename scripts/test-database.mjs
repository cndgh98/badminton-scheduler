import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Actual PostgreSQL engine with a small Supabase Auth shim, no live account needed.
const db = new PGlite();
await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;
`);
await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
const ids = [1,2,3,4].map(n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`);
for (let i=0;i<ids.length;i++) {
 await db.query('insert into auth.users values($1,$2)', [ids[i], {username:`user${i}`,name:`회원${i}`,gender:'남성',role:'admin'}]);
}
assert.equal((await db.query('select count(*)::int n from public.profiles where role=\'admin\'')).rows[0].n,0,'metadata cannot grant admin');
await db.query('update public.profiles set role=\'admin\' where id=$1',[ids[0]]);
const asUser = async i => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]); await db.exec('set role authenticated'); };
const meeting = (await db.query("insert into public.meetings(title,starts_at,location,capacity,created_by) values('테스트',now()+interval '1 hour','체육관',1,$1) returning id",[ids[0]])).rows[0].id;
await asUser(1);
await assert.rejects(db.query("insert into public.meetings(title,starts_at,location,capacity) values('불가',now(),'체육관',2)"));
await assert.rejects(db.query("update public.profiles set role='admin' where id=$1",[ids[1]]));
await assert.rejects(db.query("insert into public.attendance(meeting_id,user_id,status) values($1,$2,'confirmed')",[meeting,ids[1]]));
await db.query('select public.reserve($1)',[meeting]);
await db.query('select public.reserve($1)',[meeting]); // idempotent duplicate
await asUser(2); await db.query('select public.reserve($1)',[meeting]);
await asUser(3); await db.query('select public.reserve($1)',[meeting]);
assert.equal((await db.query("select count(*)::int n from public.attendance where status='confirmed'")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from public.attendance")).rows[0].n,3);
await asUser(2); await db.query('select public.reserve($1,true)',[meeting]); await db.query('select public.reserve($1)',[meeting]); // rejoin at end
await asUser(1); await db.query('select public.reserve($1,true)',[meeting]);
assert.equal((await db.query("select user_id from public.attendance where status='confirmed'")).rows[0].user_id,ids[3]);
assert.equal((await db.query('select count(*)::int n from public.profiles')).rows[0].n,1,'member sees own private profile only');
assert.equal((await db.query('select count(*)::int n from public.roster($1)',[meeting])).rows[0].n,2);
await assert.rejects(db.query('select public.save_game($1,$2,0)',[meeting,{courts:[]}]),/관리자/);
await assert.rejects(db.query('select public.cancel_meeting($1)',[meeting]),/관리자/);
await asUser(0);
// Force known KST date independent of the test execution time.
await db.exec('reset role');
await db.query('update public.meetings set starts_at=now() where id=$1',[meeting]);
await asUser(0);
assert.equal((await db.query('select public.save_game($1,$2,0) v',[meeting,{courts:[]}])).rows[0].v,1);
await assert.rejects(db.query('select public.save_game($1,$2,0)',[meeting,{}]),/다른 관리자가/);
await db.exec('reset role'); await db.query("update public.meetings set starts_at=now()+interval '2 days' where id=$1",[meeting]);
await asUser(0); await assert.rejects(db.query('select public.save_game($1,$2,1)',[meeting,{}]),/당일/);
await db.query('select public.cancel_meeting($1)',[meeting]);
await asUser(1); await assert.rejects(db.query('select public.reserve($1)',[meeting]),/취소된/);
await db.exec('reset role; set role anon');
await assert.rejects(db.query('select * from public.meetings'));
await assert.rejects(db.query('select public.reserve($1)',[meeting]));
await db.close();
console.log('PASS: SQL schema, roles, registration, capacity, FIFO promotion, rejoin, cancellation, game dates and version conflicts');
