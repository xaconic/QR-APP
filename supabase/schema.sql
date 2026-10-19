create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  ,is_active boolean not null default true
  ,deactivated_at timestamptz
  ,teacher_requested_at timestamptz
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  event_code  text not null unique,
  title       text not null,
  start_time  timestamptz,
  end_time    timestamptz,
  late_time   timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open', 'closed'))
  ,venue      text
  ,description text
  ,archived_at timestamptz
  ,audience_mode text not null default 'all' check (audience_mode in ('all', 'groups', 'legacy'))
);

create table if not exists public.event_code_aliases (
  event_id uuid not null references public.events (id) on delete cascade,
  event_code text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  scanned_at timestamptz not null default now(),
  status     text not null default 'present' check (status in ('present', 'absent', 'late', 'excused')),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (student_id, event_id)
);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.attendance enable row level security;
alter table public.event_code_aliases enable row level security;
revoke all on public.event_code_aliases from authenticated;

create or replace function public.prevent_event_code_alias_collision()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'events' and exists (select 1 from public.event_code_aliases where event_code = new.event_code) then raise exception 'Event code already reserved by an alias'; end if;
  if tg_table_name = 'event_code_aliases' and exists (select 1 from public.events where event_code = new.event_code) then raise exception 'Event code alias conflicts with current event code'; end if;
  return new;
end;
$$;
drop trigger if exists prevent_event_code_alias_collision on public.events;
create trigger prevent_event_code_alias_collision before insert or update of event_code on public.events for each row execute function public.prevent_event_code_alias_collision();
drop trigger if exists prevent_alias_current_code_collision on public.event_code_aliases;
create trigger prevent_alias_current_code_collision before insert or update of event_code on public.event_code_aliases for each row execute function public.prevent_event_code_alias_collision();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

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
    if new.is_active is distinct from old.is_active
      or new.deactivated_at is distinct from old.deactivated_at then
      raise exception 'Account activation can only be changed by an administrator';
    end if;
    if new.role = 'admin' and not public.is_admin() then
      raise exception 'Administrator role cannot be assigned by an authenticated client';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

drop policy if exists "Profiles are viewable by owner" on public.profiles;
create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "Users can insert their own profile" on public.profiles;
revoke insert, delete on public.profiles from public, anon, authenticated;
revoke update on public.profiles from public, anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id and is_active)
  with check (auth.uid() = id and is_active);

create or replace function public.update_own_profile_name(p_full_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to update a profile name';
  end if;

  update public.profiles
  set full_name = nullif(btrim(coalesce(p_full_name, '')), '')
  where id = current_user_id
    and is_active;

  if not found then
    raise exception 'Profile could not be updated. The account may be inactive.';
  end if;

  return true;
end;
$$;

revoke all on function public.update_own_profile_name(text) from public, anon;
grant execute on function public.update_own_profile_name(text) to authenticated;

drop policy if exists "Events are readable by any authenticated user" on public.events;
create policy "Events are readable by any authenticated user"
  on public.events for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Users can insert events" on public.events;
create policy "Users can insert events"
  on public.events for insert
  to authenticated
  with check (
    auth.uid() = created_by
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin') and is_active)
  );

drop policy if exists "Users can update their own events" on public.events;
revoke update on public.events from authenticated;

drop policy if exists "Students can view their own attendance" on public.attendance;
create policy "Students can view their own attendance"
  on public.attendance for select
  to authenticated
  using (
    auth.uid() = student_id
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and is_active
    )
  );

drop policy if exists "Students can insert their own attendance" on public.attendance;

drop policy if exists "Teachers can view attendance for their events" on public.attendance;
create policy "Teachers can view attendance for their events"
  on public.attendance for select
  to authenticated
  using (
    exists (
      select 1
      from public.events
      where public.events.id = attendance.event_id
        and public.events.created_by = auth.uid()
        and exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'teacher' and is_active
        )
    )
  );

drop policy if exists "Administrators can view all attendance" on public.attendance;
create policy "Administrators can view all attendance"
  on public.attendance for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Administrators can view all events" on public.events;
create policy "Administrators can view all events"
  on public.events for select
  to authenticated
  using (public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, email, full_name, role, teacher_requested_at)
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    'student',
    case when requested_role = 'teacher' then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create profiles for users who already signed up before this trigger existed.
insert into public.profiles (id, email)
select id, email
from auth.users
on conflict (id) do nothing;

create or replace function public.set_event_status(p_event_id uuid, p_status text)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.events;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;
  select * into target from public.events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not (target.created_by = auth.uid() or public.is_admin()) then
    raise exception 'Not authorized to change this event';
  end if;
  update public.events set status = p_status where id = p_event_id returning * into target;
  return target;
end;
$$;

create or replace function public.register_attendance(p_event_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target public.events;
  checkin_status text := 'present';
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = current_user_id and role = 'student') then
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
  if target.late_time is not null and now() >= target.late_time then checkin_status := 'late'; end if;
  begin
    insert into public.attendance (student_id, event_id, status, recorded_by, recorded_at)
    values (current_user_id, target.id, checkin_status, current_user_id, now());
  exception when unique_violation then
    raise exception 'Already registered for this event';
  end;
  return jsonb_build_object('event_title', target.title, 'event_id', target.id);
end;
$$;

revoke all on function public.set_event_status(uuid, text) from public;
grant execute on function public.set_event_status(uuid, text) to authenticated;
revoke all on function public.register_attendance(text) from public;
grant execute on function public.register_attendance(text) to authenticated;
revoke insert on public.attendance from authenticated;

create or replace function public.update_event(
  p_event_id uuid, p_event_code text, p_title text, p_start_time timestamptz,
  p_end_time timestamptz, p_venue text, p_description text, p_status text
)
returns public.events
language plpgsql security definer set search_path = public
as $$
declare current_event public.events; old_event_code text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;
  if p_event_code is null or btrim(p_event_code) = '' or length(p_event_code) > 40 or p_event_code !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid event code'; end if;
  if p_title is null or btrim(p_title) = '' or length(p_title) > 120 then raise exception 'Event title is required'; end if;
  if p_venue is not null and length(p_venue) > 160 then raise exception 'Venue is too long'; end if;
  if p_description is not null and length(p_description) > 2000 then raise exception 'Description is too long'; end if;
  if p_start_time is not null and p_end_time is not null and p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;
  select * into current_event from public.events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not (current_event.created_by = auth.uid() or public.is_admin()) then raise exception 'Not authorized to edit this event'; end if;
  old_event_code := current_event.event_code;
  if exists (select 1 from public.events where event_code = p_event_code and id <> p_event_id) or exists (select 1 from public.event_code_aliases where event_code = p_event_code and event_id <> p_event_id) then raise exception 'Event code already in use'; end if;
  update public.events set event_code=p_event_code, title=btrim(p_title), start_time=p_start_time, end_time=p_end_time, venue=nullif(btrim(p_venue), ''), description=nullif(btrim(p_description), ''), status=p_status where id=p_event_id returning * into current_event;
  if old_event_code is distinct from p_event_code then insert into public.event_code_aliases (event_id, event_code) values (p_event_id, old_event_code); end if;
  return current_event;
end;
$$;
revoke all on function public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.update_event(uuid, text, text, timestamptz, timestamptz, text, text, text) to authenticated;

create or replace function public.admin_update_profile(p_user_id uuid, p_full_name text)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare target public.profiles;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_full_name is not null and length(btrim(p_full_name)) > 120 then raise exception 'Name is too long'; end if;
  update public.profiles set full_name=nullif(btrim(p_full_name), ''), updated_at=now() where id=p_user_id returning * into target;
  if not found then raise exception 'User not found'; end if; return target;
end; $$;

create or replace function public.admin_deactivate_user(p_user_id uuid)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare target public.profiles; active_admins integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_user_id=auth.uid() then raise exception 'You cannot deactivate your own administrator account'; end if;
  select * into target from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if target.role='admin' and target.is_active then
    select count(*) into active_admins from public.profiles where role='admin' and is_active;
    if active_admins <= 1 then raise exception 'The last active administrator cannot be deactivated'; end if;
  end if;
  update public.profiles set is_active=false, deactivated_at=now(), updated_at=now() where id=p_user_id returning * into target; return target;
end; $$;

create or replace function public.admin_archive_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public
as $$ declare target public.events;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.events set archived_at=coalesce(archived_at, now()), status='closed' where id=p_event_id returning * into target;
  if not found then raise exception 'Event not found'; end if; return target;
end; $$;

revoke all on function public.admin_update_profile(uuid, text) from public;
grant execute on function public.admin_update_profile(uuid, text) to authenticated;
revoke all on function public.admin_deactivate_user(uuid) from public;
grant execute on function public.admin_deactivate_user(uuid) to authenticated;
revoke all on function public.admin_archive_event(uuid) from public;
grant execute on function public.admin_archive_event(uuid) to authenticated;

create or replace function public.get_event_audience_scope(p_event_id uuid)
returns table (course_id uuid, year_level_id uuid, section_id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  return query select a.course_id, a.year_level_id, a.section_id
    from public.event_audience a where a.event_id = p_event_id;
end; $$;

revoke all on function public.get_event_audience_scope(uuid) from public;
grant execute on function public.get_event_audience_scope(uuid) to authenticated;

create or replace function public.delete_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public
as $$
declare target public.events;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into target from public.events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher' and is_active)
     or target.created_by is distinct from auth.uid() then
    raise exception 'Not authorized to delete this event';
  end if;
  delete from public.events where id = p_event_id;
  return target;
end; $$;

revoke all on function public.delete_event(uuid) from public;
grant execute on function public.delete_event(uuid) to authenticated;

-- Human-readable IDs (UUIDs remain the internal primary and foreign keys).
create sequence if not exists public.student_number_seq;
create sequence if not exists public.teacher_number_seq;
create sequence if not exists public.admin_number_seq;
create sequence if not exists public.attendance_number_seq;
alter table public.profiles add column if not exists display_id text;
alter table public.attendance add column if not exists display_id text;

create or replace function public.assign_profile_display_id()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
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
end; $$;
drop trigger if exists assign_profile_display_id on public.profiles;
create trigger assign_profile_display_id before insert on public.profiles for each row execute function public.assign_profile_display_id();

create or replace function public.assign_attendance_display_id()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  new.display_id := 'ATT-' || lpad(nextval('public.attendance_number_seq')::text, 6, '0');
  return new;
end; $$;
drop trigger if exists assign_attendance_display_id on public.attendance;
create trigger assign_attendance_display_id before insert on public.attendance for each row execute function public.assign_attendance_display_id();

update public.profiles p set display_id = case p.role
  when 'student' then 'STU-' || lpad(nextval('public.student_number_seq')::text, 4, '0')
  when 'teacher' then 'TCH-' || lpad(nextval('public.teacher_number_seq')::text, 4, '0')
  when 'admin' then 'ADM-' || lpad(nextval('public.admin_number_seq')::text, 4, '0')
end where p.display_id is null;
update public.attendance set display_id = 'ATT-' || lpad(nextval('public.attendance_number_seq')::text, 6, '0') where display_id is null;
alter table public.profiles alter column display_id set not null;
alter table public.attendance alter column display_id set not null;
create unique index if not exists profiles_display_id_key on public.profiles(display_id);
create unique index if not exists attendance_display_id_key on public.attendance(display_id);

revoke insert, update, delete on public.attendance from public, anon, authenticated;
revoke insert, update, delete on public.events from public, anon, authenticated;
