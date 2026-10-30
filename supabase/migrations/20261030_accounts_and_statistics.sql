-- Run after schema.sql and 20261030_game_requests.sql. Existing members stay approved.
begin;
alter table public.profiles add column if not exists status text not null default 'approved' check(status in ('pending','approved'));
alter table public.profiles alter column status set default 'pending';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,username,name,gender,status,role)
 values(new.id,lower(new.raw_user_meta_data->>'username'),trim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'gender','pending','member');
 return new;
end $$;
create or replace function public.is_approved() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and status='approved')
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved')
$$;
revoke execute on function public.is_approved() from public,anon;
grant execute on function public.is_approved() to authenticated;
-- Restrictive policies also protect previously issued JWTs of deleted/pending users.
drop policy if exists approved_members_only on public.meetings;
create policy approved_members_only on public.meetings as restrictive for all to authenticated using(public.is_approved()) with check(public.is_approved());
drop policy if exists approved_members_only on public.attendance;
create policy approved_members_only on public.attendance as restrictive for all to authenticated using(public.is_approved()) with check(public.is_approved());
drop policy if exists approved_members_only on public.game_requests;
create policy approved_members_only on public.game_requests as restrictive for all to authenticated using(public.is_approved()) with check(public.is_approved());

-- Enable this function under Authentication > Hooks > Custom Access Token.
-- Signup can finish with an anon token; password login/refresh remain blocked until approval.
create or replace function public.approval_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=(event->>'user_id')::uuid and status='approved') then
  if event->>'authentication_method'='email/signup' then
   return jsonb_build_object('claims',jsonb_set(event->'claims','{role}','"anon"'));
  end if;
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','관리자 승인 대기 중이거나 삭제된 계정입니다.'));
 end if;
 return jsonb_build_object('claims',event->'claims');
end $$;
grant usage on schema public to supabase_auth_admin;
grant select(id,status) on public.profiles to supabase_auth_admin;
drop policy if exists auth_hook_approval on public.profiles;
create policy auth_hook_approval on public.profiles for select to supabase_auth_admin using(true);
revoke execute on function public.approval_access_token_hook(jsonb) from public,anon,authenticated;
grant execute on function public.approval_access_token_hook(jsonb) to supabase_auth_admin;

create or replace function public.admin_update_account(p_user uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare target public.profiles;
begin
 perform pg_advisory_xact_lock(77203010);
 if not public.is_admin() then raise exception '관리자만 계정을 관리할 수 있습니다.'; end if;
 select * into target from public.profiles where id=p_user for update;
 if not found then raise exception '계정이 없습니다.'; end if;
 if p_action='approve' then
  update public.profiles set status='approved' where id=p_user;
 elsif p_action in ('make_admin','make_member') then
  if p_user=auth.uid() then raise exception '자신의 권한은 변경할 수 없습니다.'; end if;
  if target.status<>'approved' then raise exception '가입 승인 후 권한을 변경해 주세요.'; end if;
  if target.role='admin' and (select count(*) from public.profiles where role='admin' and status='approved')<=1 then raise exception '마지막 관리자는 변경할 수 없습니다.'; end if;
  update public.profiles set role=case when p_action='make_admin' then 'admin' else 'member' end where id=p_user;
 else raise exception '잘못된 작업입니다.';
 end if;
end $$;

-- Keep meeting history when its creator is deleted; remove personal attendance/request rows.
alter table public.meetings alter column created_by drop not null;
alter table public.meetings drop constraint if exists meetings_created_by_fkey;
alter table public.meetings add constraint meetings_created_by_fkey foreign key(created_by) references public.profiles(id) on delete set null;
alter table public.attendance drop constraint if exists attendance_user_id_fkey;
alter table public.attendance add constraint attendance_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;
alter table public.game_requests drop constraint if exists game_requests_user_id_fkey;
alter table public.game_requests add constraint game_requests_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;
alter table public.game_requests drop constraint if exists game_requests_resolved_by_fkey;
alter table public.game_requests add constraint game_requests_resolved_by_fkey foreign key(resolved_by) references public.profiles(id) on delete set null;

create or replace function public.admin_delete_account(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target public.profiles; m public.meetings; keys text[]; key text; replacement text; state jsonb; n integer;
begin
 perform pg_advisory_xact_lock(77203010);
 if not public.is_admin() then raise exception '관리자만 계정을 삭제할 수 있습니다.'; end if;
 if p_user=auth.uid() then raise exception '자신의 계정은 삭제할 수 없습니다.'; end if;
 select * into target from public.profiles where id=p_user for update;
 if not found then raise exception '계정이 없습니다.'; end if;
 if target.role='admin' and target.status='approved' and (select count(*) from public.profiles where role='admin' and status='approved')<=1 then raise exception '마지막 관리자는 삭제할 수 없습니다.'; end if;
 replacement := 'deleted:' || p_user::text;
 -- Lock affected meetings in a consistent order, preserving active-game version checks.
 for m in select * from public.meetings where id in(select meeting_id from public.attendance where user_id=p_user)
  or exists(select 1 from jsonb_each(coalesce(game_state->'playerProfiles','{}')) where value->>'user_id'=p_user::text)
  or position(to_jsonb(target.name || ' · ' || left(p_user::text,8))::text in coalesce(game_state::text,''))>0 order by id for update loop
  delete from public.attendance where meeting_id=m.id and user_id=p_user;
  if not m.cancelled then
   select count(*) into n from public.attendance where meeting_id=m.id and status='confirmed';
   update public.attendance set status='confirmed' where id in(select id from public.attendance where meeting_id=m.id and status='waiting' order by id limit greatest(m.capacity-n,0));
  end if;
  if m.game_state is not null then
   select array_agg(k) into keys from(select e.key k from jsonb_each(coalesce(m.game_state->'playerProfiles','{}')) e where e.value->>'user_id'=p_user::text union select target.name || ' · ' || left(p_user::text,8)) items;
   state:=m.game_state;
   foreach key in array keys loop state:=replace(state::text,to_jsonb(key)::text,to_jsonb(replacement)::text)::jsonb; end loop;
   state:=jsonb_set(state,'{playerProfiles}',coalesce(state->'playerProfiles','{}') || jsonb_build_object(replacement,jsonb_build_object('name','삭제된 회원','gender',null,'user_id',null)));
   update public.meetings set game_state=state,game_version=game_version+1 where id=m.id;
  end if;
 end loop;
 -- Auth user and its linked profile/identities/sessions are deleted in the same transaction.
 delete from auth.users where id=p_user;
end $$;

create or replace function public.monthly_attendance_ranking(p_month date default null)
returns table(rank bigint,user_id uuid,name text,attendance_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare month_start date;
begin
 if not public.is_approved() then raise exception '승인된 회원만 통계를 볼 수 있습니다.'; end if;
 month_start:=date_trunc('month',coalesce(p_month,(now() at time zone 'Asia/Seoul')::date))::date;
 return query
 with counts as (
  select p.id,p.name,count(*) n from public.attendance a join public.meetings m on m.id=a.meeting_id join public.profiles p on p.id=a.user_id
  where a.status='confirmed' and not m.cancelled and p.status='approved'
   and m.starts_at>=month_start::timestamp at time zone 'Asia/Seoul'
   and m.starts_at<(month_start+interval '1 month') at time zone 'Asia/Seoul' and m.starts_at<=now()
  group by p.id,p.name
 ) select dense_rank() over(order by counts.n desc),counts.id,counts.name,counts.n from counts order by counts.n desc,counts.name,counts.id;
end $$;
revoke execute on function public.admin_update_account(uuid,text),public.admin_delete_account(uuid),public.monthly_attendance_ranking(date) from public,anon;
grant execute on function public.admin_update_account(uuid,text),public.admin_delete_account(uuid),public.monthly_attendance_ranking(date) to authenticated;

-- Gate existing member RPCs, including requests, at the database boundary.
create or replace function public.roster(p_meeting uuid) returns table(user_id uuid,name text,status text,queue_id bigint)
language sql stable security definer set search_path = '' as $$
 select a.user_id,p.name,a.status,a.id from public.attendance a join public.profiles p on p.id=a.user_id
 where a.meeting_id=p_meeting and public.is_approved() order by a.id
$$;
create or replace function public.reserve(p_meeting uuid,p_cancel boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.meetings; n integer;
begin
 if not public.is_approved() then raise exception '관리자 승인이 필요한 계정입니다.'; end if;
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 select * into m from public.meetings where id=p_meeting for update;
 if not found then raise exception '모임을 찾을 수 없습니다.'; end if;
 if m.cancelled then raise exception '취소된 모임입니다.'; end if;
 if p_cancel then
  delete from public.attendance where meeting_id=p_meeting and user_id=auth.uid();
  select count(*) into n from public.attendance where meeting_id=p_meeting and status='confirmed';
  update public.attendance set status='confirmed' where id in (
   select id from public.attendance where meeting_id=p_meeting and status='waiting' order by id limit greatest(m.capacity-n,0)
  );
 else
  if exists(select 1 from public.attendance where meeting_id=p_meeting and user_id=auth.uid()) then return; end if;
  if m.starts_at < now() then raise exception '모임 시작 후에는 신청할 수 없습니다.'; end if;
  select count(*) into n from public.attendance where meeting_id=p_meeting and status='confirmed';
  insert into public.attendance(meeting_id,user_id,status) values(p_meeting,auth.uid(),case when n<m.capacity then 'confirmed' else 'waiting' end);
 end if;
end $$;
create or replace function public.submit_game_request(p_meeting uuid,p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.meetings; player text; request_id uuid;
begin
 if not public.is_approved() then raise exception '관리자 승인이 필요한 계정입니다.'; end if;
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 if p_kind is null or p_kind not in ('rest','exclude') then raise exception '잘못된 요청입니다.'; end if;
 select * into m from public.meetings where id=p_meeting for update;
 if not found or m.cancelled then raise exception '요청할 수 없는 모임입니다.'; end if;
 if (m.starts_at at time zone 'Asia/Seoul')::date <> (now() at time zone 'Asia/Seoul')::date then raise exception '모임 당일에만 요청할 수 있습니다.'; end if;
 if not exists(select 1 from public.attendance where meeting_id=p_meeting and user_id=auth.uid() and status='confirmed') then raise exception '참석 확정자만 요청할 수 있습니다.'; end if;
 if m.game_state is null then raise exception '경기 운영이 시작된 후 요청해 주세요.'; end if;
 select key into player from jsonb_each(coalesce(m.game_state->'playerProfiles','{}')) where value->>'user_id'=auth.uid()::text limit 1;
 if player is null then select name || ' · ' || left(id::text,8) into player from public.profiles where id=auth.uid(); end if;
 if coalesce(m.game_state->'excludedPlayers','[]') ? player then raise exception '이미 경기에서 제외됐습니다.'; end if;
 if p_kind='rest' and coalesce(m.game_state->'restOnce','[]') ? player then raise exception '이미 한 번 쉬기가 반영됐습니다.'; end if;
 if exists(select 1 from public.game_requests where meeting_id=p_meeting and user_id=auth.uid() and status='pending') then raise exception '이미 확인 중인 요청이 있습니다.'; end if;
 insert into public.game_requests(meeting_id,user_id,kind) values(p_meeting,auth.uid(),p_kind) returning id into request_id;
 return request_id;
end $$;
create or replace function public.cancel_game_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare request public.game_requests; meeting uuid;
begin
 if not public.is_approved() then raise exception '관리자 승인이 필요한 계정입니다.'; end if;
 select meeting_id into meeting from public.game_requests where id=p_request;
 perform 1 from public.meetings where id=meeting for update;
 select * into request from public.game_requests where id=p_request for update;
 if not found or request.user_id is distinct from auth.uid() then raise exception '본인 요청만 취소할 수 있습니다.'; end if;
 if request.status<>'pending' then raise exception '이미 처리된 요청입니다.'; end if;
 update public.game_requests set status='cancelled',resolved_at=now(),resolved_by=auth.uid() where id=p_request;
end $$;
create or replace function public.account_signup_policy() returns boolean language sql immutable set search_path='' as $$ select true $$;
revoke execute on function public.account_signup_policy() from public;
grant execute on function public.account_signup_policy() to anon,authenticated;
commit;
