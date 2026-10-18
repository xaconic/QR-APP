-- Add human-readable identifiers while preserving UUID primary keys and relationships.

create sequence if not exists public.student_number_seq;
create sequence if not exists public.teacher_number_seq;
create sequence if not exists public.admin_number_seq;
create sequence if not exists public.attendance_number_seq;

alter table public.profiles add column if not exists display_id text;
alter table public.attendance add column if not exists display_id text;

-- Seed sequences from any already-assigned IDs so migrations are repeatable.
select setval('public.student_number_seq', coalesce((select max((substring(display_id from 5))::bigint) from public.profiles where display_id ~ '^STU-[0-9]+$'), 1), exists (select 1 from public.profiles where display_id ~ '^STU-[0-9]+$'));
select setval('public.teacher_number_seq', coalesce((select max((substring(display_id from 5))::bigint) from public.profiles where display_id ~ '^TCH-[0-9]+$'), 1), exists (select 1 from public.profiles where display_id ~ '^TCH-[0-9]+$'));
select setval('public.admin_number_seq', coalesce((select max((substring(display_id from 5))::bigint) from public.profiles where display_id ~ '^ADM-[0-9]+$'), 1), exists (select 1 from public.profiles where display_id ~ '^ADM-[0-9]+$'));
select setval('public.attendance_number_seq', coalesce((select max((substring(display_id from 5))::bigint) from public.attendance where display_id ~ '^ATT-[0-9]+$'), 1), exists (select 1 from public.attendance where display_id ~ '^ATT-[0-9]+$'));

create or replace function public.assign_profile_display_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role not in ('student', 'teacher', 'admin') then
    raise exception 'Invalid profile role';
  end if;
  new.display_id := case new.role
    when 'student' then 'STU-' || lpad(nextval('public.student_number_seq')::text, 4, '0')
    when 'teacher' then 'TCH-' || lpad(nextval('public.teacher_number_seq')::text, 4, '0')
    when 'admin' then 'ADM-' || lpad(nextval('public.admin_number_seq')::text, 4, '0')
    else null
  end;
  return new;
end;
$$;

drop trigger if exists assign_profile_display_id on public.profiles;
create trigger assign_profile_display_id
before insert on public.profiles
for each row execute function public.assign_profile_display_id();

-- Registration metadata supplies the intended non-admin role before the profile
-- trigger assigns its ID, so teachers receive TCH IDs on their first insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    case when requested_role in ('student', 'teacher') then requested_role else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill deterministically without changing profile UUIDs.
with missing as (
  select id, role, row_number() over (partition by role order by created_at, id) as n
  from public.profiles
  where display_id is null
)
update public.profiles p
set display_id = case missing.role
  when 'student' then 'STU-' || lpad((nextval('public.student_number_seq'))::text, 4, '0')
  when 'teacher' then 'TCH-' || lpad((nextval('public.teacher_number_seq'))::text, 4, '0')
  when 'admin' then 'ADM-' || lpad((nextval('public.admin_number_seq'))::text, 4, '0')
end
from missing
where p.id = missing.id;

create or replace function public.assign_attendance_display_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.display_id := 'ATT-' || lpad(nextval('public.attendance_number_seq')::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists assign_attendance_display_id on public.attendance;
create trigger assign_attendance_display_id
before insert on public.attendance
for each row execute function public.assign_attendance_display_id();

update public.attendance
set display_id = 'ATT-' || lpad(nextval('public.attendance_number_seq')::text, 6, '0')
where display_id is null;

alter table public.profiles alter column display_id set not null;
alter table public.attendance alter column display_id set not null;
create unique index if not exists profiles_display_id_key on public.profiles (display_id);
create unique index if not exists attendance_display_id_key on public.attendance (display_id);
create index if not exists profiles_display_id_search_idx on public.profiles (lower(display_id));

-- Clients may not rewrite a readable identifier after it has been assigned.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.id is distinct from old.id then
      raise exception 'Profile ID cannot be changed by an authenticated client';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Profile email cannot be changed through profile updates';
    end if;
    if new.display_id is distinct from old.display_id then
      raise exception 'Profile display ID cannot be changed';
    end if;
    if new.role is distinct from old.role then
      raise exception 'Profile role cannot be changed through profile updates';
    end if;
    if new.role = 'admin' and not public.is_admin() then
      raise exception 'Administrator role cannot be assigned by an authenticated client';
    end if;
  end if;
  return new;
end;
$$;

-- Return the readable attendance ID to callers without exposing it as a key.
create or replace function public.register_attendance(p_event_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target public.events;
  new_attendance public.attendance;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'student' and is_active) then
    raise exception 'Student is not eligible';
  end if;
  select e.* into target from public.events e where e.event_code = trim(p_event_code)
  union all
  select e.* from public.events e join public.event_code_aliases a on a.event_id = e.id where a.event_code = trim(p_event_code)
  limit 1;
  if not found then raise exception 'Unknown event'; end if;
  if target.status <> 'open' then raise exception 'Event is closed'; end if;
  if target.start_time is not null and now() < target.start_time then raise exception 'Event has not started yet'; end if;
  if target.end_time is not null and now() > target.end_time then raise exception 'Event has already ended'; end if;
  begin
    insert into public.attendance (student_id, event_id) values (current_user_id, target.id) returning * into new_attendance;
  exception when unique_violation then
    raise exception 'Already registered for this event';
  end;
  return jsonb_build_object('event_title', target.title, 'event_id', target.id, 'attendance_id', new_attendance.display_id);
end;
$$;

revoke all on function public.assign_profile_display_id() from public;
revoke all on function public.assign_attendance_display_id() from public;
revoke all on sequence public.student_number_seq, public.teacher_number_seq, public.admin_number_seq, public.attendance_number_seq from authenticated, anon;
revoke all on function public.register_attendance(text) from public;
grant execute on function public.register_attendance(text) to authenticated;
