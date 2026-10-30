-- Run once in a new Supabase project's SQL Editor.
-- Then run migrations/20261030_game_requests.sql to enable member game requests.
begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{4,24}$'),
 name text not null check (length(trim(name)) between 1 and 40),
 gender text not null check (gender in ('남성','여성')),
 role text not null default 'member' check (role in ('admin','member'))
);
create function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,username,name,gender)
 values(new.id,lower(new.raw_user_meta_data->>'username'),trim(new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'gender');
 return new;
end $$;
create trigger create_profile after insert on auth.users for each row execute function public.create_profile();
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin')
$$;
create table public.meetings (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(trim(title)) between 1 and 100),
 starts_at timestamptz not null,
 location text not null check(length(trim(location)) between 1 and 200),
 capacity integer not null check(capacity between 1 and 500),
 created_by uuid not null default auth.uid() references public.profiles(id),
 cancelled boolean not null default false,
 game_state jsonb,
 game_version integer not null default 0
);
create table public.attendance (
 id bigint generated always as identity primary key,
 meeting_id uuid not null references public.meetings(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 status text not null check(status in ('confirmed','waiting')),
 joined_at timestamptz not null default now(),
 unique(meeting_id,user_id)
);
create index attendance_queue on public.attendance(meeting_id,status,id);
alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.attendance enable row level security;
-- Profiles are private; attendee names are exposed only through the roster RPC.
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy read_meetings on public.meetings for select to authenticated using(true);
create policy insert_meetings on public.meetings for insert to authenticated with check(public.is_admin() and created_by=auth.uid() and game_state is null and game_version=0 and cancelled=false);
create policy read_attendance on public.attendance for select to authenticated using(true);
revoke all on public.profiles,public.meetings,public.attendance from anon,authenticated;
grant select on public.profiles,public.meetings,public.attendance to authenticated;
grant insert(title,starts_at,location,capacity) on public.meetings to authenticated;

create function public.roster(p_meeting uuid) returns table(user_id uuid,name text,status text,queue_id bigint)
language sql stable security definer set search_path = '' as $$
 select a.user_id,p.name,a.status,a.id from public.attendance a join public.profiles p on p.id=a.user_id
 where a.meeting_id=p_meeting and auth.uid() is not null order by a.id
$$;
create function public.reserve(p_meeting uuid,p_cancel boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.meetings; n integer;
begin
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

create function public.cancel_meeting(p_meeting uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception '관리자만 취소할 수 있습니다.'; end if;
 perform 1 from public.meetings where id=p_meeting for update;
 update public.meetings set cancelled=true where id=p_meeting;
end $$;

create function public.save_game(p_meeting uuid,p_state jsonb,p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare m public.meetings;
begin
 if not public.is_admin() then raise exception '관리자만 경기 운영을 할 수 있습니다.'; end if;
 select * into m from public.meetings where id=p_meeting for update;
 if not found or m.cancelled then raise exception '운영할 수 없는 모임입니다.'; end if;
 if (m.starts_at at time zone 'Asia/Seoul')::date <> (now() at time zone 'Asia/Seoul')::date then raise exception '모임 당일에만 경기 운영이 가능합니다.'; end if;
 if m.game_version <> p_version then raise exception '다른 관리자가 변경했습니다. 새로고침 후 다시 시도하세요.'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' then raise exception '잘못된 경기 상태입니다.'; end if;
 update public.meetings set game_state=p_state,game_version=game_version+1 where id=p_meeting;
 return m.game_version+1;
end $$;
revoke execute on function public.create_profile(),public.is_admin(),public.roster(uuid),public.reserve(uuid,boolean),public.cancel_meeting(uuid),public.save_game(uuid,jsonb,integer) from public,anon;
grant execute on function public.is_admin(),public.roster(uuid),public.reserve(uuid,boolean),public.cancel_meeting(uuid),public.save_game(uuid,jsonb,integer) to authenticated;
commit;
