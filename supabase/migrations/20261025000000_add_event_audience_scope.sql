-- Limit event eligibility to all students or a configured academic group.
-- An event with no audience rows includes all active students.

create table if not exists public.event_audience (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  year_level_id uuid references public.year_levels(id) on delete restrict,
  section_id uuid references public.academic_sections(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (course_id is not null or year_level_id is not null or section_id is not null)
);

create unique index if not exists event_audience_unique_scope
on public.event_audience (
  event_id,
  coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(year_level_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

alter table public.event_audience enable row level security;

drop policy if exists "Event audience is scoped" on public.event_audience;
create policy "Event audience is scoped" on public.event_audience
for select to authenticated
using (public.is_admin() or public.is_event_manager(event_id));

drop policy if exists "Event managers can create audience" on public.event_audience;
create policy "Event managers can create audience" on public.event_audience
for insert to authenticated
with check (public.is_admin() or public.is_event_manager(event_id));

drop policy if exists "Event managers can update audience" on public.event_audience;
create policy "Event managers can update audience" on public.event_audience
for update to authenticated
using (public.is_admin() or public.is_event_manager(event_id))
with check (public.is_admin() or public.is_event_manager(event_id));

drop policy if exists "Event managers can delete audience" on public.event_audience;
create policy "Event managers can delete audience" on public.event_audience
for delete to authenticated
using (public.is_admin() or public.is_event_manager(event_id));

create or replace function public.student_is_in_event_audience(p_event_id uuid, p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select not exists (select 1 from public.event_audience where event_id = p_event_id)
    or exists (
      select 1
      from public.event_audience a
      join public.profiles p on p.id = p_student_id
      where a.event_id = p_event_id
        and (a.course_id is null or a.course_id = p.course_id)
        and (a.year_level_id is null or a.year_level_id = p.year_level_id)
        and (a.section_id is null or a.section_id = p.section_id)
    );
$$;

create or replace function public.create_event_with_audience(
  p_event_code text,
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_course_id uuid default null,
  p_year_level_id uuid default null,
  p_section_id uuid default null
)
returns public.events language plpgsql security definer set search_path = public
as $$
declare result public.events;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  insert into public.events(event_code, title, start_time, end_time, created_by)
  values (btrim(p_event_code), btrim(p_title), p_start_time, p_end_time, auth.uid())
  returning * into result;

  if p_course_id is not null or p_year_level_id is not null or p_section_id is not null then
    if p_section_id is not null and not exists (
      select 1 from public.academic_sections s
      where s.id = p_section_id and s.is_active
        and (p_course_id is null or s.course_id = p_course_id)
        and (p_year_level_id is null or s.year_level_id = p_year_level_id)
    ) then raise exception 'Invalid event section'; end if;
    insert into public.event_audience(event_id, course_id, year_level_id, section_id)
    values (result.id, p_course_id, p_year_level_id, p_section_id);
  end if;
  return result;
end;
$$;

create or replace function public.record_event_attendance(p_event_id uuid, p_student_id uuid, p_status text)
returns public.attendance language plpgsql security definer set search_path = public
as $$
declare result public.attendance; event_row public.events;
begin
  if not public.is_event_manager(p_event_id) then raise exception 'Not authorized for this event'; end if;
  if p_status not in ('present','absent','late','excused') then raise exception 'Invalid attendance status'; end if;
  select * into event_row from public.events where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if event_row.event_status='cancelled' then raise exception 'Event is cancelled'; end if;
  if not exists (select 1 from public.profiles where id=p_student_id and role='student' and is_active) then raise exception 'Student not found'; end if;
  if not public.student_is_in_event_audience(p_event_id, p_student_id) then raise exception 'Student is not eligible for this event'; end if;
  insert into public.attendance(student_id,event_id,status,recorded_by,recorded_at)
  values (p_student_id,p_event_id,p_status,auth.uid(),now())
  on conflict (student_id,event_id) do update set status=excluded.status, recorded_by=excluded.recorded_by, recorded_at=excluded.recorded_at
  returning * into result;
  return result;
end;
$$;

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
    and public.student_is_in_event_audience(p_event_id, p.id)
    and (p_course_id is null or p.course_id=p_course_id)
    and (p_year_level_id is null or p.year_level_id=p_year_level_id)
    and (p_section_id is null or p.section_id=p_section_id)
    and (p_status is null or a.status=p_status);
  return result;
end;
$$;

grant select on public.event_audience to authenticated;
revoke all on function public.student_is_in_event_audience(uuid,uuid) from public;
grant execute on function public.student_is_in_event_audience(uuid,uuid) to authenticated;
revoke all on function public.create_event_with_audience(text,text,timestamptz,timestamptz,uuid,uuid,uuid) from public;
grant execute on function public.create_event_with_audience(text,text,timestamptz,timestamptz,uuid,uuid,uuid) to authenticated;
