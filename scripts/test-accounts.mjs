import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role supabase_auth_admin;create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const path of ['schema.sql','migrations/20261030_game_requests.sql'])await db.exec(await readFile(new URL(`../supabase/${path}`,import.meta.url),'utf8'));
const ids=Array.from({length:5},(_,i)=>`${String(i+1).padStart(8,'0')}-0000-0000-0000-000000000000`);
for(let i=0;i<4;i++)await db.query('insert into auth.users values($1,$2)',[ids[i],{username:`user${i}`,name:`회원${i}`,gender:'남성'}]);
await db.query("update public.profiles set role='admin' where id=$1",[ids[0]]);
const migration=await readFile(new URL('../supabase/migrations/20261030_accounts_and_statistics.sql',import.meta.url),'utf8');
await db.exec(migration);await db.exec(migration);
assert.equal((await db.query("select count(*)::int n from public.profiles where status='approved'")).rows[0].n,4,'existing members remain approved');
await db.query('insert into auth.users values($1,$2)',[ids[4],{username:'newuser',name:'새회원',gender:'여성',role:'admin',status:'approved'}]);
const pending=(await db.query('select * from public.profiles where id=$1',[ids[4]])).rows[0];
assert.equal(pending.status,'pending');assert.equal(pending.role,'member');
async function asUser(i){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]);await db.exec('set role authenticated');}
const hook=async(i,method='password')=>(await db.query('select public.approval_access_token_hook($1) result',[{user_id:ids[i],authentication_method:method,claims:{sub:ids[i],role:'authenticated'}}])).rows[0].result;
await db.exec('set role supabase_auth_admin');
assert.equal((await hook(4)).error.http_code,403);
assert.equal((await hook(4,'email/signup')).claims.role,'anon');
assert.equal((await hook(0)).claims.role,'authenticated');
await asUser(4);
assert.equal((await db.query('select * from public.profiles')).rows.length,1);
await assert.rejects(db.query('select public.approval_access_token_hook($1)',[{}]));
await assert.rejects(db.query('select public.admin_update_account($1,$2)',[ids[4],'approve']),/관리자/);
await assert.rejects(db.query('select * from public.monthly_attendance_ranking()'),/승인된/);
await assert.rejects(db.query('select public.reserve($1)',[ids[0]]),/관리자 승인/);
await assert.rejects(db.query('select public.submit_game_request($1,$2)',[ids[0],'rest']),/관리자 승인/);
await db.exec('reset role');
const meeting=(await db.query("insert into public.meetings(title,starts_at,location,capacity,created_by,game_state) values('기록',now(),'체육관',2,$1,$2) returning id",[ids[1],{courts:[{id:1,name:'코트1',team:[`회원1 · ${ids[1].slice(0,8)}`]}],playerProfiles:{[`회원1 · ${ids[1].slice(0,8)}`]:{user_id:ids[1],name:'회원1',gender:'남성'}}}])).rows[0].id;
await asUser(4);assert.equal((await db.query('select * from public.meetings')).rows.length,0);
await asUser(0);
await db.query('select public.admin_update_account($1,$2)',[ids[4],'approve']);
await db.query('select public.admin_update_account($1,$2)',[ids[4],'make_admin']);
await asUser(4);assert.equal((await db.query('select public.is_admin() result')).rows[0].result,true);
await assert.rejects(db.query('select public.admin_update_account($1,$2)',[ids[4],'make_member']),/자신의/);
await assert.rejects(db.query('select public.admin_delete_account($1)',[ids[4]]),/자신의/);
await asUser(0);await db.query('select public.admin_update_account($1,$2)',[ids[4],'make_member']);
await asUser(4);await assert.rejects(db.query('select public.admin_delete_account($1)',[ids[1]]),/관리자/);
await db.exec('reset role');
// Korea month boundaries: February begins at Jan 31 15:00 UTC.
for(const [instant,users,cancelled] of [
 ['2026-01-31T15:00:00Z',[1,2],false],['2026-02-28T14:59:59Z',[1,2,0],false],
 ['2026-02-28T15:00:00Z',[2],false],['2026-02-10T00:00:00Z',[1],true]
]){
 const mid=(await db.query("insert into public.meetings(title,starts_at,location,capacity,created_by,cancelled) values('월간',$1,'체육관',10,$2,$3) returning id",[instant,ids[0],cancelled])).rows[0].id;
 for(const i of users)await db.query("insert into public.attendance(meeting_id,user_id,status) values($1,$2,'confirmed')",[mid,ids[i]]);
}
await asUser(3);
const ranking=(await db.query("select * from public.monthly_attendance_ranking('2026-02-01')")).rows;
assert.equal(ranking.length,3);assert.equal(Number(ranking[0].attendance_count),2);assert.equal(Number(ranking[1].rank),1);assert.equal(Number(ranking[2].rank),2);
await db.exec('reset role');
for(const [i,status] of [[1,'confirmed'],[2,'confirmed'],[3,'waiting']])await db.query('insert into public.attendance(meeting_id,user_id,status) values($1,$2,$3)',[meeting,ids[i],status]);
await db.query("insert into public.game_requests(meeting_id,user_id,kind,status,resolved_by) values($1,$2,'rest','approved',$3)",[meeting,ids[2],ids[1]]);
await asUser(0);await db.query('select public.admin_delete_account($1)',[ids[1]]);
await db.exec('reset role');
assert.equal((await db.query('select * from auth.users where id=$1',[ids[1]])).rows.length,0);
assert.equal((await db.query('select * from public.profiles where id=$1',[ids[1]])).rows.length,0);
const changed=(await db.query('select * from public.meetings where id=$1',[meeting])).rows[0];
assert.equal(changed.created_by,null);assert.equal(changed.game_version,1);
assert.ok(!JSON.stringify(changed.game_state).includes('회원1'));
assert.equal(changed.game_state.playerProfiles[`deleted:${ids[1]}`].name,'삭제된 회원');
assert.equal((await db.query('select status from public.attendance where meeting_id=$1 and user_id=$2',[meeting,ids[3]])).rows[0].status,'confirmed');
assert.equal((await db.query('select resolved_by from public.game_requests where meeting_id=$1',[meeting])).rows[0].resolved_by,null);
await asUser(1);assert.equal((await db.query('select * from public.meetings')).rows.length,0,'old JWT no longer grants access after account deletion');
await assert.rejects(db.query('select public.reserve($1)',[meeting]),/관리자 승인/);
await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.monthly_attendance_ranking()'));
await db.close();console.log('PASS: approval defaults, auth hook, old-JWT gates, admin role changes, protected deletion, FK cleanup, queue promotion, anonymization and KST monthly ranking');
