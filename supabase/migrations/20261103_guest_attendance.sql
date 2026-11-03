-- Run after 20261030_accounts_and_statistics.sql. Existing attendance is retained.
begin;
alter table public.attendance add column if not exists participant_id uuid not null default gen_random_uuid();
create unique index if not exists attendance_participant_id_key on public.attendance(participant_id);
alter table public.attendance add column if not exists guest_number integer check(guest_number>0);
alter table public.attendance drop constraint if exists attendance_meeting_id_user_id_key;
create unique index if not exists attendance_member_once on public.attendance(meeting_id,user_id) where guest_number is null;
create unique index if not exists attendance_guest_once on public.attendance(meeting_id,user_id,guest_number) where guest_number is not null;
alter table public.meetings add column if not exists guest_counters jsonb not null default '{}';

create or replace function public.meeting_roster(p_meeting uuid)
returns table(user_id uuid,name text,status text,queue_id bigint,host_id uuid,is_guest boolean,guest_number integer,gender text)
language sql stable security definer set search_path='' as $$
 select case when a.guest_number is null then a.user_id else a.participant_id end,
  case when a.guest_number is null then p.name else p.name || '-G' || a.guest_number end,
  a.status,a.id,case when a.guest_number is not null then a.user_id end,a.guest_number is not null,a.guest_number,
  case when a.guest_number is null and public.is_admin() then p.gender end
 from public.attendance a join public.profiles p on p.id=a.user_id
 where a.meeting_id=p_meeting and public.is_approved() order by a.id
$$;
-- Old clients also receive distinct guest identities and the same display names.
create or replace function public.roster(p_meeting uuid) returns table(user_id uuid,name text,status text,queue_id bigint)
language sql stable security definer set search_path='' as $$
 select r.user_id,r.name,r.status,r.queue_id from public.meeting_roster(p_meeting) r
$$;

create or replace function public.reserve(p_meeting uuid,p_cancel boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare m public.meetings;n integer;
begin
 if not public.is_approved() then raise exception '관리자 승인이 필요한 계정입니다.'; end if;
 select * into m from public.meetings where id=p_meeting for update;
 if not found or m.cancelled then raise exception '신청할 수 없는 모임입니다.'; end if;
 if p_cancel then
  -- Cancelling the host cancels all their guests in this meeting as well.
  delete from public.attendance where meeting_id=p_meeting and user_id=auth.uid();
  select count(*) into n from public.attendance where meeting_id=p_meeting and status='confirmed';
  update public.attendance set status='confirmed' where id in(select id from public.attendance where meeting_id=p_meeting and status='waiting' order by id limit greatest(m.capacity-n,0));
 else
  if exists(select 1 from public.attendance where meeting_id=p_meeting and user_id=auth.uid() and guest_number is null) then return; end if;
  if m.starts_at<now() then raise exception '모임 시작 후에는 신청할 수 없습니다.'; end if;
  select count(*) into n from public.attendance where meeting_id=p_meeting and status='confirmed';
  insert into public.attendance(meeting_id,user_id,status) values(p_meeting,auth.uid(),case when n<m.capacity then 'confirmed' else 'waiting' end);
 end if;
end $$;

create or replace function public.reserve_guest(p_meeting uuid,p_guest uuid default null,p_cancel boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare m public.meetings;n integer;next_number integer;
begin
 if not public.is_approved() then raise exception '관리자 승인이 필요한 계정입니다.'; end if;
 select * into m from public.meetings where id=p_meeting for update;
 if not found or m.cancelled then raise exception '신청할 수 없는 모임입니다.'; end if;
 if p_cancel then
  delete from public.attendance where meeting_id=p_meeting and user_id=auth.uid() and participant_id=p_guest and guest_number is not null;
  if not found then raise exception '본인이 추가한 게스트만 취소할 수 있습니다.'; end if;
  select count(*) into n from public.attendance where meeting_id=p_meeting and status='confirmed';
  update public.attendance set status='confirmed' where id in(select id from public.attendance where meeting_id=p_meeting and status='waiting' order by id limit greatest(m.capacity-n,0));
 else
  if not exists(select 1 from public.attendance where meeting_id=p_meeting and user_id=auth.uid() and guest_number is null) then raise exception '먼저 본인 참석을 신청해 주세요.'; end if;
  if m.starts_at<now() then raise exception '모임 시작 후에는 게스트를 추가할 수 없습니다.'; end if;
  select greatest(coalesce((m.guest_counters->>auth.uid()::text)::integer,0),coalesce(max(guest_number),0))+1 into next_number from public.attendance where meeting_id=p_meeting and user_id=auth.uid();
  update public.meetings set guest_counters=jsonb_set(guest_counters,array[auth.uid()::text],to_jsonb(next_number)) where id=p_meeting;
  select count(*) into n from public.attendance where meeting_id=p_meeting and status='confirmed';
  insert into public.attendance(meeting_id,user_id,guest_number,status) values(p_meeting,auth.uid(),next_number,case when n<m.capacity then 'confirmed' else 'waiting' end);
 end if;
end $$;
revoke execute on function public.meeting_roster(uuid),public.reserve_guest(uuid,uuid,boolean) from public,anon;
grant execute on function public.meeting_roster(uuid),public.reserve_guest(uuid,uuid,boolean) to authenticated;

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
  where a.guest_number is null and a.status='confirmed' and not m.cancelled and p.status='approved'
   and m.starts_at>=month_start::timestamp at time zone 'Asia/Seoul'
   and m.starts_at<(month_start+interval '1 month') at time zone 'Asia/Seoul' and m.starts_at<=now()
  group by p.id,p.name
 ) select dense_rank() over(order by counts.n desc),counts.id,counts.name,counts.n from counts order by counts.n desc,counts.name,counts.id;
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
 if not exists(select 1 from public.attendance where meeting_id=p_meeting and user_id=auth.uid() and guest_number is null and status='confirmed') then raise exception '참석 확정자만 요청할 수 있습니다.'; end if;
 if m.game_state is null then raise exception '경기 운영이 시작된 후 요청해 주세요.'; end if;
 select key into player from jsonb_each(coalesce(m.game_state->'playerProfiles','{}')) where value->>'user_id'=auth.uid()::text limit 1;
 if player is null then select name || ' · ' || left(id::text,8) into player from public.profiles where id=auth.uid(); end if;
 if coalesce(m.game_state->'excludedPlayers','[]') ? player then raise exception '이미 경기에서 제외됐습니다.'; end if;
 if p_kind='rest' and coalesce(m.game_state->'restOnce','[]') ? player then raise exception '이미 한 번 쉬기가 반영됐습니다.'; end if;
 if exists(select 1 from public.game_requests where meeting_id=p_meeting and user_id=auth.uid() and status='pending') then raise exception '이미 확인 중인 요청이 있습니다.'; end if;
 insert into public.game_requests(meeting_id,user_id,kind) values(p_meeting,auth.uid(),p_kind) returning id into request_id;
 return request_id;
end $$;
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
  or exists(select 1 from jsonb_each(coalesce(game_state->'playerProfiles','{}')) where value->>'user_id'=p_user::text or value->>'host_id'=p_user::text)
  or position(to_jsonb(target.name || ' · ' || left(p_user::text,8))::text in coalesce(game_state::text,''))>0 or jsonb_extract_path(guest_counters,p_user::text) is not null order by id for update loop
  delete from public.attendance where meeting_id=m.id and user_id=p_user;
  if not m.cancelled then
   select count(*) into n from public.attendance where meeting_id=m.id and status='confirmed';
   update public.attendance set status='confirmed' where id in(select id from public.attendance where meeting_id=m.id and status='waiting' order by id limit greatest(m.capacity-n,0));
  end if;
  update public.meetings set guest_counters=guest_counters-p_user::text where id=m.id;
  if m.game_state is not null then
   select array_agg(k) into keys from(select e.key k from jsonb_each(coalesce(m.game_state->'playerProfiles','{}')) e where e.value->>'user_id'=p_user::text or e.value->>'host_id'=p_user::text union select target.name || ' · ' || left(p_user::text,8)) items;
   state:=m.game_state;
   foreach key in array keys loop
    replacement := case when state->'playerProfiles'->key->>'is_guest'='true' then 'deleted:guest:' || (state->'playerProfiles'->key->>'user_id') else 'deleted:' || p_user::text end;
    state:=replace(state::text,to_jsonb(key)::text,to_jsonb(replacement)::text)::jsonb;
    state:=jsonb_set(state,'{playerProfiles}',coalesce(state->'playerProfiles','{}') || jsonb_build_object(replacement,jsonb_build_object('name',case when replacement like 'deleted:guest:%' then '삭제된 회원-G' || coalesce(state->'playerProfiles'->replacement->>'guest_number','') else '삭제된 회원' end,'gender',null,'user_id',null)));
   end loop;
   replacement := 'deleted:' || p_user::text;
   state:=jsonb_set(state,'{playerProfiles}',coalesce(state->'playerProfiles','{}') || jsonb_build_object(replacement,jsonb_build_object('name','삭제된 회원','gender',null,'user_id',null)));
   update public.meetings set guest_counters=guest_counters-p_user::text,game_state=state,game_version=game_version+1 where id=m.id;
  end if;
 end loop;
 -- Auth user and its linked profile/identities/sessions are deleted in the same transaction.
 delete from auth.users where id=p_user;
end $$;
create or replace function public.review_game_request(p_request uuid,p_approve boolean,p_state jsonb default null,p_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request public.game_requests; meeting uuid; player text; next_state jsonb; next_version integer; field text;
begin
 if not public.is_admin() then raise exception '운영자만 요청을 처리할 수 있습니다.'; end if;
 if p_approve is null then raise exception '처리 방법이 필요합니다.'; end if;
 select meeting_id into meeting from public.game_requests where id=p_request;
 perform 1 from public.meetings where id=meeting for update;
 select * into request from public.game_requests where id=p_request for update;
 if not found or request.status<>'pending' then raise exception '이미 처리됐거나 없는 요청입니다.'; end if;
 if not p_approve then
  update public.game_requests set status='rejected',resolved_at=now(),resolved_by=auth.uid() where id=p_request;
  return jsonb_build_object('status','rejected');
 end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or p_version is null then raise exception '경기 상태를 새로고침해 주세요.'; end if;
 if not exists(select 1 from public.attendance where meeting_id=meeting and user_id=request.user_id and guest_number is null and status='confirmed') then raise exception '참석이 취소된 회원입니다. 요청을 반려해 주세요.'; end if;
 select key into player from jsonb_each(coalesce(p_state->'playerProfiles','{}')) where value->>'user_id'=request.user_id::text limit 1;
 if player is null then select name || ' · ' || left(id::text,8) into player from public.profiles where id=request.user_id; end if;
 if not (coalesce(p_state->'participants','[]') ? player or coalesce(p_state->'priorityCarry','[]') ? player) then raise exception '선수가 대기 인원으로 돌아온 후 승인해 주세요.'; end if;
 next_state := p_state;
 if request.kind='rest' then
  select coalesce(jsonb_agg(value),'[]') into next_state from (select distinct value from jsonb_array_elements_text(coalesce(p_state->'restOnce','[]') || jsonb_build_array(player))) items;
  next_state := p_state || jsonb_build_object('restOnce',next_state);
 else
  foreach field in array array['participants','priorityCarry','restOnce'] loop
   next_state := jsonb_set(next_state,array[field],coalesce((select jsonb_agg(value) from jsonb_array_elements_text(coalesce(next_state->field,'[]')) where value<>player),'[]'));
  end loop;
  next_state := next_state || jsonb_build_object('excludedPlayers',coalesce(next_state->'excludedPlayers','[]') || jsonb_build_array(player));
 end if;
 next_version := public.save_game(meeting,next_state,p_version);
 update public.game_requests set status='approved',resolved_at=now(),resolved_by=auth.uid() where id=p_request;
 return jsonb_build_object('status','approved','game_state',next_state,'version',next_version);
end $$;
commit;
