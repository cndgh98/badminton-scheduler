-- Existing and new projects: run this file once after schema.sql.
begin;
create table if not exists public.game_requests (
 id uuid primary key default gen_random_uuid(),
 meeting_id uuid not null references public.meetings(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('rest','exclude')),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id)
);
create unique index if not exists one_pending_game_request on public.game_requests(meeting_id,user_id) where status='pending';
alter table public.game_requests enable row level security;
drop policy if exists read_own_game_requests on public.game_requests;
create policy read_own_game_requests on public.game_requests for select to authenticated using(user_id=auth.uid() or public.is_admin());
revoke all on public.game_requests from anon,authenticated;
grant select on public.game_requests to authenticated;

create or replace function public.submit_game_request(p_meeting uuid,p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.meetings; player text; request_id uuid;
begin
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
 select meeting_id into meeting from public.game_requests where id=p_request;
 perform 1 from public.meetings where id=meeting for update;
 select * into request from public.game_requests where id=p_request for update;
 if not found or request.user_id is distinct from auth.uid() then raise exception '본인 요청만 취소할 수 있습니다.'; end if;
 if request.status<>'pending' then raise exception '이미 처리된 요청입니다.'; end if;
 update public.game_requests set status='cancelled',resolved_at=now(),resolved_by=auth.uid() where id=p_request;
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
 if not exists(select 1 from public.attendance where meeting_id=meeting and user_id=request.user_id and status='confirmed') then raise exception '참석이 취소된 회원입니다. 요청을 반려해 주세요.'; end if;
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
revoke execute on function public.submit_game_request(uuid,text),public.cancel_game_request(uuid),public.review_game_request(uuid,boolean,jsonb,integer) from public,anon;
grant execute on function public.submit_game_request(uuid,text),public.cancel_game_request(uuid),public.review_game_request(uuid,boolean,jsonb,integer) to authenticated;
commit;
