-- Public registration creates student accounts only. Staff roles are granted
-- through an administrator-authorized RPC, never from Auth user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(new.raw_user_meta_data ->> 'academic_level_id', '') is null
    or nullif(new.raw_user_meta_data ->> 'course_id', '') is null
    or nullif(new.raw_user_meta_data ->> 'year_level_id', '') is null
    or nullif(new.raw_user_meta_data ->> 'section_id', '') is null then
    raise exception 'Student academic information is required';
  end if;

  insert into public.profiles (
    id, email, full_name, role, academic_level_id, course_id, year_level_id, section_id
  )
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    'student',
    nullif(new.raw_user_meta_data ->> 'academic_level_id', '')::uuid,
    nullif(new.raw_user_meta_data ->> 'course_id', '')::uuid,
    nullif(new.raw_user_meta_data ->> 'year_level_id', '')::uuid,
    nullif(new.raw_user_meta_data ->> 'section_id', '')::uuid
  )
  on conflict (id) do nothing;

  insert into public.student_academic_assignments (
    student_id, academic_level_id, course_id, year_level_id, section_id, academic_year
  )
  select new.id, c.academic_level_id, c.id, s.year_level_id, s.id, s.academic_year
  from public.academic_sections s
  join public.courses c on c.id = s.course_id
  where s.id = nullif(new.raw_user_meta_data ->> 'section_id', '')::uuid
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active
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
  if auth.uid() is not null and not public.is_admin() then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.display_id is distinct from old.display_id
      or new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.deactivated_at is distinct from old.deactivated_at
      or new.academic_level_id is distinct from old.academic_level_id
      or new.course_id is distinct from old.course_id
      or new.year_level_id is distinct from old.year_level_id
      or new.section_id is distinct from old.section_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Only an administrator may update protected profile fields';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Active users can update their own name" on public.profiles;
create policy "Active users can update their own name"
  on public.profiles for update to authenticated
  using (auth.uid() = id and is_active)
  with check (auth.uid() = id and is_active);

revoke insert, delete on table public.profiles from public, anon, authenticated;
revoke update on table public.profiles from public, anon, authenticated;
do $$
declare
  profile_column record;
begin
  for profile_column in
    select attname
    from pg_attribute
    where attrelid = 'public.profiles'::regclass
      and attnum > 0
      and not attisdropped
  loop
    execute format(
      'revoke update (%I) on table public.profiles from public, anon, authenticated',
      profile_column.attname
    );
  end loop;
end;
$$;
grant update (full_name) on table public.profiles to authenticated;
revoke insert, update, delete on table public.attendance from public, anon, authenticated;
revoke insert, update, delete on table public.events from public, anon, authenticated;

create or replace function public.admin_approve_teacher(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User not found';
  end if;
  if target.role <> 'student' then
    raise exception 'Only student accounts can be approved as teachers';
  end if;
  if not target.is_active then
    raise exception 'Reactivate this account before approving it as a teacher';
  end if;

  update public.profiles
  set role = 'teacher',
      academic_level_id = null,
      course_id = null,
      year_level_id = null,
      section_id = null,
      updated_at = now()
  where id = p_user_id
  returning * into target;

  update public.student_academic_assignments
  set ended_at = now()
  where student_id = p_user_id
    and ended_at is null;

  return target;
end;
$$;

revoke all on function public.admin_approve_teacher(uuid) from public;
grant execute on function public.admin_approve_teacher(uuid) to authenticated;

create or replace function public.admin_reactivate_user(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.profiles
  set is_active = true,
      deactivated_at = null,
      updated_at = now()
  where id = p_user_id
  returning * into target;

  if not found then
    raise exception 'User not found';
  end if;

  return target;
end;
$$;

revoke all on function public.admin_reactivate_user(uuid) from public;
grant execute on function public.admin_reactivate_user(uuid) to authenticated;

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  student_id uuid not null,
  previous_status text check (previous_status in ('present', 'absent', 'late', 'excused')),
  new_status text check (new_status in ('present', 'absent', 'late', 'excused')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint attendance_corrections_has_change
    check (previous_status is distinct from new_status)
);

create index if not exists attendance_corrections_event_created_idx
  on public.attendance_corrections (event_id, created_at desc);

alter table public.attendance_corrections enable row level security;
revoke all on table public.attendance_corrections from public, anon, authenticated;

create or replace function public.log_attendance_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.attendance_corrections (
      event_id, student_id, previous_status, new_status, actor_id
    )
    values (new.event_id, new.student_id, old.status, new.status, auth.uid());
  elsif tg_op = 'DELETE' then
    insert into public.attendance_corrections (
      event_id, student_id, previous_status, new_status, actor_id
    )
    values (old.event_id, old.student_id, old.status, null, auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists attendance_correction_audit on public.attendance;
create trigger attendance_correction_audit
  after update or delete on public.attendance
  for each row execute function public.log_attendance_correction();

create or replace function public.get_event_attendance_corrections(p_event_id uuid)
returns table (
  id uuid,
  student_id uuid,
  previous_status text,
  new_status text,
  actor_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_manager(p_event_id) then
    raise exception 'Not authorized for this event';
  end if;

  return query
  select c.id, c.student_id, c.previous_status, c.new_status, c.actor_id, c.created_at
  from public.attendance_corrections c
  where c.event_id = p_event_id
  order by c.created_at desc;
end;
$$;

revoke all on function public.get_event_attendance_corrections(uuid) from public;
grant execute on function public.get_event_attendance_corrections(uuid) to authenticated;

revoke all on function public.log_attendance_correction() from public, anon, authenticated;

drop policy if exists "Students can view their own attendance" on public.attendance;
drop policy if exists "Administrators can view all attendance" on public.attendance;
drop policy if exists "Teachers can view authorized event attendance" on public.attendance;
drop policy if exists "Teachers can view attendance for their events" on public.attendance;
create policy "Active users can view authorized attendance"
  on public.attendance for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
    and (
      student_id = auth.uid()
      or public.is_admin()
      or public.is_event_manager(event_id)
    )
  );

drop policy if exists "Events are readable by any authenticated user" on public.events;
drop policy if exists "Administrators can view all events" on public.events;
drop policy if exists "Events are readable by eligible users" on public.events;
create policy "Events are readable by active eligible users"
  on public.events for select to authenticated
  using (
    public.is_admin()
    or public.is_event_manager(id)
    or (
      archived_at is null
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = 'student'
          and p.is_active
      )
      and public.student_is_in_event_audience(id, auth.uid())
    )
  );

drop function if exists public.get_student_attendance_history();
create function public.get_student_attendance_history()
returns table (
  attendance_id uuid,
  attendance_display_id text,
  status text,
  scanned_at timestamptz,
  recorded_at timestamptz,
  event_code text,
  event_title text,
  venue text,
  description text,
  creator_name text,
  creator_display_id text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.display_id,
    a.status,
    a.scanned_at,
    a.recorded_at,
    e.event_code,
    e.title,
    e.venue,
    e.description,
    p.full_name,
    p.display_id
  from public.attendance a
  join public.events e on e.id = a.event_id
  left join public.profiles p on p.id = e.created_by
  where a.student_id = auth.uid()
    and exists (
      select 1 from public.profiles student
      where student.id = auth.uid()
        and student.role = 'student'
        and student.is_active
    )
  order by a.scanned_at desc;
$$;

revoke all on function public.get_student_attendance_history() from public;
grant execute on function public.get_student_attendance_history() to authenticated;
