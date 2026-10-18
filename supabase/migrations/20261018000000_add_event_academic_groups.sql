-- Event-based academic grouping and scoped attendance management.
-- Existing UUIDs, events, attendance rows, and QR behavior remain intact.

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.year_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  year_level_id uuid not null references public.year_levels(id) on delete restrict,
  section_code text not null,
  section_name text not null,
  academic_year text not null,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, year_level_id, section_code, academic_year)
);

alter table public.profiles add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.profiles add column if not exists year_level_id uuid references public.year_levels(id) on delete set null;
alter table public.profiles add column if not exists section_id uuid references public.academic_sections(id) on delete set null;

create table if not exists public.student_academic_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  year_level_id uuid not null references public.year_levels(id) on delete restrict,
  section_id uuid not null references public.academic_sections(id) on delete restrict,
  academic_year text not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists one_active_student_academic_assignment
  on public.student_academic_assignments(student_id) where ended_at is null;

create table if not exists public.event_staff (
  event_id uuid not null references public.events(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  can_manage boolean not null default true,
  assigned_at timestamptz not null default now(),
  primary key (event_id, teacher_id)
);

grant usage on schema public to anon, authenticated;
grant select on public.courses, public.year_levels, public.academic_sections to anon, authenticated;
grant select on public.student_academic_assignments, public.event_staff to authenticated;

alter table public.attendance add column if not exists status text not null default 'present';
alter table public.attendance add column if not exists recorded_by uuid references public.profiles(id) on delete set null;
alter table public.attendance add column if not exists recorded_at timestamptz not null default now();
alter table public.events add column if not exists event_status text not null default 'upcoming';
alter table public.events drop constraint if exists events_event_status_check;
alter table public.events add constraint events_event_status_check check (event_status in ('upcoming', 'ongoing', 'completed', 'cancelled'));
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check check (status in ('present', 'absent', 'late', 'excused'));
update public.attendance set recorded_by = student_id where recorded_by is null;
update public.events
set event_status = case
  when event_status = 'cancelled' then 'cancelled'
  when end_time is not null and end_time < now() then 'completed'
  when start_time is not null and start_time <= now() and (end_time is null or end_time >= now()) then 'ongoing'
  else 'upcoming'
end;

create or replace function public.validate_profile_academic_group()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_section public.academic_sections;
begin
  if new.role <> 'student' and (new.course_id is not null or new.year_level_id is not null or new.section_id is not null) then
    raise exception 'Only students may have academic assignments';
  end if;
  if new.role = 'student' and (new.course_id is not null or new.year_level_id is not null or new.section_id is not null) then
    if new.course_id is null or new.year_level_id is null or new.section_id is null then
      raise exception 'Course, year level, and section must be provided together';
    end if;
    select * into target_section from public.academic_sections where id = new.section_id and is_active;
    if not found or target_section.course_id <> new.course_id or target_section.year_level_id <> new.year_level_id then
      raise exception 'Invalid course, year level, and section combination';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists validate_profile_academic_group on public.profiles;
create trigger validate_profile_academic_group
before insert or update of role, course_id, year_level_id, section_id on public.profiles
for each row execute function public.validate_profile_academic_group();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare requested_role text := new.raw_user_meta_data ->> 'role';
begin
  if requested_role = 'student' and (
    nullif(new.raw_user_meta_data ->> 'course_id', '') is null or
    nullif(new.raw_user_meta_data ->> 'year_level_id', '') is null or
    nullif(new.raw_user_meta_data ->> 'section_id', '') is null
  ) then
    raise exception 'Student academic information is required';
  end if;
  insert into public.profiles (
    id, email, full_name, role, course_id, year_level_id, section_id
  ) values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    case when requested_role in ('student', 'teacher') then requested_role else 'student' end,
    case when requested_role = 'student' then nullif(new.raw_user_meta_data ->> 'course_id', '')::uuid end,
    case when requested_role = 'student' then nullif(new.raw_user_meta_data ->> 'year_level_id', '')::uuid end,
    case when requested_role = 'student' then nullif(new.raw_user_meta_data ->> 'section_id', '')::uuid end
  ) on conflict (id) do nothing;
  if requested_role = 'student' and nullif(new.raw_user_meta_data ->> 'section_id', '') is not null then
    insert into public.student_academic_assignments(student_id, course_id, year_level_id, section_id, academic_year)
    select new.id, s.course_id, s.year_level_id, s.id, s.academic_year
    from public.academic_sections s
    where s.id = nullif(new.raw_user_meta_data ->> 'section_id', '')::uuid
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.set_attendance_recorder()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.recorded_by is null then new.recorded_by := new.student_id; end if;
  if new.recorded_at is null then new.recorded_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists set_attendance_recorder on public.attendance;
create trigger set_attendance_recorder
before insert on public.attendance
for each row execute function public.set_attendance_recorder();

create or replace function public.is_event_manager(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.event_staff s
    where s.event_id = p_event_id and s.teacher_id = auth.uid() and s.can_manage
  ) or exists (
    select 1 from public.events e
    where e.id = p_event_id and e.created_by = auth.uid()
  );
$$;

create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.id is distinct from old.id then raise exception 'Profile ID cannot be changed by an authenticated client'; end if;
    if new.email is distinct from old.email then raise exception 'Profile email cannot be changed through profile updates'; end if;
    if new.display_id is distinct from old.display_id then raise exception 'Profile display ID cannot be changed'; end if;
    if new.role is distinct from old.role and not public.is_admin() then raise exception 'Profile role cannot be changed through profile updates'; end if;
    if (new.course_id, new.year_level_id, new.section_id) is distinct from (old.course_id, old.year_level_id, old.section_id)
      and not public.is_admin() then raise exception 'Academic assignment cannot be changed through profile updates'; end if;
    if new.role = 'admin' and not public.is_admin() then raise exception 'Administrator role cannot be assigned by an authenticated client'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields before update on public.profiles for each row execute function public.protect_profile_privileged_fields();

alter table public.courses enable row level security;
alter table public.year_levels enable row level security;
alter table public.academic_sections enable row level security;
alter table public.student_academic_assignments enable row level security;
alter table public.event_staff enable row level security;

drop policy if exists "Academic catalogs are readable" on public.courses;
create policy "Academic catalogs are readable" on public.courses for select to anon, authenticated using (is_active or public.is_admin());
drop policy if exists "Year levels are readable" on public.year_levels;
create policy "Year levels are readable" on public.year_levels for select to anon, authenticated using (is_active or public.is_admin());
drop policy if exists "Sections are readable" on public.academic_sections;
create policy "Sections are readable" on public.academic_sections for select to anon, authenticated using (is_active or public.is_admin());
drop policy if exists "Student assignments are scoped" on public.student_academic_assignments;
create policy "Student assignments are scoped" on public.student_academic_assignments for select to authenticated
using (student_id = auth.uid() or public.is_admin());
drop policy if exists "Event staff are scoped" on public.event_staff;
create policy "Event staff are scoped" on public.event_staff for select to authenticated
using (teacher_id = auth.uid() or public.is_admin() or public.is_event_manager(event_id));

drop policy if exists "Teachers can view authorized event attendance" on public.attendance;
create policy "Teachers can view authorized event attendance" on public.attendance for select to authenticated
using (auth.uid() = student_id or public.is_admin() or public.is_event_manager(event_id));
drop policy if exists "Teachers can update authorized event attendance" on public.attendance;
create policy "Teachers can update authorized event attendance" on public.attendance for update to authenticated
using (public.is_event_manager(event_id)) with check (public.is_event_manager(event_id));
revoke insert, update, delete on public.attendance from authenticated;

create or replace function public.admin_create_course(p_code text, p_name text)
returns public.courses language plpgsql security definer set search_path = public
as $$ declare result public.courses;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  insert into public.courses(code, name, created_by) values (upper(btrim(p_code)), btrim(p_name)) returning * into result;
  return result;
end; $$;

create or replace function public.admin_create_year_level(p_name text, p_sort_order integer default 0)
returns public.year_levels language plpgsql security definer set search_path = public
as $$ declare result public.year_levels;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  insert into public.year_levels(name, sort_order) values (btrim(p_name), p_sort_order) returning * into result;
  return result;
end; $$;

create or replace function public.admin_create_section(
  p_course_id uuid, p_year_level_id uuid, p_section_code text, p_section_name text, p_academic_year text
)
returns public.academic_sections language plpgsql security definer set search_path = public
as $$ declare result public.academic_sections;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.courses where id = p_course_id and is_active) then raise exception 'Course not found'; end if;
  if not exists (select 1 from public.year_levels where id = p_year_level_id and is_active) then raise exception 'Year level not found'; end if;
  insert into public.academic_sections(course_id, year_level_id, section_code, section_name, academic_year, created_by)
  values (p_course_id, p_year_level_id, upper(btrim(p_section_code)), btrim(p_section_name), btrim(p_academic_year), auth.uid())
  returning * into result;
  return result;
end; $$;

create or replace function public.admin_assign_student(
  p_student_id uuid, p_course_id uuid, p_year_level_id uuid, p_section_id uuid, p_academic_year text
)
returns public.profiles language plpgsql security definer set search_path = public
as $$ declare result public.profiles; target public.academic_sections;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  select * into target from public.academic_sections where id = p_section_id and is_active;
  if not found or target.course_id <> p_course_id or target.year_level_id <> p_year_level_id or target.academic_year <> p_academic_year then
    raise exception 'Invalid academic group';
  end if;
  update public.student_academic_assignments set ended_at = now()
  where student_id = p_student_id and ended_at is null;
  insert into public.student_academic_assignments(student_id, course_id, year_level_id, section_id, academic_year)
  values (p_student_id, p_course_id, p_year_level_id, p_section_id, p_academic_year);
  update public.profiles set course_id=p_course_id, year_level_id=p_year_level_id, section_id=p_section_id, updated_at=now()
  where id=p_student_id and role='student' returning * into result;
  if not found then raise exception 'Student not found'; end if;
  return result;
end; $$;

create or replace function public.admin_assign_event_staff(p_event_id uuid, p_teacher_id uuid)
returns public.event_staff language plpgsql security definer set search_path = public
as $$ declare result public.event_staff;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.events where id=p_event_id) then raise exception 'Event not found'; end if;
  if not exists (select 1 from public.profiles where id=p_teacher_id and role='teacher' and is_active) then raise exception 'Teacher not found'; end if;
  insert into public.event_staff(event_id, teacher_id) values (p_event_id, p_teacher_id)
  on conflict (event_id, teacher_id) do update set can_manage=true
  returning * into result;
  return result;
end; $$;

create or replace function public.admin_update_section(p_section_id uuid, p_section_code text, p_section_name text)
returns public.academic_sections language plpgsql security definer set search_path = public
as $$ declare result public.academic_sections;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.academic_sections set section_code=upper(btrim(p_section_code)), section_name=btrim(p_section_name), updated_at=now()
  where id=p_section_id and is_active returning * into result;
  if not found then raise exception 'Section not found'; end if;
  return result;
end; $$;

create or replace function public.admin_archive_section(p_section_id uuid)
returns public.academic_sections language plpgsql security definer set search_path = public
as $$ declare result public.academic_sections;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.academic_sections set is_active=false, archived_at=coalesce(archived_at, now()), updated_at=now()
  where id=p_section_id returning * into result;
  if not found then raise exception 'Section not found'; end if;
  return result;
end; $$;

create or replace function public.record_event_attendance(p_event_id uuid, p_student_id uuid, p_status text)
returns public.attendance language plpgsql security definer set search_path = public
as $$ declare result public.attendance; event_row public.events;
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if p_status not in ('present','absent','late','excused') then raise exception 'Invalid attendance status'; end if;
  select * into event_row from public.events where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if event_row.event_status='cancelled' then raise exception 'Event is cancelled'; end if;
  if not exists (select 1 from public.profiles where id=p_student_id and role='student' and is_active) then raise exception 'Student not found'; end if;
  insert into public.attendance(student_id,event_id,status,recorded_by,recorded_at)
  values (p_student_id,p_event_id,p_status,auth.uid(),now())
  on conflict (student_id,event_id) do update set status=excluded.status, recorded_by=excluded.recorded_by, recorded_at=excluded.recorded_at
  returning * into result;
  return result;
end; $$;

create or replace function public.get_event_attendance_summary(
  p_event_id uuid, p_course_id uuid default null, p_year_level_id uuid default null,
  p_section_id uuid default null, p_status text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  select jsonb_build_object(
    'total', count(*),
    'present', count(*) filter (where a.status='present'),
    'absent', count(*) filter (where a.status='absent'),
    'late', count(*) filter (where a.status='late'),
    'excused', count(*) filter (where a.status='excused'),
    'unmarked', count(*) filter (where a.id is null),
    'students', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'display_id', p.display_id, 'full_name', p.full_name, 'email', p.email,
      'course_id', p.course_id, 'year_level_id', p.year_level_id, 'section_id', p.section_id,
      'attendance_id', a.display_id, 'status', a.status, 'recorded_at', a.recorded_at
    ) order by p.full_name), '[]'::jsonb)
  ) into result
  from public.profiles p
  left join public.attendance a on a.student_id=p.id and a.event_id=p_event_id
  where p.role='student' and p.is_active
    and (p_course_id is null or p.course_id=p_course_id)
    and (p_year_level_id is null or p.year_level_id=p_year_level_id)
    and (p_section_id is null or p.section_id=p_section_id)
    and (p_status is null or a.status=p_status);
  return result;
end; $$;

revoke all on function public.is_event_manager(uuid) from public;
grant execute on function public.is_event_manager(uuid) to authenticated;
revoke all on function public.admin_create_course(text,text) from public;
grant execute on function public.admin_create_course(text,text) to authenticated;
revoke all on function public.admin_create_year_level(text,integer) from public;
grant execute on function public.admin_create_year_level(text,integer) to authenticated;
revoke all on function public.admin_create_section(uuid,uuid,text,text,text) from public;
grant execute on function public.admin_create_section(uuid,uuid,text,text,text) to authenticated;
revoke all on function public.admin_assign_student(uuid,uuid,uuid,uuid,text) from public;
grant execute on function public.admin_assign_student(uuid,uuid,uuid,uuid,text) to authenticated;
revoke all on function public.admin_assign_event_staff(uuid,uuid) from public;
grant execute on function public.admin_assign_event_staff(uuid,uuid) to authenticated;
revoke all on function public.admin_update_section(uuid,text,text) from public;
grant execute on function public.admin_update_section(uuid,text,text) to authenticated;
revoke all on function public.admin_archive_section(uuid) from public;
grant execute on function public.admin_archive_section(uuid) to authenticated;
revoke all on function public.record_event_attendance(uuid,uuid,text) from public;
grant execute on function public.record_event_attendance(uuid,uuid,text) to authenticated;
revoke all on function public.get_event_attendance_summary(uuid,uuid,uuid,uuid,text) from public;
grant execute on function public.get_event_attendance_summary(uuid,uuid,uuid,uuid,text) to authenticated;
